// src/routes/cashRegister.routes.js
const express = require('express');
const prisma = require('../config/prisma');
const { authRequired, requireRole } = require('../middlewares/auth');

const router = express.Router();

function getTodayRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { start, end };
}

/**
 * ✅ MODO CORPORACIÓN:
 * - Toma la sucursal desde usuarios.sucursal_id
 * - Fallback a SP para no romper nada si algún usuario aún no está asignado
 */
async function resolveSucursalForUser(userId) {
  // 1) Intentar por sucursal asignada al usuario
  const user = await prisma.usuarios.findUnique({
    where: { id: userId },
    select: { sucursal_id: true },
  });

  if (user?.sucursal_id) {
    const suc = await prisma.sucursales.findUnique({
      where: { id: user.sucursal_id },
    });
    if (suc) return suc;
  }

  // 2) Fallback seguro a SP (compatibilidad)
  const sp = await prisma.sucursales.findFirst({
    where: { codigo: 'SP' },
  });
  return sp || null;
}

/* =========================================================
 *  ✅ HELPERS NUEVOS (NO ROMPEN LO EXISTENTE)
 * =======================================================*/

function toNumberSafe(val) {
  if (val === null || val === undefined) return 0;
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

/**
 * ✅ Busca caja ABIERTA (según índice parcial: cerrado_at IS NULL)
 * - Usamos SQL directo para no depender de que Prisma tenga el campo cerrado_at en schema.prisma.
 * - Si por alguna razón cerrado_at no existiera, cae a fallback por fecha_fin IS NULL.
 */
async function findCajaAbierta(userId, sucursalId) {
  try {
    const rows = await prisma.$queryRaw`
      SELECT *
      FROM public.cierres_caja
      WHERE usuario_id = ${userId}::uuid
        AND sucursal_id = ${sucursalId}::uuid
        AND cerrado_at IS NULL
      ORDER BY fecha_inicio DESC
      LIMIT 1;
    `;
    return rows?.[0] || null;
  } catch (e) {
    // Fallback seguro: si no existiera cerrado_at, usar fecha_fin
    const cierre = await prisma.cierres_caja.findFirst({
      where: {
        usuario_id: userId,
        sucursal_id: sucursalId,
        fecha_fin: null,
      },
      orderBy: { fecha_inicio: 'desc' },
    });
    return cierre || null;
  }
}

/**
 * ✅ Marca una caja como cerrada (cerrado_at = now()) vía SQL directo
 * - No depende del schema Prisma.
 */
async function markCajaCerrada(tx, cierreId) {
  try {
    await tx.$executeRaw`
      UPDATE public.cierres_caja
      SET cerrado_at = now()
      WHERE id = ${cierreId}::uuid;
    `;
  } catch (_) {
    // si no existe la columna, no hacemos nada (compatibilidad)
  }
}

/**
 * ✅ Obtiene totales de pagos para un rango
 * - Intentamos usar creado_en / fecha / created_at si existen (sin reventar si no)
 */
async function getTotalesPagos(tx, sucursalId, userId, startTs, endTs) {
  const rows = await tx.$queryRaw`
    SELECT
      COALESCE(SUM(CASE WHEN vp.metodo = 'EFECTIVO' THEN vp.monto ELSE 0 END), 0) AS efectivo,
      COALESCE(SUM(CASE WHEN vp.metodo = 'TRANSFERENCIA' THEN vp.monto ELSE 0 END), 0) AS transferencia,
      COALESCE(SUM(CASE WHEN vp.metodo = 'TARJETA' THEN vp.monto ELSE 0 END), 0) AS tarjeta
    FROM ventas v
    JOIN ventas_pagos vp ON vp.venta_id = v.id
    WHERE v.sucursal_id = ${sucursalId}::uuid
      AND v.usuario_id  = ${userId}::uuid
      AND v.estado = 'CONFIRMADA'
      AND COALESCE(
        NULLIF(to_jsonb(v)->>'creado_en','')::timestamptz,
        NULLIF(to_jsonb(v)->>'fecha','')::timestamptz,
        NULLIF(to_jsonb(v)->>'created_at','')::timestamptz
      ) >= ${startTs}::timestamptz
      AND COALESCE(
        NULLIF(to_jsonb(v)->>'creado_en','')::timestamptz,
        NULLIF(to_jsonb(v)->>'fecha','')::timestamptz,
        NULLIF(to_jsonb(v)->>'created_at','')::timestamptz
      ) < ${endTs}::timestamptz;
  `;

  const r = rows?.[0] || {};
  return {
    efectivo: toNumberSafe(r.efectivo),
    transferencia: toNumberSafe(r.transferencia),
    tarjeta: toNumberSafe(r.tarjeta),
  };
}

// =======================================================
//  CIERRE DEL DÍA (CAJERO / POS)
// =======================================================

// GET /api/cash-register/today
router.get(
  '/today',
  authRequired,
  requireRole(['admin', 'cajero']),
  async (req, res) => {
    try {
      const userId = req.user.userId;

      const sucursal = await resolveSucursalForUser(userId);
      if (!sucursal) {
        return res.status(400).json({
          ok: false,
          message:
            'No se encontró una sucursal válida (asigna usuarios.sucursal_id o crea SP).',
        });
      }

      // ✅ Primero: si hay caja ABIERTA (sin importar si cruzó medianoche)
      const abierta = await findCajaAbierta(userId, sucursal.id);
      if (abierta) {
        return res.json({
          ok: true,
          data: {
            estado: 'ABIERTA',
            cierreActual: abierta,
          },
        });
      }

      // Si no hay abierta, mostramos la última de HOY (si existe)
      const { start, end } = getTodayRange();

      const cierre = await prisma.cierres_caja.findFirst({
        where: {
          sucursal_id: sucursal.id,
          usuario_id: userId,
          fecha_inicio: { gte: start, lt: end },
        },
        orderBy: { fecha_inicio: 'desc' }, // ✅ antes estaba asc
      });

      let estado = 'SIN_APERTURA';
      if (cierre) estado = cierre.fecha_fin ? 'CERRADA' : 'ABIERTA';

      return res.json({
        ok: true,
        data: {
          estado,
          cierreActual: cierre,
        },
      });
    } catch (err) {
      console.error('GET /api/cash-register/today error', err);
      return res.status(500).json({
        ok: false,
        message: 'Error obteniendo estado de caja del día',
      });
    }
  }
);

// POST /api/cash-register/open
router.post(
  '/open',
  authRequired,
  requireRole(['admin', 'cajero']),
  async (req, res) => {
    try {
      const userId = req.user.userId;

      const sucursal = await resolveSucursalForUser(userId);
      if (!sucursal) {
        return res.status(400).json({
          ok: false,
          message:
            'No se encontró una sucursal válida (asigna usuarios.sucursal_id o crea SP).',
        });
      }

      // ✅ NUEVO: ya NO bloqueamos por "hoy"
      //           bloqueamos por "si existe una ABIERTA" (cerrado_at IS NULL)
      const abierta = await findCajaAbierta(userId, sucursal.id);
      if (abierta) {
        return res.status(409).json({
          ok: false,
          code: 'CAJA_YA_ABIERTA',
          message: 'Ya tienes una caja abierta en esta sucursal. Primero ciérrala para abrir otra.',
          data: { cierre: abierta },
        });
      }

      // ✅ NUEVO: monto_apertura (efectivo inicial)
      const montoAperturaRaw =
        req.body?.monto_apertura ?? req.body?.montoApertura ?? 0;
      const montoApertura = Number(montoAperturaRaw);

      if (!Number.isFinite(montoApertura) || montoApertura < 0) {
        return res.status(400).json({
          ok: false,
          message: 'monto_apertura inválido (debe ser un número >= 0).',
        });
      }

      const nuevo = await prisma.cierres_caja.create({
        data: {
          sucursal_id: sucursal.id,
          usuario_id: userId,
          fecha_inicio: new Date(),
          fecha_fin: null,

          // ✅ NUEVO
          monto_apertura: Number(montoApertura.toFixed(2)),

          // lo que ya tenías
          total_efectivo: 0,
          total_transferencia: 0,
          total_tarjeta: 0,
          total_general: 0,

          // ✅ opcionales quedan null por defecto
          // monto_cierre_reportado: null,
          // diferencia: null,
        },
      });

      return res.status(201).json({
        ok: true,
        message: 'Caja abierta correctamente.',
        data: { cierre: nuevo },
      });
    } catch (err) {
      console.error('POST /api/cash-register/open error', err);

      // ✅ Si por carrera (2 requests) tronó el índice único parcial
      if (err && err.code === 'P2002') {
        return res.status(409).json({
          ok: false,
          code: 'CAJA_YA_ABIERTA',
          message: 'Ya existe una caja abierta para este usuario en esta sucursal.',
        });
      }

      return res.status(500).json({
        ok: false,
        message: 'Error al abrir caja',
      });
    }
  }
);

// POST /api/cash-register/close
router.post(
  '/close',
  authRequired,
  requireRole(['admin', 'cajero']),
  async (req, res) => {
    try {
      const userId = req.user.userId;

      const sucursal = await resolveSucursalForUser(userId);
      if (!sucursal) {
        return res.status(400).json({
          ok: false,
          message:
            'No se encontró una sucursal válida (asigna usuarios.sucursal_id o crea SP).',
        });
      }

      // ✅ Cerrar la caja ABIERTA (no "la de hoy" necesariamente)
      const cierreAbierto = await findCajaAbierta(userId, sucursal.id);

      if (!cierreAbierto) {
        return res
          .status(400)
          .json({ ok: false, message: 'No hay caja abierta para cerrar.' });
      }

      // (No rompe nada; evita doble cierre accidental)
      if (cierreAbierto.fecha_fin) {
        return res.status(400).json({
          ok: false,
          message: 'La caja ya está cerrada.',
        });
      }

      // ✅ Rango: desde que se abrió esta caja hasta ahora
      const startTs = cierreAbierto.fecha_inicio ? new Date(cierreAbierto.fecha_inicio) : new Date();
      const endTs = new Date();

      const actualizado = await prisma.$transaction(async (tx) => {
        // Totales por método (desde apertura)
        const totals = await getTotalesPagos(tx, sucursal.id, userId, startTs, endTs);

        let efectivo = Number(totals.efectivo.toFixed(2));
        let transferencia = Number(totals.transferencia.toFixed(2));
        let tarjeta = Number(totals.tarjeta.toFixed(2));

        const totalGeneral = Number((efectivo + transferencia + tarjeta).toFixed(2));

        // ✅ NUEVO (opcional): monto_cierre_reportado y diferencia
        const cierreReportadoRaw =
          req.body?.monto_cierre_reportado ??
          req.body?.montoCierreReportado ??
          null;

        let montoCierreReportado = null;
        if (
          cierreReportadoRaw !== null &&
          cierreReportadoRaw !== undefined &&
          cierreReportadoRaw !== ''
        ) {
          const n = Number(cierreReportadoRaw);
          if (!Number.isFinite(n) || n < 0) {
            const e = new Error(
              'monto_cierre_reportado inválido (debe ser un número >= 0 o null).'
            );
            e.statusCode = 400;
            throw e;
          }
          montoCierreReportado = Number(n.toFixed(2));
        }

        // Efectivo esperado = apertura + ventas en efectivo
        const apertura = toNumberSafe(cierreAbierto.monto_apertura ?? 0);
        const efectivoEsperado = Number((apertura + efectivo).toFixed(2));

        const diferencia =
          montoCierreReportado === null
            ? null
            : Number((montoCierreReportado - efectivoEsperado).toFixed(2));

        // Actualiza lo que ya tenías
        const cierreUpdate = await tx.cierres_caja.update({
          where: { id: cierreAbierto.id },
          data: {
            fecha_fin: new Date(),

            total_efectivo: efectivo,
            total_transferencia: transferencia,
            total_tarjeta: tarjeta,
            total_general: totalGeneral,

            monto_cierre_reportado: montoCierreReportado,
            diferencia: diferencia,
          },
        });

        // ✅ CLAVE: marcar como cerrada para liberar el índice parcial
        await markCajaCerrada(tx, cierreAbierto.id);

        return cierreUpdate;
      });

      return res.json({
        ok: true,
        message: 'Caja cerrada correctamente.',
        data: { cierre: actualizado },
      });
    } catch (err) {
      console.error('POST /api/cash-register/close error', err);

      if (err && err.statusCode === 400) {
        return res.status(400).json({ ok: false, message: err.message });
      }

      return res.status(500).json({
        ok: false,
        message: 'Error al cerrar caja',
      });
    }
  }
);

// =======================================================
//  HISTORIAL DE CIERRES (ADMIN - REPORTES)
//  GET /api/cash-register/history?from=YYYY-MM-DD&to=YYYY-MM-DD&userId=...
// =======================================================
router.get(
  '/history',
  authRequired,
  requireRole(['admin']),
  async (req, res) => {
    try {
      const { from, to, userId } = req.query;

      const where = {};

      // Rango de fechas opcional
      if (from || to) {
        const start = from ? new Date(String(from)) : new Date('2000-01-01');
        const end = to ? new Date(String(to)) : new Date('2100-01-01');
        where.fecha_inicio = { gte: start, lt: end };
      }

      // Filtro opcional por usuario
      if (userId) {
        where.usuario_id = String(userId);
      }

      const cierres = await prisma.cierres_caja.findMany({
        where,
        orderBy: { fecha_inicio: 'desc' },
        take: 100,
        include: {
          usuarios: {
            select: { nombre: true, email: true },
          },
          sucursales: {
            select: { nombre: true, codigo: true },
          },
        },
      });

      return res.json({
        ok: true,
        data: {
          items: cierres, // lo que espera el frontend (json.data.items)
        },
      });
    } catch (err) {
      console.error('GET /api/cash-register/history error', err);
      return res.status(500).json({
        ok: false,
        message: 'Error cargando historial de cierres',
      });
    }
  }
);

module.exports = router;
