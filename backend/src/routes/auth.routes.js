const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const { authRequired } = require('../middlewares/auth');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

// ✅ Normaliza el rol para que requireRole() sea consistente
function normalizeRoleName(roleName) {
  return String(roleName ?? '')
    .trim()
    .toUpperCase();
}

// Helper para crear token
function signToken(user, roleName) {
  const role = normalizeRoleName(roleName);
  return jwt.sign(
    { userId: user.id, roleName: role },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
}

// Registro genérico (lo usarás solo desde admin)
router.post('/register', async (req, res) => {
  try {
    const { nombre, email, password, rolNombre } = req.body;

    if (!nombre || !email || !password || !rolNombre) {
      return res.status(400).json({ ok: false, message: 'Datos incompletos' });
    }

    const existing = await prisma.usuarios.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ ok: false, message: 'Email ya registrado' });
    }

    // ✅ Busca rol de forma case-insensitive (CAJERO / cajero / Cajero)
    const rol = await prisma.roles.findFirst({
      where: {
        nombre: { equals: String(rolNombre).trim(), mode: 'insensitive' },
      },
    });

    if (!rol) {
      return res.status(400).json({ ok: false, message: 'Rol no válido' });
    }

    const hash = await bcrypt.hash(password, 10);

    const user = await prisma.usuarios.create({
      data: {
        nombre,
        email,
        pass_hash: hash,
        rol_id: rol.id,
      },
    });

    const roleName = normalizeRoleName(rol.nombre);
    const token = signToken(user, roleName);

    return res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        rol: roleName,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: 'Error registrando usuario' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.usuarios.findUnique({
      where: { email },
      include: { roles: true }, // ajusta nombre si es distinto
    });

    if (!user) {
      return res.status(401).json({ ok: false, message: 'Credenciales inválidas' });
    }

    const match = await bcrypt.compare(password, user.pass_hash);
    if (!match) {
      return res.status(401).json({ ok: false, message: 'Credenciales inválidas' });
    }

    const roleName = normalizeRoleName(user.roles?.nombre || 'desconocido');
    const token = signToken(user, roleName);

    return res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        rol: roleName,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: 'Error en login' });
  }
});

// Perfil actual
router.get('/me', authRequired, async (req, res) => {
  try {
    const user = await prisma.usuarios.findUnique({
      where: { id: req.user.userId },
      include: { roles: true },
    });
    if (!user) return res.status(404).json({ ok: false, message: 'Usuario no encontrado' });

    return res.json({
      ok: true,
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        rol: normalizeRoleName(user.roles?.nombre),
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: 'Error obteniendo perfil' });
  }
});

module.exports = router;
