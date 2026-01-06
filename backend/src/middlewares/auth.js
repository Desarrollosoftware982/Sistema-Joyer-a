// src/middlewares/auth.js
const jwt = require("jsonwebtoken");
const prisma = require("../config/prisma");

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";

function authRequired(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ ok: false, message: "Token requerido" });
  }

  const token = header.split(" ")[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);

    // ✅ NO tocamos tu estructura: sigue siendo { userId, roleName }
    req.user = payload;

    next();
  } catch (err) {
    return res.status(401).json({ ok: false, message: "Token inválido" });
  }
}

function requireRole(roles = []) {
  const allowed = Array.isArray(roles) ? roles : [roles];

  // ✅ Normalizamos roles permitidos (para evitar problemas de mayúsculas/espacios)
  const allowedNorm = allowed.map((r) => String(r ?? "").trim().toUpperCase());

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, message: "No autenticado" });
    }

    // ✅ Normalizamos el rol del usuario del token
    const userRoleNorm = String(req.user.roleName ?? "").trim().toUpperCase();

    // ✅ Si el token no trae roleName, deniega (igual que siempre)
    if (!allowedNorm.includes(userRoleNorm)) {
      return res.status(403).json({ ok: false, message: "Sin permisos" });
    }

    next();
  };
}

/**
 * attachCurrentUser
 * - NO cambia nada de authRequired/requireRole
 * - Solo adjunta el usuario real de BD en req.currentUser
 * - Incluye roles y sucursal_id (para modo corporación)
 */
async function attachCurrentUser(req, res, next) {
  try {
    if (!req.user?.userId) return next();

    const user = await prisma.usuarios.findUnique({
      where: { id: req.user.userId },
      // ✅ NO rompe nada: solo agrega sucursal_id para que lo puedas usar en rutas
      include: { roles: true },
    });

    // Si el usuario no existe (token viejo o borrado), lo dejamos pasar
    // y que la ruta decida (no cambiamos comportamiento)
    req.currentUser = user || null;
    next();
  } catch (err) {
    console.error(err);
    next();
  }
}

module.exports = authRequired;
module.exports.authRequired = authRequired;
module.exports.requireRole = requireRole;
module.exports.attachCurrentUser = attachCurrentUser;
