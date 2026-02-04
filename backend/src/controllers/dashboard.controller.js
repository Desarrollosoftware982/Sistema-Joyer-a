const prisma = require("../config/prisma");
const salesController = require("./sales.controller");

async function resolveSucursalIdForUser(userId) {
  const user = await prisma.usuarios.findUnique({
    where: { id: userId },
    select: { sucursal_id: true },
  });

  if (user?.sucursal_id) return user.sucursal_id;

  const sp = await prisma.sucursales.findFirst({
    where: { codigo: "SP" },
    select: { id: true },
  });

  return sp?.id ?? null;
}

function toNumberSafe(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return Number.isFinite(val) ? val : 0;
  if (val && typeof val === "object" && typeof val.toNumber === "function") {
    const n = val.toNumber();
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

async function getCostoTotalVentas({ sucursalId, userIdOrNull, startTs, endTs }) {
  if (userIdOrNull) {
    const rows = await prisma.$queryRaw`
      SELECT
        COALESCE(SUM(vd.cantidad * COALESCE(p.costo_promedio, p.costo_ultimo, 0)), 0) AS costo_total
      FROM ventas v
      JOIN ventas_detalle vd ON vd.venta_id = v.id
      JOIN productos p ON p.id = vd.producto_id
      WHERE v.sucursal_id = ${sucursalId}::uuid
        AND v.usuario_id  = ${userIdOrNull}::uuid
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
    return toNumberSafe(rows?.[0]?.costo_total);
  }

  const rows = await prisma.$queryRaw`
    SELECT
      COALESCE(SUM(vd.cantidad * COALESCE(p.costo_promedio, p.costo_ultimo, 0)), 0) AS costo_total
    FROM ventas v
    JOIN ventas_detalle vd ON vd.venta_id = v.id
    JOIN productos p ON p.id = vd.producto_id
    WHERE v.sucursal_id = ${sucursalId}::uuid
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
  return toNumberSafe(rows?.[0]?.costo_total);
}

async function dashboardSummary(req, res) {
  try {
    const usuarioId = req.user?.userId;
    if (!usuarioId) return res.status(401).json({ ok: false, message: "No autenticado" });

    const roleNorm = String(req.user?.roleName ?? "").trim().toUpperCase();
    const scopeReq = String(req.query?.scope ?? "").trim().toUpperCase();
    const scope = scopeReq || (roleNorm === "ADMIN" ? "SUCURSAL" : "USER");

    let sucursalId = await resolveSucursalIdForUser(usuarioId);
    if (roleNorm === "ADMIN" && req.query?.sucursal_id) {
      sucursalId = String(req.query.sucursal_id);
    }

    if (!sucursalId) {
      return res.status(400).json({
        ok: false,
        message: "sucursal_id es requerido (asigna usuarios.sucursal_id o crea SP).",
      });
    }

    const dateStr = req.query?.date ? String(req.query.date) : null;
    const data = await salesController.buildSummaryData({
      usuarioId,
      roleNorm,
      scope,
      sucursalId,
      dateStr,
    });

    const totalVentasDia = toNumberSafe(data?.totals?.total_general);
    const totalTicketsDia = Number(data?.totals?.num_ventas || 0);
    const ticketPromedio = totalTicketsDia > 0 ? totalVentasDia / totalTicketsDia : 0;

    const startTs = new Date(data.range?.start || new Date());
    const endTs = new Date(data.range?.end || new Date());
    const userIdOrNull = scope === "USER" ? usuarioId : null;
    const costoTotal = await getCostoTotalVentas({
      sucursalId,
      userIdOrNull,
      startTs,
      endTs,
    });

    const utilidadBrutaDia = totalVentasDia - costoTotal;

    const porMetodo = [
      { metodo: "EFECTIVO", monto: toNumberSafe(data?.totals?.efectivo) },
      { metodo: "TRANSFERENCIA", monto: toNumberSafe(data?.totals?.transferencia) },
      { metodo: "TARJETA", monto: toNumberSafe(data?.totals?.tarjeta) },
    ];

    return res.json({
      ok: true,
      data: {
        totalVentasDia,
        totalTicketsDia,
        ticketPromedio,
        utilidadBrutaDia,
        porMetodo,
      },
    });
  } catch (err) {
    console.error("dashboardSummary error:", err);
    return res.status(500).json({ ok: false, message: "Error resumen dashboard" });
  }
}

async function dashboardTopProducts(req, res) {
  try {
    const usuarioId = req.user?.userId;
    if (!usuarioId) return res.status(401).json({ ok: false, message: "No autenticado" });

    const roleNorm = String(req.user?.roleName ?? "").trim().toUpperCase();
    const scopeReq = String(req.query?.scope ?? "").trim().toUpperCase();
    const scope = scopeReq || (roleNorm === "ADMIN" ? "SUCURSAL" : "USER");

    let sucursalId = await resolveSucursalIdForUser(usuarioId);
    if (roleNorm === "ADMIN" && req.query?.sucursal_id) {
      sucursalId = String(req.query.sucursal_id);
    }

    if (!sucursalId) {
      return res.status(400).json({
        ok: false,
        message: "sucursal_id es requerido (asigna usuarios.sucursal_id o crea SP).",
      });
    }

    const dateStr = req.query?.date ? String(req.query.date) : null;
    const data = await salesController.buildSummaryData({
      usuarioId,
      roleNorm,
      scope,
      sucursalId,
      dateStr,
    });

    const items = Array.isArray(data?.top_productos)
      ? data.top_productos.map((p) => ({
          id: String(p.producto_id),
          sku: String(p.sku || ""),
          nombre: String(p.nombre || ""),
          unidades: Number(p.qty || 0),
          facturacion: toNumberSafe(p.total),
        }))
      : [];

    return res.json({ ok: true, items });
  } catch (err) {
    console.error("dashboardTopProducts error:", err);
    return res.status(500).json({ ok: false, message: "Error top productos" });
  }
}

async function dashboardLowStock(req, res) {
  try {
    const rows = await prisma.$queryRaw`
      SELECT * FROM vw_stock_bajo
      ORDER BY nombre ASC
    `;
    return res.json({ ok: true, items: rows });
  } catch (err) {
    console.error("dashboardLowStock error:", err);
    return res.status(500).json({ ok: false, message: "Error stock bajo" });
  }
}

async function dashboardLastSales(req, res) {
  try {
    const usuarioId = req.user?.userId;
    if (!usuarioId) return res.status(401).json({ ok: false, message: "No autenticado" });

    const roleNorm = String(req.user?.roleName ?? "").trim().toUpperCase();
    const scopeReq = String(req.query?.scope ?? "").trim().toUpperCase();
    const scope = scopeReq || (roleNorm === "ADMIN" ? "SUCURSAL" : "USER");

    let sucursalId = await resolveSucursalIdForUser(usuarioId);
    if (roleNorm === "ADMIN" && req.query?.sucursal_id) {
      sucursalId = String(req.query.sucursal_id);
    }

    if (!sucursalId) {
      return res.status(400).json({
        ok: false,
        message: "sucursal_id es requerido (asigna usuarios.sucursal_id o crea SP).",
      });
    }

    const rows = await prisma.$queryRaw`
      SELECT
        v.id,
        COALESCE(v.cliente_nombre, c.nombre, '') AS cliente,
        COALESCE(
          NULLIF(to_jsonb(v)->>'creado_en','')::timestamptz,
          NULLIF(to_jsonb(v)->>'fecha','')::timestamptz,
          NULLIF(to_jsonb(v)->>'created_at','')::timestamptz
        ) AS fecha,
        v.total,
        COALESCE(string_agg(DISTINCT vp.metodo::text, ' + '), '') AS metodo
      FROM ventas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      LEFT JOIN ventas_pagos vp ON vp.venta_id = v.id
      WHERE v.sucursal_id = ${sucursalId}::uuid
        AND v.estado = 'CONFIRMADA'
        AND (${scope}::text <> 'USER' OR v.usuario_id = ${usuarioId}::uuid)
      GROUP BY v.id, cliente, fecha, v.total
      ORDER BY fecha DESC NULLS LAST
      LIMIT 10;
    `;

    const items = (rows || []).map((r) => ({
      id: String(r.id),
      fecha: r.fecha,
      cliente: String(r.cliente || ""),
      total: toNumberSafe(r.total),
      metodo: String(r.metodo || ""),
    }));

    return res.json({ ok: true, items });
  } catch (err) {
    console.error("dashboardLastSales error:", err);
    return res.status(500).json({ ok: false, message: "Error ultimas ventas" });
  }
}

module.exports = {
  dashboardSummary,
  dashboardTopProducts,
  dashboardLowStock,
  dashboardLastSales,
};
