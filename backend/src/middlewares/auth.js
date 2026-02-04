// src/middlewares/auth.js
const jwt = require("jsonwebtoken");
const prisma = require("../config/prisma");

const JWT_SECRET = process.env.JWT_SECRET;
const DEV_FALLBACK = "dev_secret";

// Opcional (recomendado): fortalece validación si los define en .env
const JWT_ISSUER = process.env.JWT_ISSUER;     // ej: "joyeria-api"
const JWT_AUDIENCE = process.env.JWT_AUDIENCE; // ej: "joyeria-web"

function getJwtSecret() {
  // ✅ En producción, NO aceptamos secretos “por defecto”
  if (!JWT_SECRET && process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET es requerido en producción");
  }
  return JWT_SECRET || DEV_FALLBACK;
}

function readBearerToken(req) {
  const header = req.headers.authorization;
  if (!header) return null;

  // ✅ PRO: soporta "Bearer" en cualquier case + espacios extra
  const parts = String(header).trim().split(/\s+/);
  if (parts.length < 2) return null;

  const scheme = String(parts[0] || "");
  if (scheme.toLowerCase() !== "bearer") return null;

  const token = String(parts[1] || "").trim();
  return token || null;
}

function buildVerifyOptions() {
  // ✅ Algoritmo fijo (evita problemas por configuración débil)
  const opts = { algorithms: ["HS256"] };

  // ✅ Si usted define issuer/audience, se vuelven obligatorios
  if (JWT_ISSUER) opts.issuer = JWT_ISSUER;
  if (JWT_AUDIENCE) opts.audience = JWT_AUDIENCE;

  return opts;
}

// ✅ Middleware normal (rápido): solo valida JWT
function authRequired(req, res, next) {
  const token = readBearerToken(req);
  if (!token) {
    return res.status(401).json({ ok: false, message: "Token requerido" });
  }

  try {
    const payload = jwt.verify(token, getJwtSecret(), buildVerifyOptions());

    // ✅ Mantiene su estructura { userId, roleName }
    if (!payload?.userId) {
      return res.status(401).json({ ok: false, message: "Token inválido" });
    }

    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ ok: false, message: "Token inválido" });
  }
}

function requireRole(roles = []) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  const allowedNorm = allowed.map((r) => String(r ?? "").trim().toUpperCase());

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, message: "No autenticado" });
    }

    const userRoleNorm = String(req.user.roleName ?? "").trim().toUpperCase();

    if (!allowedNorm.includes(userRoleNorm)) {
      return res.status(403).json({ ok: false, message: "Sin permisos" });
    }

    next();
  };
}

/**
 * authRequiredStrict (✅ el “3” bien hecho)
 * - Valida JWT (igual que authRequired)
 * - Valida usuario en BD (existe y está activo)
 * - Revoca tokens si password_changed_at > iat del token
 *
 * Úselo en rutas sensibles: admin, caja, operaciones críticas.
 */
async function authRequiredStrict(req, res, next) {
  const token = readBearerToken(req);
  if (!token) {
    return res.status(401).json({ ok: false, message: "Token requerido" });
  }

  try {
    const payload = jwt.verify(token, getJwtSecret(), buildVerifyOptions());

    if (!payload?.userId) {
      return res.status(401).json({ ok: false, message: "Token inválido" });
    }

    const user = await prisma.usuarios.findUnique({
      where: { id: payload.userId },
      select: { id: true, activo: true, password_changed_at: true },
    });

    if (!user || user.activo === false) {
      return res.status(401).json({ ok: false, message: "No autenticado" });
    }

    // ✅ Revocación por cambio de contraseña:
    // si iat(token) < password_changed_at => token muere
    if (payload.iat && user.password_changed_at) {
      const tokenIatMs = Number(payload.iat) * 1000;
      const pwdChangedMs = new Date(user.password_changed_at).getTime();

      if (Number.isFinite(tokenIatMs) && tokenIatMs < pwdChangedMs) {
        return res.status(401).json({ ok: false, message: "Token expirado" });
      }
    }

    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ ok: false, message: "Token inválido" });
  }
}

/**
 * attachCurrentUser
 * - Adjunta el usuario real en req.currentUser
 * - No cambia el comportamiento del authRequired
 */
async function attachCurrentUser(req, res, next) {
  try {
    if (!req.user?.userId) return next();

    const user = await prisma.usuarios.findUnique({
      where: { id: req.user.userId },
      include: { roles: true },
    });

    req.currentUser = user || null;
    next();
  } catch (err) {
    console.error(err);
    next();
  }
}

module.exports = authRequired;
module.exports.authRequired = authRequired;
module.exports.authRequiredStrict = authRequiredStrict;
module.exports.requireRole = requireRole;
module.exports.attachCurrentUser = attachCurrentUser;
