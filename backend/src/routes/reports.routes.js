const express = require('express');
const prisma = require('../config/prisma');
const { authRequired, requireRole } = require('../middlewares/auth');

const router = express.Router();

// Reporte ventas por método de pago / rango de fechas
router.get('/ventas-metodo', authRequired, requireRole(['admin']), async (req, res) => {
  try {
    const { desde, hasta } = req.query;

    const rows = await prisma.$queryRawUnsafe(
      `
      SELECT *
      FROM vw_ventas_resumen_dia_metodo
      WHERE ($1::date IS NULL OR fecha >= $1::date)
        AND ($2::date IS NULL OR fecha <= $2::date)
      ORDER BY fecha ASC, metodo_pago ASC;
      `,
      desde || null,
      hasta || null
    );

    res.json({ ok: true, datos: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Error en reporte de ventas por método' });
  }
});

// Top productos
router.get('/top-productos', authRequired, requireRole(['admin']), async (req, res) => {
  try {
    const rows = await prisma.$queryRaw`
      SELECT * FROM vw_top_productos
      ORDER BY unidades DESC
      LIMIT 50;
    `;
    res.json({ ok: true, productos: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Error en reporte de top productos' });
  }
});

module.exports = router;
