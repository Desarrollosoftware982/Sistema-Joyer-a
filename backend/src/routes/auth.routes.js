// src/routes/auth.routes.js
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const speakeasy = require("speakeasy");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

const prisma = require("../config/prisma");
const { authRequired } = require("../middlewares/auth");
const { sendMail } = require("../utils/mailer");

const router = express.Router();

// ✅ Producción: no permitir default inseguro
const JWT_SECRET =
  process.env.JWT_SECRET || (process.env.NODE_ENV !== "production" ? "dev_secret" : "");
if (!JWT_SECRET) {
  throw new Error("Falta JWT_SECRET en producción.");
}

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";
const JWT_ISSUER = process.env.JWT_ISSUER;
const JWT_AUDIENCE = process.env.JWT_AUDIENCE;

// ✅ PRODUCCIÓN (Render 1 service): APP_URL debe ser público (no localhost)
const APP_URL =
  process.env.APP_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  (process.env.NODE_ENV !== "production" ? "http://localhost:3000" : "");

if (process.env.NODE_ENV === "production" && !APP_URL) {
  throw new Error("Falta APP_URL en producción.");
}

// ✅ Para links sin doble slash
const APP_BASE = String(APP_URL).replace(/\/+$/, "");

/**
 * Forgot Password Hardening
 * - rate-limit por IP+email
 * - invalida tokens anteriores (solo 1 válido)
 * - cooldown por usuario
 * - límites diarios + bloqueo 24h (solo recovery)
 */
const RESET_COOLDOWN_MS = Number(process.env.RESET_COOLDOWN_MS || 2 * 60 * 1000); // 2 min
const RESET_MAX_EMAILS_PER_DAY = Number(process.env.RESET_MAX_EMAILS_PER_DAY || 5); // 5 correos/día
const RESET_MAX_ATTEMPTS_PER_DAY = Number(process.env.RESET_MAX_ATTEMPTS_PER_DAY || 10); // 10 intentos/día
const RESET_LOCK_HOURS = Number(process.env.RESET_LOCK_HOURS || 24); // 24h

// -------------------- Rate limiters --------------------
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const ident = String(req.body?.identifier ?? req.body?.email ?? "")
      .trim()
      .toLowerCase();
    const ipKey = ipKeyGenerator(req.ip);
    return `${ipKey}:${ident || "no-ident"}`;
  },
  skipSuccessfulRequests: true,
  message: { ok: false, message: "Demasiados intentos. Intente más tarde." },
});

const forgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const mail = String(req.body?.email ?? "").trim().toLowerCase();
    const ipKey = ipKeyGenerator(req.ip);
    return `${ipKey}:${mail || "no-email"}`;
  },
  message: { ok: false, message: "Espere un momento e intente de nuevo." },
});

const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const mail = String(req.body?.email ?? req.query?.email ?? "")
      .trim()
      .toLowerCase();
    const ipKey = ipKeyGenerator(req.ip);
    return `${ipKey}:${mail || "no-email"}`;
  },
  message: { ok: false, message: "Espere un momento e intente de nuevo." },
});

// -------------------- Helpers --------------------
function normalizeRoleName(roleName) {
  return String(roleName ?? "").trim().toUpperCase();
}

function signToken(user, roleName) {
  const role = normalizeRoleName(roleName);
  const options = {
    expiresIn: JWT_EXPIRES_IN,
    algorithm: "HS256",
  };
  if (JWT_ISSUER) options.issuer = JWT_ISSUER;
  if (JWT_AUDIENCE) options.audience = JWT_AUDIENCE;
  return jwt.sign({ userId: user.id, roleName: role }, JWT_SECRET, options);
}

// Token corto para completar MFA (5 min)
function signMfaToken(user, roleName) {
  const role = normalizeRoleName(roleName);
  const options = {
    expiresIn: "5m",
    algorithm: "HS256",
  };
  if (JWT_ISSUER) options.issuer = JWT_ISSUER;
  if (JWT_AUDIENCE) options.audience = JWT_AUDIENCE;
  return jwt.sign({ userId: user.id, roleName: role, purpose: "mfa" }, JWT_SECRET, options);
}

function makeResetToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function sha256(input) {
  return crypto.createHash("sha256").update(String(input)).digest("hex");
}

function todayStartUTC(now = new Date()) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// ✅ Gate local: SOLO ADMIN
function requireAdmin(req, res, next) {
  const role = normalizeRoleName(req.user?.roleName);
  if (role !== "ADMIN") {
    return res.status(403).json({ ok: false, message: "No autorizado" });
  }
  next();
}

// -------------------- REGISTER (solo ADMIN) --------------------
// (Tu comentario decía “lo usarás solo desde admin”, aquí ya queda blindado)
router.post("/register", authRequired, requireAdmin, async (req, res) => {
  try {
    const { nombre, email, password, rolNombre, username } = req.body;

    if (!nombre || !email || !password || !rolNombre) {
      return res.status(400).json({ ok: false, message: "Datos incompletos" });
    }
    if (String(password).length < 8) {
      return res
        .status(400)
        .json({ ok: false, message: "Contraseña muy corta (mínimo 8)." });
    }

    const mail = String(email).trim();
    const uname = String(username ?? "").trim();

    const existing = await prisma.usuarios.findFirst({
      where: {
        OR: [
          { email: { equals: mail, mode: "insensitive" } },
          ...(uname ? [{ username: { equals: uname, mode: "insensitive" } }] : []),
        ],
      },
    });
    if (existing) {
      return res
        .status(409)
        .json({ ok: false, message: "Usuario o correo ya registrado" });
    }

    const rol = await prisma.roles.findFirst({
      where: { nombre: { equals: String(rolNombre).trim(), mode: "insensitive" } },
    });
    if (!rol) return res.status(400).json({ ok: false, message: "Rol no válido" });

    const hash = await bcrypt.hash(String(password), 12);

    const user = await prisma.usuarios.create({
      data: {
        nombre,
        email: mail,
        ...(uname ? { username: uname } : {}),
        pass_hash: hash,
        rol_id: rol.id,

        // ✅ si tu schema los tiene, quedan pro
        failed_login_count: 0,
        lock_until: null,
        password_changed_at: new Date(),
        activo: true,
      },
      include: { roles: true },
    });

    const roleName = normalizeRoleName(user.roles?.nombre || rol.nombre);
    const token = signToken(user, roleName);

    return res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        username: user.username ?? null,
        rol: roleName,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: "Error registrando usuario" });
  }
});

// -------------------- LOGIN (identifier/email) + bloqueo + MFA solo ADMIN --------------------
router.post("/login", loginLimiter, async (req, res) => {
  try {
    // ✅ compat: acepta {identifier,password} o tu viejo {email,password}
    const identifier = String(req.body?.identifier ?? req.body?.email ?? "").trim();
    const password = req.body?.password;

    const fail = () =>
      res.status(401).json({ ok: false, message: "Credenciales inválidas" });
    if (!identifier || !password) return fail();

    const user = await prisma.usuarios.findFirst({
      where: {
        OR: [
          { email: { equals: identifier, mode: "insensitive" } },
          { username: { equals: identifier, mode: "insensitive" } },
        ],
      },
      include: { roles: true },
    });

    if (!user || user.activo === false) return fail();

    // ✅ bloqueo temporal por lock_until
    if (user.lock_until && new Date(user.lock_until) > new Date()) {
      return res.status(423).json({
        ok: false,
        message: "Cuenta temporalmente bloqueada. Intente más tarde.",
      });
    }

    const match = await bcrypt.compare(String(password), user.pass_hash);
    if (!match) {
      const failed = (user.failed_login_count ?? 0) + 1;
      const lock = failed >= 8 ? new Date(Date.now() + 15 * 60 * 1000) : null;

      await prisma.usuarios.update({
        where: { id: user.id },
        data: { failed_login_count: failed, lock_until: lock },
      });

      return fail();
    }

    // ✅ éxito => reset conteo
    await prisma.usuarios.update({
      where: { id: user.id },
      data: { failed_login_count: 0, lock_until: null },
    });

    const roleName = normalizeRoleName(user.roles?.nombre || "DESCONOCIDO");

    // ✅ MFA SOLO ADMIN y SOLO si mfa_enabled true
    if (roleName === "ADMIN" && user.mfa_enabled) {
      const mfaToken = signMfaToken(user, roleName);
      return res.json({
        ok: true,
        mfaRequired: true,
        mfaToken,
        user: {
          id: user.id,
          nombre: user.nombre,
          email: user.email,
          username: user.username ?? null,
          rol: roleName,
        },
      });
    }

    const token = signToken(user, roleName);
    return res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        username: user.username ?? null,
        rol: roleName,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: "Error en login" });
  }
});

// -------------------- MFA (solo ADMIN) --------------------
router.post("/mfa/setup", authRequired, requireAdmin, async (req, res) => {
  try {
    const user = await prisma.usuarios.findUnique({ where: { id: req.user.userId } });
    if (!user) return res.status(404).json({ ok: false, message: "Usuario no encontrado" });

    const secret = speakeasy.generateSecret({
      name: `Joyería (${user.email})`,
      issuer: "Joyería",
      length: 20,
    });

    await prisma.usuarios.update({
      where: { id: user.id },
      data: {
        mfa_temp_secret: secret.base32,
        mfa_enabled: false,
        mfa_confirmed_at: null,
      },
    });

    return res.json({ ok: true, otpauth_url: secret.otpauth_url });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: "Error configurando MFA" });
  }
});

router.post("/mfa/confirm", authRequired, requireAdmin, async (req, res) => {
  try {
    const { code } = req.body;

    const user = await prisma.usuarios.findUnique({
      where: { id: req.user.userId },
      select: { id: true, mfa_temp_secret: true },
    });

    if (!user?.mfa_temp_secret) {
      return res
        .status(400)
        .json({ ok: false, message: "No hay configuración MFA pendiente" });
    }

    const verified = speakeasy.totp.verify({
      secret: user.mfa_temp_secret,
      encoding: "base32",
      token: String(code || ""),
      window: 1,
    });

    if (!verified) {
      return res.status(400).json({ ok: false, message: "Código inválido" });
    }

    await prisma.usuarios.update({
      where: { id: user.id },
      data: {
        mfa_secret: user.mfa_temp_secret,
        mfa_temp_secret: null,
        mfa_enabled: true,
        mfa_confirmed_at: new Date(),
      },
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: "Error confirmando MFA" });
  }
});

// Verificar MFA al login (no requiere authRequired, porque aún no hay sesión completa)
router.post("/mfa/verify-login", async (req, res) => {
  try {
    const { mfaToken, code } = req.body;
    if (!mfaToken || !code) {
      return res.status(400).json({ ok: false, message: "Datos incompletos" });
    }

    const payload = jwt.verify(mfaToken, JWT_SECRET, { algorithms: ["HS256"] });
    if (!payload?.userId || payload.purpose !== "mfa") {
      return res.status(401).json({ ok: false, message: "No autenticado" });
    }

    const user = await prisma.usuarios.findUnique({
      where: { id: payload.userId },
      include: { roles: true },
    });

    if (!user || user.activo === false) {
      return res.status(401).json({ ok: false, message: "No autenticado" });
    }

    const roleName = normalizeRoleName(user.roles?.nombre || "DESCONOCIDO");

    if (roleName !== "ADMIN" || !user.mfa_enabled || !user.mfa_secret) {
      return res.status(401).json({ ok: false, message: "No autenticado" });
    }

    const ok = speakeasy.totp.verify({
      secret: user.mfa_secret,
      encoding: "base32",
      token: String(code || ""),
      window: 1,
    });

    if (!ok) return res.status(400).json({ ok: false, message: "Código inválido" });

    const token = signToken(user, roleName);
    return res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        username: user.username ?? null,
        rol: roleName,
      },
    });
  } catch (err) {
    return res.status(401).json({ ok: false, message: "No autenticado" });
  }
});

// -------------------- FORGOT PASSWORD (hardening) --------------------
router.post("/forgot-password", forgotLimiter, async (req, res) => {
  // ✅ respuesta genérica SIEMPRE (anti-enumeración)
  const now = new Date();
  res.status(200).json({
    ok: true,
    message: "Si el correo existe, se enviará un enlace de recuperación.",
    cooldownApplied: true,
    cooldownSeconds: Math.ceil(RESET_COOLDOWN_MS / 1000),
    cooldownUntil: now.getTime() + RESET_COOLDOWN_MS,
  });

  try {
    const { email } = req.body;
    if (!email) return;

    const day = todayStartUTC(now);
    const mail = String(email).trim();

    let user = await prisma.usuarios.findFirst({
      where: { email: { equals: mail, mode: "insensitive" }, activo: true },
      select: {
        id: true,
        email: true,
        reset_day: true,
        reset_attempts_today: true,
        reset_emails_sent_today: true,
        reset_last_sent_at: true,
        reset_lock_until: true,
      },
    });
    if (!user) return;

    const userDay = user.reset_day ? new Date(user.reset_day) : null;
    if (!userDay || userDay.getTime() !== day.getTime()) {
      const keepLock =
        user.reset_lock_until && new Date(user.reset_lock_until) > now
          ? user.reset_lock_until
          : null;

      user = await prisma.usuarios.update({
        where: { id: user.id },
        data: {
          reset_day: day,
          reset_attempts_today: 0,
          reset_emails_sent_today: 0,
          reset_last_sent_at: null,
          reset_lock_until: keepLock,
        },
        select: {
          id: true,
          email: true,
          reset_day: true,
          reset_attempts_today: true,
          reset_emails_sent_today: true,
          reset_last_sent_at: true,
          reset_lock_until: true,
        },
      });
    }

    if (user.reset_lock_until && new Date(user.reset_lock_until) > now) return;

    user = await prisma.usuarios.update({
      where: { id: user.id },
      data: { reset_attempts_today: { increment: 1 } },
      select: {
        id: true,
        email: true,
        reset_attempts_today: true,
        reset_emails_sent_today: true,
        reset_last_sent_at: true,
        reset_lock_until: true,
      },
    });

    if ((user.reset_attempts_today ?? 0) >= RESET_MAX_ATTEMPTS_PER_DAY) {
      await prisma.usuarios.update({
        where: { id: user.id },
        data: {
          reset_lock_until: new Date(now.getTime() + RESET_LOCK_HOURS * 60 * 60 * 1000),
        },
      });
      return;
    }

    if (user.reset_last_sent_at) {
      const last = new Date(user.reset_last_sent_at).getTime();
      if (now.getTime() - last < RESET_COOLDOWN_MS) return;
    }

    if ((user.reset_emails_sent_today ?? 0) >= RESET_MAX_EMAILS_PER_DAY) return;

    await prisma.password_reset_tokens.updateMany({
      where: {
        user_id: user.id,
        used_at: null,
        expires_at: { gt: now },
      },
      data: { used_at: now },
    });

    const token = makeResetToken();
    const tokenHash = sha256(token);
    const expires = new Date(now.getTime() + 15 * 60 * 1000);

    const record = await prisma.password_reset_tokens.create({
      data: {
        user_id: user.id,
        token_hash: tokenHash,
        expires_at: expires,
        ip: req.ip,
        user_agent: req.get("user-agent") || null,
      },
      select: { id: true },
    });

    const url = `${APP_BASE}/dashboard/reset-password?token=${encodeURIComponent(
      token
    )}&email=${encodeURIComponent(mail)}`;
    const urlHtml = url.replace(/&/g, "&amp;");

    try {
      await sendMail({
        to: mail,
        subject: "Recuperación de contraseña",
        html: `
          <p>Se solicitó restablecer su contraseña.</p>
          <p>Este enlace vence en <b>15 minutos</b> y solo puede usarse una vez:</p>
          <p><a href="${url}">${urlHtml}</a></p>
          <p>Si su correo no detecta el enlace, cópielo y péguelo en el navegador.</p>
          <p>Si usted no solicitó esto, ignore este correo.</p>
        `,
        text: `Restablecer contraseña (vence en 15 min): ${url}`,
      });

      await prisma.usuarios.update({
        where: { id: user.id },
        data: {
          reset_emails_sent_today: { increment: 1 },
          reset_last_sent_at: now,
        },
      });
    } catch (mailErr) {
      console.error("Mailer error:", mailErr);
      await prisma.password_reset_tokens.update({
        where: { id: record.id },
        data: { used_at: now },
      });
    }
  } catch (err) {
    console.error(err);
  }
});

// -------------------- RESET PASSWORD --------------------
router.get("/reset-password/validate", resetLimiter, async (req, res) => {
  try {
    const { email, token } = req.query;

    if (!email || !token) {
      return res.status(400).json({ ok: false, message: "Datos incompletos" });
    }

    const tokenHash = sha256(token);

    const record = await prisma.password_reset_tokens.findUnique({
      where: { token_hash: tokenHash },
      include: { user: true },
    });

    if (!record || record.used_at) {
      return res.status(400).json({ ok: false, message: "Enlace inválido o ya utilizado." });
    }
    if (new Date(record.expires_at) < new Date()) {
      return res.status(400).json({ ok: false, message: "Enlace vencido. Solicite uno nuevo." });
    }

    const mail = String(email).trim().toLowerCase();
    if (String(record.user.email).trim().toLowerCase() !== mail || record.user.activo === false) {
      return res.status(400).json({ ok: false, message: "Enlace inválido." });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: "Error validando enlace" });
  }
});

router.post("/reset-password", resetLimiter, async (req, res) => {
  try {
    const { email, token, newPassword } = req.body;

    if (!email || !token || !newPassword) {
      return res.status(400).json({ ok: false, message: "Datos incompletos" });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({
        ok: false,
        message: "La contraseña debe tener mínimo 8 caracteres.",
      });
    }

    const tokenHash = sha256(token);

    const record = await prisma.password_reset_tokens.findUnique({
      where: { token_hash: tokenHash },
      include: { user: true },
    });

    if (!record || record.used_at) {
      return res.status(400).json({ ok: false, message: "Enlace inválido o ya utilizado." });
    }
    if (new Date(record.expires_at) < new Date()) {
      return res.status(400).json({ ok: false, message: "Enlace vencido. Solicite uno nuevo." });
    }

    const mail = String(email).trim().toLowerCase();
    if (String(record.user.email).trim().toLowerCase() !== mail || record.user.activo === false) {
      return res.status(400).json({ ok: false, message: "Enlace inválido." });
    }

    const hash = await bcrypt.hash(String(newPassword), 12);

    await prisma.$transaction([
      prisma.usuarios.update({
        where: { id: record.user_id },
        data: {
          pass_hash: hash,
          password_changed_at: new Date(),
          failed_login_count: 0,
          lock_until: null,
        },
      }),
      prisma.password_reset_tokens.update({
        where: { id: record.id },
        data: { used_at: new Date() },
      }),
    ]);

    return res.json({ ok: true, message: "Contraseña actualizada correctamente." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: "Error restableciendo contraseña" });
  }
});

// -------------------- PERFIL --------------------
router.get("/me", authRequired, async (req, res) => {
  try {
    const user = await prisma.usuarios.findUnique({
      where: { id: req.user.userId },
      include: { roles: true },
    });
    if (!user) return res.status(404).json({ ok: false, message: "Usuario no encontrado" });

    return res.json({
      ok: true,
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        username: user.username ?? null,
        rol: normalizeRoleName(user.roles?.nombre),
        mfa_enabled: !!user.mfa_enabled, // ✅ necesario para /dashboard/seguridad
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: "Error obteniendo perfil" });
  }
});

module.exports = router;
