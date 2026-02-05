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

function toIntSafe(val) {
  if (val === null || val === undefined) return 0;
  const n = Number(val);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/**
 * ✅ Timezone de operación del negocio
 * (Guatemala). Esto evita bugs si el server está en UTC (Render suele estarlo).
 */
const BUSINESS_TZ = process.env.BUSINESS_TZ || 'America/Guatemala';
const AUTO_CLOSE_AT = { hour: 23, minute: 50 };

function tzParts(date, tz = BUSINESS_TZ) {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const parts = fmt.formatToParts(date);
    const map = {};
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = p.value;
    }

    return {
      year: Number(map.year),
      month: Number(map.month),
      day: Number(map.day),
      hour: Number(map.hour),
      minute: Number(map.minute),
      second: Number(map.second),
    };
  } catch (_) {
    // Fallback: timezone del server (no ideal, pero no revienta)
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      second: date.getSeconds(),
    };
  }
}

function tzYMD(date, tz = BUSINESS_TZ) {
  const p = tzParts(date, tz);
  const m = String(p.month).padStart(2, '0');
  const d = String(p.day).padStart(2, '0');
  return `${p.year}-${m}-${d}`;
}

/**
 * Offset (minutos) del timezone para un instante.
 * Técnica segura sin depender de "shortOffset".
 */
function tzOffsetMinutes(date, tz = BUSINESS_TZ) {
  const p = tzParts(date, tz);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const real = date.getTime();
  return Math.round((asUTC - real) / 60000);
}

/**
 * Construye un Date real (UTC) a partir de un “local time” en tz.
 * (Itera 2 veces por seguridad por cambios de offset/DST)
 */
function makeDateInTz(y, m, d, hh, mm, ss, tz = BUSINESS_TZ) {
  let guess = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
  for (let i = 0; i < 2; i++) {
    const off = tzOffsetMinutes(guess, tz);
    guess = new Date(Date.UTC(y, m - 1, d, hh, mm, ss) - off * 60000);
  }
  return guess;
}

function getTodayRangeInTz(tz = BUSINESS_TZ) {
  const now = new Date();
  const p = tzParts(now, tz);

  const start = makeDateInTz(p.year, p.month, p.day, 0, 0, 0, tz);

  // siguiente día (maneja cambios de mes/año)
  const tmp = new Date(Date.UTC(p.year, p.month - 1, p.day));
  tmp.setUTCDate(tmp.getUTCDate() + 1);
  const y2 = tmp.getUTCFullYear();
  const m2 = tmp.getUTCMonth() + 1;
  const d2 = tmp.getUTCDate();

  const end = makeDateInTz(y2, m2, d2, 0, 0, 0, tz);

  return { start, end };
}

function shouldAutoCloseCaja(cierreAbierto, tz = BUSINESS_TZ) {
  if (!cierreAbierto) return { should: false, reason: null, endTs: null };

  const now = new Date();

  const nowY = tzYMD(now, tz);
  const startDate = cierreAbierto.fecha_inicio
    ? new Date(cierreAbierto.fecha_inicio)
    : null;

  const openY = startDate ? tzYMD(startDate, tz) : nowY;

  // 1) Si ya es otro día (en GT) => cerrar al inicio del día actual (medianoche GT)
  if (openY !== nowY) {
    const today = tzParts(now, tz);
    const startOfToday = makeDateInTz(today.year, today.month, today.day, 0, 0, 0, tz);
    return { should: true, reason: 'DAY_CHANGE', endTs: startOfToday };
  }

  // 2) Si ya pasó el corte (23:50 GT) => cerrar EXACTAMENTE a las 23:50:00 GT
  const pNow = tzParts(now, tz);
  const mins = pNow.hour * 60 + pNow.minute;
  const threshold = AUTO_CLOSE_AT.hour * 60 + AUTO_CLOSE_AT.minute;

  if (mins >= threshold) {
    const cut = makeDateInTz(
      pNow.year,
      pNow.month,
      pNow.day,
      AUTO_CLOSE_AT.hour,
      AUTO_CLOSE_AT.minute,
      0,
      tz
    );
    return { should: true, reason: 'CUTOFF_2350', endTs: cut };
  }

  return { should: false, reason: null, endTs: null };
}

/**
 * ✅ Busca caja ABIERTA (según índice parcial: cerrado_at IS NULL)
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
 * ? Busca caja ABIERTA por sucursal (admin)
 */
async function findCajaAbiertaBySucursal(sucursalId) {
  try {
    const rows = await prisma.$queryRaw`
      SELECT *
      FROM public.cierres_caja
      WHERE sucursal_id = ${sucursalId}::uuid
        AND cerrado_at IS NULL
      ORDER BY fecha_inicio DESC
      LIMIT 1;
    `;
    return rows?.[0] || null;
  } catch (e) {
    const cierre = await prisma.cierres_caja.findFirst({
      where: {
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

/**
 * ✅ Cierre automático interno (sin monto contado, sin diferencia)
 */
async function closeCajaAutomatico(userId, sucursalId, cierreAbierto, endTs) {
  const startTs = cierreAbierto.fecha_inicio
    ? new Date(cierreAbierto.fecha_inicio)
    : new Date();

  let end = endTs instanceof Date ? endTs : new Date(endTs || new Date());

  // ✅ Paracaídas: evita rangos negativos por relojes/offsets raros
  if (end.getTime() < startTs.getTime()) {
    end = new Date(startTs);
  }

  const actualizado = await prisma.$transaction(async (tx) => {
    const totals = await getTotalesPagos(tx, sucursalId, userId, startTs, end);

    const efectivo = Number(totals.efectivo.toFixed(2));
    const transferencia = Number(totals.transferencia.toFixed(2));
    const tarjeta = Number(totals.tarjeta.toFixed(2));
    const totalGeneral = Number((efectivo + transferencia + tarjeta).toFixed(2));

    const cierreUpdate = await tx.cierres_caja.update({
      where: { id: cierreAbierto.id },
      data: {
        fecha_fin: end,

        total_efectivo: efectivo,
        total_transferencia: transferencia,
        total_tarjeta: tarjeta,
        total_general: totalGeneral,

        // en auto-cierre: no tenemos "contado", dejamos null
        monto_cierre_reportado: null,
        diferencia: null,
      },
    });

    await markCajaCerrada(tx, cierreAbierto.id);

    return cierreUpdate;
  });

  return actualizado;
}

/**
 * ✅ Ejecuta auto-cierre si corresponde.
 */
async function autoCloseIfNeeded(userId, sucursalId, cierreAbierto, opts = {}) {
  const allowCutoff = opts.allowCutoff !== false;

  const d = shouldAutoCloseCaja(cierreAbierto, BUSINESS_TZ);
  if (!d.should) return { closed: false, reason: null, cierre: null };

  if (!allowCutoff && d.reason === 'CUTOFF_2350') {
    return { closed: false, reason: null, cierre: null };
  }

  // Evitar doble cierre si ya está cerrada
  if (cierreAbierto.fecha_fin) {
    return { closed: false, reason: null, cierre: null };
  }

  const cierre = await closeCajaAutomatico(userId, sucursalId, cierreAbierto, d.endTs);
  return { closed: true, reason: d.reason, cierre };
}

/* =========================================================
 * ✅ NUEVO: RESUMEN MINI DASHBOARD (HOY) - para "Resumen"
 * - Totales por método (EFECTIVO / TARJETA / TRANSFERENCIA)
 * - # ventas confirmadas
 * - Producto más vendido (por qty)
 * - Categoría más vendida (por qty)
 * - Top 5 productos (opcional)
 *
 * ⚠️ No toca nada existente: solo agrega helpers + endpoint GET /summary/today
 * =======================================================*/

function getSummaryRangeInTz(tz = BUSINESS_TZ) {
  const now = new Date();
  const p = tzParts(now, tz);

  const start = makeDateInTz(p.year, p.month, p.day, 0, 0, 0, tz);
  const cutoff = makeDateInTz(p.year, p.month, p.day, AUTO_CLOSE_AT.hour, AUTO_CLOSE_AT.minute, 0, tz);

  // Si ya pasamos el corte, el resumen se “congela” en el corte (para que cuadre con caja)
  const end = now.getTime() >= cutoff.getTime() ? cutoff : now;

  return { start, end, cutoff };
}

async function getNumVentasConfirmadas(tx, sucursalId, userId, startTs, endTs) {
  const rows = await tx.$queryRaw`
    SELECT COALESCE(COUNT(*),0)::int AS n
    FROM ventas v
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
  return toIntSafe(r.n);
}

async function tryTopProductoCategoria(tx, sucursalId, userId, startTs, endTs) {
  // Intentamos con nombres comunes de detalle: ventas_detalle y luego ventas_items.
  // Si tu esquema usa otros nombres, cuando me pegues "sales" lo ajusto exacto.
  const timeExpr = `
    COALESCE(
      NULLIF(to_jsonb(v)->>'creado_en','')::timestamptz,
      NULLIF(to_jsonb(v)->>'fecha','')::timestamptz,
      NULLIF(to_jsonb(v)->>'created_at','')::timestamptz
    )
  `;

  const candidates = [
    { detalle: 'ventas_detalle', venta_fk: 'venta_id', qty: 'qty', precio: 'precio_unitario', total: 'total' },
    { detalle: 'ventas_items', venta_fk: 'venta_id', qty: 'qty', precio: 'precio_unitario', total: 'total' },
  ];

  for (const c of candidates) {
    try {
      // TOP PRODUCTO (por qty)
      const topProd = await tx.$queryRawUnsafe(
        `
        SELECT
          p.id AS producto_id,
          p.nombre,
          p.sku,
          p.categoria,
          COALESCE(SUM(d.${c.qty}),0)::int AS qty,
          COALESCE(SUM(COALESCE(d.${c.total}, (d.${c.qty} * d.${c.precio}))),0)::numeric AS total
        FROM ventas v
        JOIN ${c.detalle} d ON d.${c.venta_fk} = v.id
        JOIN productos p ON p.id = d.producto_id
        WHERE v.sucursal_id = $1::uuid
          AND v.usuario_id  = $2::uuid
          AND v.estado = 'CONFIRMADA'
          AND ${timeExpr} >= $3::timestamptz
          AND ${timeExpr} <  $4::timestamptz
        GROUP BY p.id, p.nombre, p.sku, p.categoria
        ORDER BY COALESCE(SUM(d.${c.qty}),0) DESC
        LIMIT 1
        `,
        sucursalId,
        userId,
        startTs,
        endTs
      );

      const topProdRow = Array.isArray(topProd) ? topProd[0] : null;

      // TOP CATEGORÍA (por qty)
      const topCat = await tx.$queryRawUnsafe(
        `
        SELECT
          COALESCE(p.categoria,'Sin categoría') AS categoria,
          COALESCE(SUM(d.${c.qty}),0)::int AS qty,
          COALESCE(SUM(COALESCE(d.${c.total}, (d.${c.qty} * d.${c.precio}))),0)::numeric AS total
        FROM ventas v
        JOIN ${c.detalle} d ON d.${c.venta_fk} = v.id
        JOIN productos p ON p.id = d.producto_id
        WHERE v.sucursal_id = $1::uuid
          AND v.usuario_id  = $2::uuid
          AND v.estado = 'CONFIRMADA'
          AND ${timeExpr} >= $3::timestamptz
          AND ${timeExpr} <  $4::timestamptz
        GROUP BY 1
        ORDER BY COALESCE(SUM(d.${c.qty}),0) DESC
        LIMIT 1
        `,
        sucursalId,
        userId,
        startTs,
        endTs
      );

      const topCatRow = Array.isArray(topCat) ? topCat[0] : null;

      // TOP 5 productos
      const top5 = await tx.$queryRawUnsafe(
        `
        SELECT
          p.id AS producto_id,
          p.nombre,
          p.sku,
          p.categoria,
          COALESCE(SUM(d.${c.qty}),0)::int AS qty,
          COALESCE(SUM(COALESCE(d.${c.total}, (d.${c.qty} * d.${c.precio}))),0)::numeric AS total
        FROM ventas v
        JOIN ${c.detalle} d ON d.${c.venta_fk} = v.id
        JOIN productos p ON p.id = d.producto_id
        WHERE v.sucursal_id = $1::uuid
          AND v.usuario_id  = $2::uuid
          AND v.estado = 'CONFIRMADA'
          AND ${timeExpr} >= $3::timestamptz
          AND ${timeExpr} <  $4::timestamptz
        GROUP BY p.id, p.nombre, p.sku, p.categoria
        ORDER BY COALESCE(SUM(d.${c.qty}),0) DESC
        LIMIT 5
        `,
        sucursalId,
        userId,
        startTs,
        endTs
      );

      return {
        topProducto: topProdRow
          ? {
              producto_id: String(topProdRow.producto_id),
              nombre: String(topProdRow.nombre || ''),
              sku: String(topProdRow.sku || ''),
              categoria: topProdRow.categoria ?? null,
              qty: toIntSafe(topProdRow.qty),
              total: Number(Number(topProdRow.total || 0).toFixed(2)),
            }
          : null,
        topCategoria: topCatRow
          ? {
              categoria: String(topCatRow.categoria || 'Sin categoría'),
              qty: toIntSafe(topCatRow.qty),
              total: Number(Number(topCatRow.total || 0).toFixed(2)),
            }
          : null,
        topProductos: Array.isArray(top5)
          ? top5.map((r) => ({
              producto_id: String(r.producto_id),
              nombre: String(r.nombre || ''),
              sku: String(r.sku || ''),
              categoria: r.categoria ?? null,
              qty: toIntSafe(r.qty),
              total: Number(Number(r.total || 0).toFixed(2)),
            }))
          : [],
      };
    } catch (e) {
      // Si no existe la tabla/columna, probamos el siguiente candidato.
      continue;
    }
  }

  return { topProducto: null, topCategoria: null, topProductos: [] };
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
      const roleNorm = String(req.user?.roleName ?? '').trim().toUpperCase();
      const scope = String(req.query?.scope ?? '').trim().toUpperCase();

      const sucursal = await resolveSucursalForUser(userId);
      if (!sucursal) {
        return res.status(400).json({
          ok: false,
          message:
            'No se encontró una sucursal válida (asigna usuarios.sucursal_id o crea SP).',
        });
      }

      // ✅ NUEVO: siempre devolvemos autoclose (para que el frontend detecte)
      const autoclose = { closed: false, reason: null };

      // ? Primero: si hay caja ABIERTA (sin importar si cruz¢ medianoche)
      const adminScopeSucursal = roleNorm === 'ADMIN' && scope === 'SUCURSAL';
      let abierta = adminScopeSucursal
        ? await findCajaAbiertaBySucursal(sucursal.id)
        : await findCajaAbierta(userId, sucursal.id);

      // ? Auto-cierre en backend (23:50 o cambio de d¡a GT)
      // ? En admin (scope sucursal) NO cerramos autom ticamente
      if (abierta && !adminScopeSucursal) {
        try {
          const r = await autoCloseIfNeeded(userId, sucursal.id, abierta, {
            allowCutoff: true,
          });

          if (r?.closed) {
            autoclose.closed = true;
            autoclose.reason = r.reason || null;

            // Si se cerró, ya NO devolvemos "ABIERTA"
            abierta = null;
          }
        } catch (e) {
          // Si el auto-cierre falla, NO rompemos la operación
          console.error('Auto-cierre falló (today):', e);
        }
      }

      if (abierta) {
        return res.json({
          ok: true,
          data: {
            estado: 'ABIERTA',
            cierreActual: abierta,
            autoclose, // ✅ añadido
          },
        });
      }

      // Si no hay abierta, mostramos la última de HOY (en timezone GT)
      const { start, end } = getTodayRangeInTz(BUSINESS_TZ);

      const cierre = await prisma.cierres_caja.findFirst({
        where: {
          sucursal_id: sucursal.id,
          ...(roleNorm === 'ADMIN' && scope === 'SUCURSAL'
            ? {}
            : { usuario_id: userId }),
          fecha_inicio: { gte: start, lt: end },
        },
        orderBy: { fecha_inicio: 'desc' },
      });

      let estado = 'SIN_APERTURA';
      if (cierre) {
        const nowY = tzYMD(new Date(), BUSINESS_TZ);
        const cierreY = tzYMD(new Date(cierre.fecha_inicio), BUSINESS_TZ);
        if (cierreY !== nowY) {
          cierre = null;
        }
      }
      if (cierre) estado = cierre.fecha_fin ? 'CERRADA' : 'ABIERTA';

      return res.json({
        ok: true,
        data: {
          estado,
          cierreActual: cierre,
          autoclose, // ✅ añadido
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

// ✅ NUEVO: GET /api/cash-register/summary/today
router.get(
  '/summary/today',
  authRequired,
  requireRole(['admin', 'cajero']),
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const roleNorm = String(req.user?.roleName ?? '').trim().toUpperCase();
      const scope = String(req.query?.scope ?? '').trim().toUpperCase();

      const sucursal = await resolveSucursalForUser(userId);
      if (!sucursal) {
        return res.status(400).json({
          ok: false,
          message:
            'No se encontró una sucursal válida (asigna usuarios.sucursal_id o crea SP).',
        });
      }

      // (No rompe nada) Si hubiera una caja abierta que ya debería autocerrar, lo cerramos aquí también.
      try {
        const abierta = await findCajaAbierta(userId, sucursal.id);
        if (abierta) {
          await autoCloseIfNeeded(userId, sucursal.id, abierta, { allowCutoff: true });
        }
      } catch (e) {
        // silencioso: el resumen no debe fallar por esto
      }

      const { start, end } = getSummaryRangeInTz(BUSINESS_TZ);

      const data = await prisma.$transaction(async (tx) => {
        const totals = await getTotalesPagos(tx, sucursal.id, userId, start, end);
        const numVentas = await getNumVentasConfirmadas(tx, sucursal.id, userId, start, end);

        const efectivo = Number(totals.efectivo.toFixed(2));
        const transferencia = Number(totals.transferencia.toFixed(2));
        const tarjeta = Number(totals.tarjeta.toFixed(2));
        const totalGeneral = Number((efectivo + transferencia + tarjeta).toFixed(2));

        const tops = await tryTopProductoCategoria(tx, sucursal.id, userId, start, end);

        return {
          date: tzYMD(new Date(), BUSINESS_TZ),
          total_general: totalGeneral,
          total_efectivo: efectivo,
          total_transferencia: transferencia,
          total_tarjeta: tarjeta,
          num_ventas: numVentas,
          top_producto: tops.topProducto,
          top_categoria: tops.topCategoria,
          top_productos: tops.topProductos,
          updated_at: new Date().toISOString(),
        };
      });

      // no-cache para “tiempo real” por polling
      res.setHeader('Cache-Control', 'no-store');

      return res.json({ ok: true, data });
    } catch (err) {
      console.error('GET /api/cash-register/summary/today error', err);
      return res.status(500).json({
        ok: false,
        message: 'Error generando resumen del día',
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
      const roleNorm = String(req.user?.roleName ?? '').trim().toUpperCase();
      const scope = String(req.query?.scope ?? '').trim().toUpperCase();

      const sucursal = await resolveSucursalForUser(userId);
      if (!sucursal) {
        return res.status(400).json({
          ok: false,
          message:
            'No se encontró una sucursal válida (asigna usuarios.sucursal_id o crea SP).',
        });
      }

      // ✅ si hay una ABIERTA de otro día, la cerramos automáticamente para permitir abrir
      let abierta = await findCajaAbierta(userId, sucursal.id);
      if (abierta) {
        try {
          // aquí NO cerramos por 23:50 (solo por cambio de día)
          const r = await autoCloseIfNeeded(userId, sucursal.id, abierta, {
            allowCutoff: false,
          });
          if (r.closed) {
            abierta = null;
          }
        } catch (e) {
          console.error('Auto-cierre falló (open):', e);
        }
      }

      // ✅ bloqueamos por "si existe una ABIERTA"
      if (!abierta) {
        abierta = await findCajaAbierta(userId, sucursal.id);
      }

      if (abierta) {
        return res.status(409).json({
          ok: false,
          code: 'CAJA_YA_ABIERTA',
          message: 'Ya tienes una caja abierta en esta sucursal. Primero ciérrala para abrir otra.',
          data: { cierre: abierta },
        });
      }

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

          monto_apertura: Number(montoApertura.toFixed(2)),

          total_efectivo: 0,
          total_transferencia: 0,
          total_tarjeta: 0,
          total_general: 0,
        },
      });

      return res.status(201).json({
        ok: true,
        message: 'Caja abierta correctamente.',
        data: { cierre: nuevo },
      });
    } catch (err) {
      console.error('POST /api/cash-register/open error', err);

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
      const roleNorm = String(req.user?.roleName ?? '').trim().toUpperCase();
      const scope = String(req.query?.scope ?? '').trim().toUpperCase();

      const sucursal = await resolveSucursalForUser(userId);
      if (!sucursal) {
        return res.status(400).json({
          ok: false,
          message:
            'No se encontró una sucursal válida (asigna usuarios.sucursal_id o crea SP).',
        });
      }

      const cierreAbierto = await findCajaAbierta(userId, sucursal.id);

      if (!cierreAbierto) {
        return res
          .status(400)
          .json({ ok: false, message: 'No hay caja abierta para cerrar.' });
      }

      if (cierreAbierto.fecha_fin) {
        return res.status(400).json({
          ok: false,
          message: 'La caja ya está cerrada.',
        });
      }

      const startTs = cierreAbierto.fecha_inicio ? new Date(cierreAbierto.fecha_inicio) : new Date();
      const endTs = new Date();

      const actualizado = await prisma.$transaction(async (tx) => {
        const totals = await getTotalesPagos(tx, sucursal.id, userId, startTs, endTs);

        let efectivo = Number(totals.efectivo.toFixed(2));
        let transferencia = Number(totals.transferencia.toFixed(2));
        let tarjeta = Number(totals.tarjeta.toFixed(2));

        const totalGeneral = Number((efectivo + transferencia + tarjeta).toFixed(2));

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

        const apertura = toNumberSafe(cierreAbierto.monto_apertura ?? 0);
        const efectivoEsperado = Number((apertura + efectivo).toFixed(2));

        const diferencia =
          montoCierreReportado === null
            ? null
            : Number((montoCierreReportado - efectivoEsperado).toFixed(2));

        const cierreUpdate = await prisma.cierres_caja.update({
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
// =======================================================
router.get(
  '/history',
  authRequired,
  requireRole(['admin']),
  async (req, res) => {
    try {
      const { from, to, userId } = req.query;

      const where = {};

      if (from || to) {
        const start = from ? new Date(String(from)) : new Date('2000-01-01');
        const end = to ? new Date(String(to)) : new Date('2100-01-01');
        where.fecha_inicio = { gte: start, lt: end };
      }

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
          items: cierres,
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
