// src/routes/admin.routes.js
const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const prisma = require("../config/prisma");
const { authRequiredStrict, requireRole } = require("../middlewares/auth");
const { sendMail } = require("../utils/mailer");

const router = express.Router();

/**
 * ✅ PRODUCCIÓN (Render 1 service):
 * - Ideal: define APP_URL con el dominio público del servicio (front+api).
 * - Fallback: Render suele exponer RENDER_EXTERNAL_URL (si existe).
 * - En producción NO dejamos que se vaya a localhost.
 */
const APP_URL =
  process.env.APP_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  (process.env.NODE_ENV === "production"
    ? (() => {
        throw new Error(
          "APP_URL es requerido en producción (debe apuntar al dominio público del FRONT)."
        );
      })()
    : "http://localhost:3000");

// ✅ Para links/recursos sin doble slash
const APP_BASE = String(APP_URL).replace(/\/+$/, "");
// ✅ Logo público (Next sirve /public en la raíz)
const LOGO_URL = `${APP_BASE}/logo-xuping-regina.png`;

router.use(authRequiredStrict, requireRole(["ADMIN"]));

function makeResetToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function sha256(input) {
  return crypto.createHash("sha256").update(String(input)).digest("hex");
}

function normalizeUsernameFromName(nombre) {
  const base = String(nombre ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const cleaned = base
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.+/g, ".");
  return cleaned || "user";
}

function normalizeUsernameInput(input) {
  return String(input ?? "").trim();
}

function isValidUsername(input) {
  return /^[a-zA-Z0-9._-]+$/.test(String(input ?? ""));
}

async function ensureUniqueUsername(base) {
  let candidate = base;
  for (let i = 0; i < 50; i += 1) {
    const exists = await prisma.usuarios.findFirst({
      where: { username: { equals: candidate, mode: "insensitive" } },
      select: { id: true },
    });
    if (!exists) return candidate;
    candidate = `${base}.${i + 2}`;
  }
  return `${base}.${Date.now()}`;
}

router.get("/roles", async (req, res) => {
  try {
    const roles = await prisma.roles.findMany({
      select: { id: true, nombre: true },
      orderBy: { nombre: "asc" },
    });
    return res.json({ ok: true, items: roles });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: "Error cargando roles" });
  }
});

router.get("/sucursales", async (req, res) => {
  try {
    const sucursales = await prisma.sucursales.findMany({
      where: { activo: true },
      select: { id: true, nombre: true, codigo: true },
      orderBy: { nombre: "asc" },
    });
    return res.json({ ok: true, items: sucursales });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: "Error cargando sucursales" });
  }
});

router.get("/users", async (req, res) => {
  try {
    const users = await prisma.usuarios.findMany({
      select: {
        id: true,
        nombre: true,
        username: true,
        email: true,
        activo: true,
        roles: { select: { id: true, nombre: true } },
        sucursales: { select: { id: true, nombre: true, codigo: true } },
      },
      orderBy: { creado_en: "desc" },
    });

    return res.json({ ok: true, items: users });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: "Error cargando usuarios" });
  }
});

// Crear usuario e invitarlo a establecer contrasena
router.post("/users/invite", async (req, res) => {
  try {
    const { nombre, email, rolId, sucursalId, password, username } = req.body || {};

    if (!nombre || !email || !rolId) {
      return res.status(400).json({ ok: false, message: "Datos incompletos" });
    }

    const mail = String(email).trim();
    if (!mail) {
      return res.status(400).json({ ok: false, message: "Correo invalido" });
    }

    const role = await prisma.roles.findUnique({ where: { id: String(rolId) } });
    if (!role) return res.status(400).json({ ok: false, message: "Rol invalido" });

    const requestedUsername = normalizeUsernameInput(username);
    if (requestedUsername && !isValidUsername(requestedUsername)) {
      return res.status(400).json({
        ok: false,
        message: "El usuario solo permite letras, numeros, punto, guion y guion bajo.",
      });
    }

    const usernameBase = requestedUsername || normalizeUsernameFromName(nombre);
    const finalUsername = await ensureUniqueUsername(usernameBase);

    const existing = await prisma.usuarios.findFirst({
      where: {
        OR: [
          { email: { equals: mail, mode: "insensitive" } },
          { username: { equals: finalUsername, mode: "insensitive" } },
        ],
      },
    });

    if (existing) {
      return res.status(409).json({ ok: false, message: "Usuario o correo ya registrado" });
    }

    let passHash = null;
    let sendSetup = false;
    const rawPassword = String(password ?? "").trim();

    if (rawPassword) {
      if (rawPassword.length < 8) {
        return res.status(400).json({
          ok: false,
          message: "La contrasena debe tener minimo 8 caracteres.",
        });
      }
      passHash = await bcrypt.hash(rawPassword, 12);
    } else {
      const temp = crypto.randomBytes(32).toString("base64url");
      passHash = await bcrypt.hash(temp, 12);
      sendSetup = true;
    }

    const user = await prisma.usuarios.create({
      data: {
        nombre,
        username: finalUsername,
        email: mail,
        pass_hash: passHash,
        rol_id: role.id,
        sucursal_id: sucursalId ? String(sucursalId) : null,
        failed_login_count: 0,
        lock_until: null,
        password_changed_at: rawPassword ? new Date() : null,
        activo: true,
      },
      include: { roles: true, sucursales: true },
    });

    let emailWarning = null;

    if (sendSetup) {
      const token = makeResetToken();
      const tokenHash = sha256(token);
      const expires = new Date(Date.now() + 15 * 60 * 1000);

      await prisma.password_reset_tokens.create({
        data: {
          user_id: user.id,
          token_hash: tokenHash,
          expires_at: expires,
          ip: req.ip,
          user_agent: req.get("user-agent") || null,
        },
      });

      const url = `${APP_BASE}/reset-password?token=${token}&email=${encodeURIComponent(mail)}`;

      // ✅ SOLO CAMBIO: HTML premium + LOGO (misma lógica, mismos datos)
      // (Más compatible: sin flex; centrado con tablas)
      const premiumHtml = `
<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Establecer Contraseña</title>
  </head>
  <body style="margin:0;padding:0;background:#0f0a0a;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#0f0a0a;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="560" style="max-width:560px;background:#1a0c10;border:1px solid #3a1a22;border-radius:18px;overflow:hidden;">
            <tr>
              <td style="padding:18px 18px 0 18px;">
                <div style="height:8px;border-radius:999px;background:linear-gradient(90deg,#d6b25f,#e3c578,#e8cf8f);"></div>
              </td>
            </tr>

            <!-- ✅ Logo -->
            <tr>
              <td align="center" style="padding:16px 22px 6px 22px;">
                <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;">
                  <tr>
                    <td align="center" valign="middle"
                        style="width:76px;height:76px;border-radius:16px;border:1px solid #3a1a22;background:rgba(43,10,11,.45);">
                      <img src="${LOGO_URL}" width="56" height="56" alt="Xuping Regina"
                           style="display:block;border:0;outline:none;text-decoration:none;object-fit:contain;-ms-interpolation-mode:bicubic;" />
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:10px 22px 6px 22px;">
                <h1 style="margin:0;color:#f8f1e6;font-size:20px;letter-spacing:.2px;text-align:center;">
                  Establecer contraseña
                </h1>
                <p style="margin:10px 0 0 0;color:#e3d2bd;font-size:13px;line-height:1.6;text-align:center;">
                  Use el siguiente enlace para definir su contraseña de acceso.
                </p>

                <div style="margin:14px 0 0 0;padding:12px 14px;border:1px solid rgba(214,178,95,.25);background:rgba(214,178,95,.08);border-radius:12px;color:#e8cf8f;font-size:12px;line-height:1.5;">
                  Este enlace vence en <b>15 minutos</b> y solo puede usarse <b>una vez</b>.
                </div>
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:14px 22px 10px 22px;">
                <a href="${url}"
                   style="display:inline-block;text-decoration:none;padding:12px 18px;border-radius:12px;
                          background:linear-gradient(90deg,#d6b25f,#e3c578,#e8cf8f);
                          color:#2b0a0b;font-weight:700;font-size:14px;">
                  Establecer contraseña
                </a>
              </td>
            </tr>

            <tr>
              <td style="padding:10px 22px 18px 22px;">
                <p style="margin:0;color:#c9b296;font-size:12px;line-height:1.6;">
                  Si el botón no funciona, copie y pegue este enlace en su navegador:
                </p>
                <p style="margin:8px 0 0 0;word-break:break-all;font-size:12px;line-height:1.6;">
                  <a href="${url}" style="color:#e3c578;text-decoration:underline;">${url}</a>
                </p>

                <div style="margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,.08);">
                  <p style="margin:0;color:#a98c73;font-size:11px;line-height:1.6;">
                    Si usted no solicitó esto, ignore este correo.
                  </p>
                </div>
              </td>
            </tr>
          </table>

          <p style="margin:14px 0 0 0;color:#6f5a4a;font-size:10px;line-height:1.5;text-align:center;">
            © ${new Date().getFullYear()} Joyería • Mensaje automático
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>
      `.trim();

      try {
        await sendMail({
          to: mail,
          subject: "Establecer Contraseña",
          html: premiumHtml,
          text: `Establecer contraseña (vence en 15 min): ${url}`,
        });
      } catch (err) {
        console.error(err);
        emailWarning = "No se pudo enviar el correo de configuracion.";
      }
    }

    return res.json({
      ok: true,
      setupSent: sendSetup,
      emailWarning,
      user: {
        id: user.id,
        nombre: user.nombre,
        username: user.username,
        email: user.email,
        rol: user.roles?.nombre || "",
        sucursal: user.sucursales?.nombre || null,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: "Error creando usuario" });
  }
});

router.put("/users/:id", async (req, res) => {
  try {
    const userId = String(req.params.id || "");
    const { nombre, email, rolId, sucursalId } = req.body || {};

    if (!userId || !nombre || !email || !rolId) {
      return res.status(400).json({ ok: false, message: "Datos incompletos" });
    }

    const mail = String(email).trim();
    if (!mail) {
      return res.status(400).json({ ok: false, message: "Correo invalido" });
    }

    const role = await prisma.roles.findUnique({ where: { id: String(rolId) } });
    if (!role) return res.status(400).json({ ok: false, message: "Rol invalido" });

    const emailUsed = await prisma.usuarios.findFirst({
      where: {
        id: { not: userId },
        email: { equals: mail, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (emailUsed) {
      return res.status(409).json({ ok: false, message: "Correo ya registrado" });
    }

    const updated = await prisma.usuarios.update({
      where: { id: userId },
      data: {
        nombre,
        email: mail,
        rol_id: role.id,
        sucursal_id: sucursalId ? String(sucursalId) : null,
      },
      include: { roles: true, sucursales: true },
    });

    return res.json({
      ok: true,
      user: {
        id: updated.id,
        nombre: updated.nombre,
        username: updated.username,
        email: updated.email,
        rol: updated.roles?.nombre || "",
        sucursal: updated.sucursales?.nombre || null,
        activo: updated.activo,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: "Error actualizando usuario" });
  }
});

router.delete("/users/:id", async (req, res) => {
  try {
    const userId = String(req.params.id || "");
    if (!userId) return res.status(400).json({ ok: false, message: "Usuario invalido" });

    await prisma.usuarios.delete({ where: { id: userId } });

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(409).json({
      ok: false,
      message:
        "No se pudo eliminar el usuario. Verifique que no tenga movimientos relacionados.",
    });
  }
});

module.exports = router;
