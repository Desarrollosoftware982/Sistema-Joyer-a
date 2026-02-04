const ExcelJS = require("exceljs");
const prisma = require("../config/prisma");

function mustISODate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function isUuid(s) {
  return typeof s === "string" && /^[0-9a-fA-F-]{36}$/.test(s);
}

function toNum(x) {
  if (x === null || x === undefined) return 0;
  if (typeof x === "number") return x;
  if (typeof x === "string") return Number(x);
  if (typeof x === "bigint") return Number(x);
  if (typeof x?.toNumber === "function") return x.toNumber(); // Prisma Decimal
  if (typeof x?.toString === "function") return Number(x.toString());
  return Number(x);
}

function fmtDateTime(d) {
  if (!d) return "";
  const dt = new Date(d);
  return dt.toISOString().replace("T", " ").slice(0, 19);
}

function qfmt(cell) {
  cell.numFmt = '#,##0.00';
}

exports.exportReporteVentasExcel = async (req, res) => {
  try {
    const { from, to, metodo, sucursal_id, usuario_id } = req.query;

    // Validación básica
    if (!mustISODate(from) || !mustISODate(to)) {
      return res.status(400).send("Parámetros inválidos: from/to deben ser YYYY-MM-DD");
    }

    const metodoFilter = metodo ? String(metodo) : null;
    const allowed = new Set(["EFECTIVO", "TRANSFERENCIA", "TARJETA"]);
    if (metodoFilter && !allowed.has(metodoFilter)) {
      return res.status(400).send("Método inválido. Use EFECTIVO | TRANSFERENCIA | TARJETA");
    }

    const sucursalId = sucursal_id ? String(sucursal_id) : null;
    if (sucursalId && !isUuid(sucursalId)) {
      return res.status(400).send("sucursal_id inv�lido (debe ser UUID)");
    }

    const usuarioId = usuario_id ? String(usuario_id) : null;
    if (usuarioId && !isUuid(usuarioId)) {
      return res.status(400).send("usuario_id inv�lido (debe ser UUID)");
    }

    // ✅ Fechas: uso offset Guatemala (-06:00) para que el filtro por día no se corra en servers UTC
    // Si su server está en Guatemala también, igual funciona bien.
    const fromDate = new Date(`${from}T00:00:00-06:00`);
    const toDate = new Date(`${to}T00:00:00-06:00`); // "to" viene como exclusivo desde el frontend

    // Query Prisma
    const where = {
      fecha: { gte: fromDate, lt: toDate },
      estado: "CONFIRMADA",
      ...(sucursalId ? { sucursal_id: sucursalId } : {}),
      ...(usuarioId ? { usuario_id: usuarioId } : {}),
      ...(metodoFilter
        ? { ventas_pagos: { some: { metodo: metodoFilter } } }
        : {}),
    };

    const ventas = await prisma.ventas.findMany({
      where,
      orderBy: { fecha: "asc" },
      include: {
        clientes: true, // por si cliente_nombre viene nulo
        ventas_detalle: {
          include: { productos: true },
        },
        ventas_pagos: true,
      },
    });

    // =========================
    // Cálculos de totales
    // =========================
    const totalesPorMetodo = {
      EFECTIVO: 0,
      TRANSFERENCIA: 0,
      TARJETA: 0,
    };

    let totalVentas = ventas.length;
    let totalMontoVentas = 0;      // suma ventas.total
    let totalMontoPagos = 0;       // suma ventas_pagos.monto
    let totalMontoItems = 0;       // suma ventas_detalle.total_linea

    // =========================
    // Excel
    // =========================
    const wb = new ExcelJS.Workbook();
    wb.creator = "Sistema Joyería";

    // ---- Hoja Resumen
    const wsR = wb.addWorksheet("Resumen");
    wsR.columns = [
      { header: "Desde", key: "desde", width: 14 },
      { header: "Hasta (toExclusive)", key: "hasta", width: 18 },
      { header: "Método filtro", key: "metodo", width: 18 },
      { header: "Ventas", key: "ventas", width: 10 },
      { header: "Total ventas (Q)", key: "tventas", width: 16 },
      { header: "Total pagos (Q)", key: "tpagos", width: 16 },
      { header: "Total items (Q)", key: "titems", width: 16 },
      { header: "Dif ventas-pagos (Q)", key: "dvp", width: 18 },
      { header: "Dif ventas-items (Q)", key: "dvi", width: 18 },
    ];
    wsR.getRow(1).font = { bold: true };
    wsR.views = [{ state: "frozen", ySplit: 1 }];

    // ---- Hoja Ventas
    const wsV = wb.addWorksheet("Ventas");
    wsV.columns = [
      { header: "Fecha", key: "fecha", width: 20 },
      { header: "Folio", key: "folio", width: 10 },
      { header: "ID Venta", key: "id", width: 18 },
      { header: "Cliente (ticket)", key: "cliente", width: 26 },
      { header: "Método(s) de pago", key: "metodos", width: 30 },
      { header: "Total venta (Q)", key: "total", width: 16 },
      { header: "Total pagos (Q)", key: "pagos", width: 16 },
      { header: "Total items (Q)", key: "items", width: 16 },
      { header: "Dif venta-pagos (Q)", key: "dvp", width: 18 },
      { header: "Dif venta-items (Q)", key: "dvi", width: 18 },
    ];
    wsV.getRow(1).font = { bold: true };
    wsV.views = [{ state: "frozen", ySplit: 1 }];

    // ---- Hoja Detalle
    const wsD = wb.addWorksheet("Detalle");
    wsD.columns = [
      { header: "Fecha", key: "fecha", width: 20 },
      { header: "Folio", key: "folio", width: 10 },
      { header: "ID Venta", key: "venta_id", width: 18 },
      { header: "Cliente (ticket)", key: "cliente", width: 26 },
      { header: "Método(s)", key: "metodos", width: 30 },
      { header: "SKU", key: "sku", width: 18 },
      { header: "Producto", key: "producto", width: 28 },
      { header: "Cantidad", key: "cantidad", width: 10 },
      { header: "Precio unit (Q)", key: "unit", width: 14 },
      { header: "Descuento (Q)", key: "desc", width: 14 },
      { header: "Impuesto (Q)", key: "imp", width: 14 },
      { header: "Total línea (Q)", key: "linea", width: 16 },
      { header: "Total venta (Q)", key: "total_venta", width: 16 },
    ];
    wsD.getRow(1).font = { bold: true };
    wsD.views = [{ state: "frozen", ySplit: 1 }];

    // =========================
    // Poblar
    // =========================
    for (const v of ventas) {
      const vTotal = toNum(v.total);
      totalMontoVentas += vTotal;

      // Cliente desde ticket, fallback a clientes.nombre
      const cliente = v.cliente_nombre || v.clientes?.nombre || "";

      // Pagos
      const pagos = v.ventas_pagos || [];
      const pagosSum = pagos.reduce((acc, p) => acc + toNum(p.monto), 0);
      totalMontoPagos += pagosSum;

      // Totales por método
      for (const p of pagos) {
        const m = p.metodo; // EFECTIVO|TRANSFERENCIA|TARJETA
        if (metodoFilter && m !== metodoFilter) continue;
        if (totalesPorMetodo[m] !== undefined) {
          totalesPorMetodo[m] += toNum(p.monto);
        }
      }

      // Texto método(s)
      const metodosTxt =
        pagos.length === 0
          ? ""
          : pagos
              .map((p) => `${p.metodo}(Q${toNum(p.monto).toFixed(2)})`)
              .join(" + ");

      // Items
      const det = v.ventas_detalle || [];
      const itemsSum = det.reduce((acc, it) => acc + toNum(it.total_linea), 0);
      totalMontoItems += itemsSum;

      const difVP = vTotal - pagosSum;
      const difVI = vTotal - itemsSum;

      // Ventas sheet
      const vr = wsV.addRow({
        fecha: fmtDateTime(v.fecha),
        folio: v.folio,
        id: v.id,
        cliente,
        metodos: metodosTxt,
        total: vTotal,
        pagos: pagosSum,
        items: itemsSum,
        dvp: difVP,
        dvi: difVI,
      });
      qfmt(vr.getCell("total"));
      qfmt(vr.getCell("pagos"));
      qfmt(vr.getCell("items"));
      qfmt(vr.getCell("dvp"));
      qfmt(vr.getCell("dvi"));

      // Detalle sheet (1 fila por producto)
      for (const it of det) {
        const prod = it.productos;
        const sku = prod?.sku || "";
        const nombre = prod?.nombre || "";

        const impuestoDirecto = toNum(it.impuesto);
        const ivaPct = toNum(prod?.iva_porcentaje);
        const costoImpUnit = toNum(prod?.costo_impuestos);
        const qty = toNum(it.cantidad);
        const impuestoCalc =
          impuestoDirecto !== 0
            ? impuestoDirecto
            : ivaPct > 0
            ? (toNum(it.precio_unitario) * qty * ivaPct) / 100
            : costoImpUnit > 0
            ? costoImpUnit * qty
            : 0;

        const precioVentaBase = toNum(prod?.precio_venta);
        const unit = toNum(it.precio_unitario);
        const descMayorista =
          precioVentaBase > 0 && unit > 0 && precioVentaBase > unit
            ? (precioVentaBase - unit) * qty
            : 0;
        const descTotal = toNum(it.descuento) + descMayorista;

        const dr = wsD.addRow({
          fecha: fmtDateTime(v.fecha),
          folio: v.folio,
          venta_id: v.id,
          cliente,
          metodos: metodosTxt,
          sku,
          producto: nombre,
          cantidad: toNum(it.cantidad),
          unit: unit,
          desc: descTotal,
          imp: impuestoCalc,
          linea: toNum(it.total_linea),
          total_venta: vTotal,
        });

        qfmt(dr.getCell("unit"));
        qfmt(dr.getCell("desc"));
        qfmt(dr.getCell("imp"));
        qfmt(dr.getCell("linea"));
        qfmt(dr.getCell("total_venta"));
      }
    }

    // Resumen
    const difGlobalVP = totalMontoVentas - totalMontoPagos;
    const difGlobalVI = totalMontoVentas - totalMontoItems;

    const rr = wsR.addRow({
      desde: from,
      hasta: to,
      metodo: metodoFilter || "TODAS",
      ventas: totalVentas,
      tventas: totalMontoVentas,
      tpagos: totalMontoPagos,
      titems: totalMontoItems,
      dvp: difGlobalVP,
      dvi: difGlobalVI,
    });

    qfmt(rr.getCell("tventas"));
    qfmt(rr.getCell("tpagos"));
    qfmt(rr.getCell("titems"));
    qfmt(rr.getCell("dvp"));
    qfmt(rr.getCell("dvi"));

    wsR.addRow({});
    const tpm = wsR.addRow({ desde: "Totales por método (según pagos)" });
    tpm.font = { bold: true };

    const metodosResumen = metodoFilter
      ? [metodoFilter]
      : ["EFECTIVO", "TRANSFERENCIA", "TARJETA"];
    for (const k of metodosResumen) {
      const r = wsR.addRow({ metodo: k, tpagos: totalesPorMetodo[k] });
      qfmt(r.getCell("tpagos"));
    }

    // Headers de respuesta
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    const metodoTag = metodoFilter || "TODAS";
    const fileName = `reporte-ventas_${from}_a_${to}_${metodoTag}.xlsx`;
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("❌ Error reporte ventas:", err);
    res.status(500).send("Error generando el Excel (revise consola del backend).");
  }
};


exports.exportReporteInventarioInternoExcel = async (req, res) => {
  try {
    const { from, to } = req.query;

    if (!mustISODate(from) || !mustISODate(to)) {
      return res
        .status(400)
        .send("Parametros invalidos: from/to deben ser YYYY-MM-DD");
    }

    const fromDate = new Date(`${from}T00:00:00-06:00`);
    const toDate = new Date(`${to}T00:00:00-06:00`);

    const rows = await prisma.$queryRaw`
      WITH base AS (
        SELECT
          p.id,
          p.sku,
          p.nombre,
          COALESCE(cat_rel.nombre, p.categoria) AS categoria,
          p.precio_venta,
          p.costo_promedio,
          p.costo_ultimo,
          p.costo_compra,
          p.costo_envio,
          p.costo_impuestos,
          p.costo_desaduanaje,
          p.stock_minimo,
          p.iva_porcentaje,
          p.zero_since,
          COALESCE(SUM(ie.stock), 0) AS stock_total
        FROM productos p
        LEFT JOIN inventario_existencias ie ON ie.producto_id = p.id

      LEFT JOIN LATERAL (
        SELECT c.nombre
        FROM productos_categorias pc
        JOIN categorias c ON c.id = pc.categoria_id
        WHERE pc.producto_id = p.id
        ORDER BY c.nombre ASC
        LIMIT 1
      ) cat_rel ON TRUE
        WHERE p.archivado = false
          AND p.activo = true
          AND EXISTS (
            SELECT 1
            FROM compras_detalle cd
            WHERE cd.producto_id = p.id
          )
        GROUP BY
          p.id, p.sku, p.nombre, p.categoria, cat_rel.nombre, p.precio_venta,
          p.costo_promedio, p.costo_ultimo, p.costo_compra,
          p.costo_envio, p.costo_impuestos, p.costo_desaduanaje,
          p.stock_minimo, p.iva_porcentaje, p.zero_since
      ),
      last_move AS (
        SELECT
          im.producto_id,
          MAX(im.fecha) AS last_move_at
        FROM inventario_movimientos im
        GROUP BY im.producto_id
      ),
      restock AS (
        SELECT
          b.id AS producto_id,
          CASE
            WHEN b.stock_total = 0 THEN COALESCE(b.zero_since, lm.last_move_at)
            ELSE NULL
          END AS zero_since_eff,
          EXISTS (
            SELECT 1
            FROM inventario_movimientos im
            WHERE im.producto_id = b.id
              AND im.tipo IN ('ENTRADA'::move_type, 'AJUSTE'::move_type)
              AND (CASE
                    WHEN b.stock_total = 0 THEN COALESCE(b.zero_since, lm.last_move_at)
                    ELSE NULL
                  END) IS NOT NULL
              AND im.fecha >= (CASE
                                WHEN b.stock_total = 0 THEN COALESCE(b.zero_since, lm.last_move_at)
                                ELSE NULL
                              END)
              AND im.fecha < ((CASE
                                WHEN b.stock_total = 0 THEN COALESCE(b.zero_since, lm.last_move_at)
                                ELSE NULL
                              END) + INTERVAL '20 days')
          ) AS restock_within_20d,
          (
            SELECT MAX(im2.fecha)
            FROM inventario_movimientos im2
            WHERE im2.producto_id = b.id
              AND im2.tipo IN ('ENTRADA'::move_type, 'AJUSTE'::move_type, 'TRASPASO'::move_type)
          ) AS last_restock_at
        FROM base b
        LEFT JOIN last_move lm ON lm.producto_id = b.id
      )
      SELECT
        b.*,
        r.restock_within_20d,
        r.last_restock_at,
        r.zero_since_eff
      FROM base b
      JOIN restock r ON r.producto_id = b.id
      WHERE
        b.stock_total > 0
        OR r.zero_since_eff >= ${fromDate}
        OR r.zero_since_eff >= (${fromDate} - INTERVAL '20 days')
        OR r.restock_within_20d = true
      ORDER BY b.nombre ASC;
    `;

    const totalProductos = rows.length;
    const totalStock = rows.reduce((acc, r) => acc + toNum(r.stock_total), 0);
    const totalValorVenta = rows.reduce(
      (acc, r) => acc + toNum(r.stock_total) * toNum(r.precio_venta),
      0
    );
    const totalValorCosto = rows.reduce(
      (acc, r) => acc + toNum(r.stock_total) * toNum(r.costo_promedio || r.costo_ultimo || 0),
      0
    );

    const wb = new ExcelJS.Workbook();
    wb.creator = "Sistema Joyeria";

    const wsR = wb.addWorksheet("Resumen");
    wsR.columns = [
      { header: "Desde", key: "desde", width: 14 },
      { header: "Hasta (toExclusive)", key: "hasta", width: 18 },
      { header: "Productos", key: "productos", width: 12 },
      { header: "Stock total", key: "stock", width: 14 },
      { header: "Valor venta (Q)", key: "venta", width: 18 },
      { header: "Valor costo (Q)", key: "costo", width: 18 },
    ];
    wsR.getRow(1).font = { bold: true };
    wsR.views = [{ state: "frozen", ySplit: 1 }];

    const rr = wsR.addRow({
      desde: from,
      hasta: to,
      productos: totalProductos,
      stock: totalStock,
      venta: totalValorVenta,
      costo: totalValorCosto,
    });
    qfmt(rr.getCell("stock"));
    qfmt(rr.getCell("venta"));
    qfmt(rr.getCell("costo"));

    const wsI = wb.addWorksheet("Inventario");
    wsI.columns = [
      { header: "SKU", key: "sku", width: 18 },
      { header: "Producto", key: "nombre", width: 32 },
      { header: "Categoria", key: "categoria", width: 18 },
      { header: "Stock", key: "stock", width: 12 },
      { header: "Estado", key: "estado", width: 12 },
      { header: "Precio venta (Q)", key: "precio_venta", width: 16 },
      { header: "Costo promedio (Q)", key: "costo_promedio", width: 18 },
      { header: "Costo ultimo (Q)", key: "costo_ultimo", width: 16 },
      { header: "IVA %", key: "iva", width: 10 },
      { header: "Ultimo restock", key: "last_restock", width: 22 },
    ];
    wsI.getRow(1).font = { bold: true };
    wsI.views = [{ state: "frozen", ySplit: 1 }];

    for (const r of rows) {
      const row = wsI.addRow({
        sku: r.sku,
        nombre: r.nombre,
        categoria: r.categoria || "",
        stock: toNum(r.stock_total),
        estado: toNum(r.stock_total) <= 0 ? "Agotado" : "Disponible",
        precio_venta: toNum(r.precio_venta),
        costo_promedio: toNum(r.costo_promedio),
        costo_ultimo: toNum(r.costo_ultimo),
        iva: toNum(r.iva_porcentaje),
        last_restock: fmtDateTime(r.last_restock_at),
      });

      qfmt(row.getCell("stock"));
      qfmt(row.getCell("precio_venta"));
      qfmt(row.getCell("costo_promedio"));
      qfmt(row.getCell("costo_ultimo"));
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    const fileName = `reporte-inventario-interno_${from}_a_${to}.xlsx`;
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Error reporte inventario interno:", err);
    res
      .status(500)
      .send("Error generando el Excel de inventario interno.");
  }
};
