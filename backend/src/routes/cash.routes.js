// backend/src/routes/cash.routes.js
const express = require('express');
const prisma = require('../config/prisma');
const { authRequired, requireRole } = require('../middlewares/auth');

const router = express.Router();

/**
 * Utilidad: rango de fechas.
 * Si no mandas from/to en la query, toma el día de hoy (hora local del servidor).
 */
function getDateRangeFromQuery(query) {
  const { from, to } = query;

  if (from && to) {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      throw new Error('Parámetros "from" o "to" inválidos');
    }
    return { fromDate, toDate };
  }

  const now = new Date();
  const fromDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0
  );
  const toDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999
  );

  return { fromDate, toDate };
}

/**
 * Utilidad: resolver sucursal.
 * - Si mandas ?sucursalId=... se usa esa.
 * - Si no, se busca la sucursal con codigo = 'SP' (Sucursal Principal).
 */
async function resolveSucursalId(tx, sucursalId) {
  if (sucursalId) return sucursalId;

  const sp = await tx.sucursales.findFirst({
    where: { codigo: 'SP' },
  });

  if (!sp) {
    throw new Error('No se encontró la sucursal principal (codigo = SP)');
  }

  return sp.id;
}

/**
 * GET /api/cash/summary
 *
 * Resumen de caja para un rango de fechas (por defecto, hoy):
 * - Total por método de pago (EFECTIVO, TRANSFERENCIA, TARJETA)
 * - Total general
 *
 * Query:
 *   ?sucursalId=<uuid-opcional>
 *   ?from=2025-11-29T00:00:00.000Z (opcional)
 *   ?to=2025-11-29T23:59:59.999Z   (opcional)
 */
router.get(
  '/summary',
  authRequired,
  requireRole(['admin', 'cajero']),
  async (req, res) => {
    try {
      const { fromDate, toDate } = getDateRangeFromQuery(req.query);

      const sucursalIdFinal = await resolveSucursalId(
        prisma,
        req.query.sucursalId
      );

      // Agrupar pagos por método, sólo ventas CONFIRMADAS de la sucursal
      const pagosPorMetodo = await prisma.ventas_pagos.groupBy({
        by: ['metodo'],
        _sum: { monto: true },
        where: {
          ventas: {
            sucursal_id: sucursalIdFinal,
            estado: 'CONFIRMADA',
            fecha: {
              gte: fromDate,
              lte: toDate,
            },
          },
        },
      });

      let efectivo = 0;
      let transferencia = 0;
      let tarjeta = 0;

      for (const row of pagosPorMetodo) {
        const total = Number(row._sum.monto || 0);
        if (row.metodo === 'EFECTIVO') efectivo = total;
        if (row.metodo === 'TRANSFERENCIA') transferencia = total;
        if (row.metodo === 'TARJETA') tarjeta = total;
      }

      const totalGeneral = efectivo + transferencia + tarjeta;

      return res.json({
        ok: true,
        data: {
          sucursalId: sucursalIdFinal,
          rango: {
            from: fromDate,
            to: toDate,
          },
          totales: {
            efectivo,
            transferencia,
            tarjeta,
            general: totalGeneral,
          },
        },
      });
    } catch (err) {
      console.error('GET /api/cash/summary error', err);
      return res.status(400).json({
        ok: false,
        message: err.message || 'Error obteniendo resumen de caja',
      });
    }
  }
);

/**
 * POST /api/cash/close
 *
 * Genera un registro en cierres_caja a partir de las ventas del rango.
 *
 * Body:
 * {
 *   "sucursalId": "uuid-opcional",
 *   "from": "2025-11-29T00:00:00.000Z", // opcional
 *   "to":   "2025-11-29T23:59:59.999Z"  // opcional
 * }
 *
 * Si no mandas from/to => toma el día de hoy.
 */
router.post(
  '/close',
  authRequired,
  requireRole(['admin', 'cajero']),
  async (req, res) => {
    try {
      const { from, to, sucursalId } = req.body;

      const { fromDate, toDate } = getDateRangeFromQuery({
        from,
        to,
      });

      const sucursalIdFinal = await resolveSucursalId(
        prisma,
        sucursalId
      );

      const pagosPorMetodo = await prisma.ventas_pagos.groupBy({
        by: ['metodo'],
        _sum: { monto: true },
        where: {
          ventas: {
            sucursal_id: sucursalIdFinal,
            estado: 'CONFIRMADA',
            fecha: {
              gte: fromDate,
              lte: toDate,
            },
          },
        },
      });

      let efectivo = 0;
      let transferencia = 0;
      let tarjeta = 0;

      for (const row of pagosPorMetodo) {
        const total = Number(row._sum.monto || 0);
        if (row.metodo === 'EFECTIVO') efectivo = total;
        if (row.metodo === 'TRANSFERENCIA') transferencia = total;
        if (row.metodo === 'TARJETA') tarjeta = total;
      }

      const totalGeneral = efectivo + transferencia + tarjeta;

      // Puedes decidir si permites cierres en 0 o no.
      // Aquí permitimos el cierre aunque no haya ventas.
      const cierre = await prisma.cierres_caja.create({
        data: {
          sucursal_id: sucursalIdFinal,
          usuario_id: req.user.userId,
          fecha_inicio: fromDate,
          fecha_fin: toDate,
          total_efectivo: efectivo,
          total_transferencia: transferencia,
          total_tarjeta: tarjeta,
          total_general: totalGeneral,
        },
        include: {
          sucursales: true,
          usuarios: true,
        },
      });

      return res.status(201).json({
        ok: true,
        message: 'Cierre de caja registrado correctamente',
        data: {
          cierre,
          totales: {
            efectivo,
            transferencia,
            tarjeta,
            general: totalGeneral,
          },
        },
      });
    } catch (err) {
      console.error('POST /api/cash/close error', err);
      return res.status(400).json({
        ok: false,
        message: err.message || 'Error registrando cierre de caja',
      });
    }
  }
);

/**
 * GET /api/cash/closures
 *
 * Lista de cierres de caja (para reportes del admin).
 * Query:
 *   ?sucursalId=<uuid-opcional>
 *   ?limit=30 (por defecto 30)
 */
router.get(
  '/closures',
  authRequired,
  requireRole(['admin']),
  async (req, res) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 30;
      const sucursalId = req.query.sucursalId || null;

      const where = {};
      if (sucursalId) {
        where.sucursal_id = sucursalId;
      }

      const cierres = await prisma.cierres_caja.findMany({
        where,
        orderBy: { creado_en: 'desc' },
        take: limit,
        include: {
          sucursales: true,
          usuarios: true,
        },
      });

      return res.json({
        ok: true,
        data: {
          items: cierres,
        },
      });
    } catch (err) {
      console.error('GET /api/cash/closures error', err);
      return res.status(500).json({
        ok: false,
        message: 'Error cargando cierres de caja',
      });
    }
  }
);

module.exports = router;
