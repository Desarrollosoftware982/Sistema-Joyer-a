// src/controllers/inventory.controller.js
const prisma = require("../config/prisma");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/* =========================================================
 *  ✅ HELPERS NUEVOS (NO ROMPEN LO EXISTENTE)
 * =======================================================*/

function toNumberSafe(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return Number.isFinite(val) ? val : 0;

  // Prisma Decimal suele tener toNumber()
  if (val && typeof val === "object" && typeof val.toNumber === "function") {
    const n = val.toNumber();
    return Number.isFinite(n) ? n : 0;
  }

  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

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

async function resolveUbicacionesPOS(tx, sucursalId) {
  const ubicaciones = await tx.ubicaciones.findMany({
    where: { sucursal_id: sucursalId },
    select: { id: true, nombre: true, es_vitrina: true, es_bodega: true },
  });

  const byName = (target) =>
    ubicaciones.find(
      (u) => String(u.nombre || "").trim().toUpperCase() === String(target).toUpperCase()
    );

  const vitrina =
    ubicaciones.find((u) => u.es_vitrina === true) || byName("VITRINA") || null;

  const bodega =
    ubicaciones.find((u) => u.es_bodega === true) || byName("BODEGA") || null;

  return { vitrina, bodega };
}

async function ensureExistencias(tx, ubicacionId, productoIds) {
  if (!ubicacionId || !Array.isArray(productoIds) || productoIds.length === 0) return;

  await tx.inventario_existencias.createMany({
    data: productoIds.map((pid) => ({
      producto_id: pid,
      ubicacion_id: ubicacionId,
      stock: 0,
      existe: false,
    })),
    skipDuplicates: true,
  });
}

async function getExistencia(tx, productoId, ubicacionId) {
  const row = await tx.inventario_existencias.findFirst({
    where: { producto_id: productoId, ubicacion_id: ubicacionId },
    select: { stock: true, existe: true },
  });

  return {
    stock: toNumberSafe(row?.stock),
    existe: Boolean(row?.existe),
  };
}

/**
 * ✅ HELPER CLAVE (para POS):
 * Asegura que VITRINA tenga stock suficiente para vender.
 * Si no hay suficiente, mueve de BODEGA -> VITRINA lo que haga falta.
 *
 * - items: [{ producto_id, cantidad }]
 * - Retorna movimientos creados y un resumen
 * - Lanza error statusCode=409 si BODEGA no alcanza
 */
async function ensureVitrinaStockTx(tx, { userId, sucursalId, items, motivo }) {
  if (!Array.isArray(items) || items.length === 0) {
    const e = new Error("Items inválidos");
    e.statusCode = 400;
    throw e;
  }

  const { vitrina, bodega } = await resolveUbicacionesPOS(tx, sucursalId);

  if (!vitrina?.id) {
    const e = new Error("No existe ubicación VITRINA en la sucursal (es_vitrina=true o nombre='VITRINA').");
    e.statusCode = 400;
    throw e;
  }
  if (!bodega?.id) {
    const e = new Error("No existe ubicación BODEGA en la sucursal (es_bodega=true o nombre='BODEGA').");
    e.statusCode = 400;
    throw e;
  }

  // Normalizar items y agrupar por producto (por si vienen repetidos)
  const mapReq = new Map();
  for (const it of items) {
    const pid = String(it?.producto_id || "").trim();
    const qty = Number(it?.cantidad);
    if (!pid || !Number.isFinite(qty) || qty <= 0) continue;
    mapReq.set(pid, (mapReq.get(pid) || 0) + qty);
  }

  const productoIds = Array.from(mapReq.keys());
  if (productoIds.length === 0) {
    const e = new Error("Items inválidos (no hay producto_id/cantidad válidos).");
    e.statusCode = 400;
    throw e;
  }

  // asegurar filas de existencias en ambas ubicaciones
  await ensureExistencias(tx, vitrina.id, productoIds);
  await ensureExistencias(tx, bodega.id, productoIds);

  const transferencias = [];
  const faltantes = [];

  for (const pid of productoIds) {
    const requerido = mapReq.get(pid);

    const exV = await getExistencia(tx, pid, vitrina.id);
    const exB = await getExistencia(tx, pid, bodega.id);

    const faltaEnVitrina = Math.max(0, requerido - exV.stock);

    if (faltaEnVitrina <= 0) {
      // Vitrina alcanza, no hacemos nada
      continue;
    }

    if (exB.stock + 1e-9 < faltaEnVitrina) {
      faltantes.push({
        producto_id: pid,
        requerido,
        stock_vitrina: exV.stock,
        stock_bodega: exB.stock,
        falta_en_vitrina: faltaEnVitrina,
      });
      continue;
    }

    transferencias.push({
      producto_id: pid,
      mover: faltaEnVitrina,
      stock_vitrina_antes: exV.stock,
      stock_bodega_antes: exB.stock,
    });
  }

  if (faltantes.length > 0) {
    const e = new Error("Stock insuficiente en BODEGA para completar VITRINA.");
    e.statusCode = 409;
    e.payload = {
      code: "STOCK_INSUFICIENTE_BODEGA",
      message: "No hay suficiente stock en BODEGA para completar el stock de VITRINA.",
      detalle: {
        sucursal_id: sucursalId,
        ubicacion_bodega: { id: bodega.id, nombre: bodega.nombre },
        ubicacion_vitrina: { id: vitrina.id, nombre: vitrina.nombre },
        faltantes,
      },
    };
    throw e;
  }

  const movimientos = [];

  for (const t of transferencias) {
    const mov = await tx.inventario_movimientos.create({
      data: {
        tipo: "TRASPASO",
        producto_id: t.producto_id,
        ubicacion_origen_id: bodega.id,
        ubicacion_destino_id: vitrina.id,
        cantidad: t.mover,
        motivo: motivo || "AUTO TRASPASO A VITRINA (POS)",
        usuario_id: userId,
        costo_unitario: null,
      },
    });
    movimientos.push(mov);
  }

  return {
    ubicaciones: {
      bodega: { id: bodega.id, nombre: bodega.nombre },
      vitrina: { id: vitrina.id, nombre: vitrina.nombre },
    },
    transferencias,
    movimientos_creados: movimientos.length,
    movimientos,
  };
}

/* =========================================================
 *  GET /api/inventory/stock
 * =======================================================*/
async function getStock(req, res) {
  try {
    const { productoId, includeSinMovimientos, vista, tipo } = req.query;

    // vista puede venir como "publico" o "interno"
    const vistaStr = String(vista || tipo || "").trim().toLowerCase();
    const esPublico = ["publico", "público", "public", "clientes", "cliente", "lista"].includes(vistaStr);

    // productoId (si lo mandan, validamos UUID para evitar 500 por cast)
    const productoUUID =
      productoId && UUID_RE.test(String(productoId)) ? String(productoId) : null;

    // =========================
    //  VISTA PÚBLICA (lista precios)
    // =========================
    if (esPublico) {
      const rows = await prisma.$queryRaw`
        SELECT
          p.id            AS producto_id,
          p.sku           AS sku,
          p.nombre        AS nombre,
          p.codigo_barras AS codigo_barras,

          -- Evita tronar si algún valor viene vacío; y si la columna no existe aún, dará null.
          NULLIF(to_jsonb(p)->>'precio_venta', '')::numeric     AS precio_venta,
          NULLIF(to_jsonb(p)->>'precio_mayorista', '')::numeric AS precio_mayorista,

          COALESCE(cat_rel.nombre, cat_guess.nombre) AS categoria,

          COALESCE(SUM(ie.stock), 0) AS stock_total,
          COALESCE(SUM(CASE WHEN u.es_vitrina THEN ie.stock ELSE 0 END), 0) AS stock_vitrina,

          CASE
            WHEN COALESCE(SUM(CASE WHEN u.es_vitrina THEN ie.stock ELSE 0 END), 0) > 0 THEN true
            WHEN COALESCE(SUM(ie.stock), 0) > 0 THEN true
            ELSE false
          END AS disponible

        FROM productos p
        LEFT JOIN inventario_existencias ie ON ie.producto_id = p.id
        LEFT JOIN ubicaciones u             ON u.id = ie.ubicacion_id

        -- Categoría por relación (la correcta)
        LEFT JOIN LATERAL (
          SELECT c.nombre
          FROM productos_categorias pc
          JOIN categorias c ON c.id = pc.categoria_id
          WHERE pc.producto_id = p.id
          ORDER BY c.nombre ASC
          LIMIT 1
        ) cat_rel ON TRUE

        -- Fallback: inferir categoría por nombre/SKU si NO hay relación
        LEFT JOIN LATERAL (
          SELECT c.nombre
          FROM categorias c
          CROSS JOIN LATERAL (
            SELECT lower(
              CASE
                WHEN right(c.nombre, 2) = 'es' THEN left(c.nombre, length(c.nombre) - 2)
                WHEN right(c.nombre, 1) = 's'  THEN left(c.nombre, length(c.nombre) - 1)
                ELSE c.nombre
              END
            ) AS token
          ) t
          WHERE
            lower(p.nombre) LIKE '%' || t.token || '%'
            OR lower(p.sku) LIKE t.token || '%'
          ORDER BY length(c.nombre) DESC
          LIMIT 1
        ) cat_guess ON TRUE

        WHERE
          p.archivado = false
          AND p.activo = true
          AND (${productoUUID}::uuid IS NULL OR p.id = ${productoUUID}::uuid)

        GROUP BY p.id, cat_rel.nombre, cat_guess.nombre
        ORDER BY p.nombre ASC;
      `;

      // ✅ NORMALIZACIÓN: asegura que el frontend reciba números reales (no strings)
      const normalized = (rows || []).map((r) => {
        const precioVenta =
          r.precio_venta === null || r.precio_venta === undefined ? null : Number(r.precio_venta);
        const precioMayorista =
          r.precio_mayorista === null || r.precio_mayorista === undefined ? null : Number(r.precio_mayorista);
        const categoria = r.categoria ?? null;

        return {
          ...r,
          id: r.producto_id,
          precio_venta: precioVenta,
          precio_mayorista: precioMayorista,
          categoria: categoria,
          categoria_nombre: categoria,

          productos: {
            id: r.producto_id,
            sku: r.sku,
            nombre: r.nombre,
            codigo_barras: r.codigo_barras,
            precio_venta: precioVenta,
            precio_mayorista: precioMayorista,
            categoria: categoria,
          },
        };
      });

      return res.json({ ok: true, mode: "PUBLICO", productos: normalized, existencias: normalized });
    }

    // =========================
    //  VISTA INTERNA (costos / márgenes / existencias)
    // =========================
    const includeAll =
      String(includeSinMovimientos || "").toLowerCase() === "true" ||
      String(includeSinMovimientos || "") === "1";

    const rows = await prisma.$queryRaw`
      SELECT
        ie.producto_id,
        ie.ubicacion_id,
        ie.stock,

        (
          to_jsonb(p)
          || jsonb_build_object(
            'productos_categorias',
            COALESCE(pcats.productos_categorias, '[]'::jsonb)
          )
        ) AS productos,

        (
          to_jsonb(u)
          || jsonb_build_object('sucursales', to_jsonb(s))
        ) AS ubicaciones

      FROM inventario_existencias ie
      JOIN productos p   ON p.id = ie.producto_id
      JOIN ubicaciones u ON u.id = ie.ubicacion_id
      JOIN sucursales s  ON s.id = u.sucursal_id

      LEFT JOIN LATERAL (
        SELECT
          COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'categorias',
                jsonb_build_object('nombre', c.nombre)
              )
            ),
            '[]'::jsonb
          ) AS productos_categorias
        FROM productos_categorias pc
        JOIN categorias c ON c.id = pc.categoria_id
        WHERE pc.producto_id = p.id
      ) pcats ON TRUE

      WHERE
        (${productoUUID}::uuid IS NULL OR ie.producto_id = ${productoUUID}::uuid)

        AND EXISTS (
          SELECT 1
          FROM compras_detalle cd
          WHERE cd.producto_id = ie.producto_id
        )

        AND (
          ${includeAll}::boolean = true
          OR EXISTS (
            SELECT 1
            FROM inventario_movimientos im
            WHERE im.producto_id = ie.producto_id
              AND im.tipo = 'ENTRADA'::move_type
          )
        )

      ORDER BY p.nombre ASC;
    `;

    return res.json({ ok: true, mode: "INTERNO", existencias: rows });
  } catch (err) {
    console.error("GET /inventory/stock error", err);
    return res
      .status(500)
      .json({ ok: false, message: "Error obteniendo existencias" });
  }
}

// GET /api/inventory/stock-bajo
async function getLowStock(req, res) {
  try {
    const rows = await prisma.$queryRaw`
      SELECT * FROM vw_stock_bajo
      ORDER BY nombre ASC
    `;
    res.json({ ok: true, productos: rows });
  } catch (err) {
    console.error("GET /inventory/stock-bajo error", err);
    res
      .status(500)
      .json({ ok: false, message: "Error obteniendo stock bajo" });
  }
}

// POST /api/inventory/movimientos
async function createMovement(req, res) {
  try {
    const {
      tipo,
      producto_id,
      ubicacion_origen_id,
      ubicacion_destino_id,
      cantidad,
      motivo,
      costo_unitario,
    } = req.body;

    if (!tipo || !producto_id || !cantidad) {
      return res
        .status(400)
        .json({ ok: false, message: "Datos incompletos" });
    }

    const movimiento = await prisma.inventario_movimientos.create({
      data: {
        tipo,
        producto_id,
        ubicacion_origen_id: ubicacion_origen_id || null,
        ubicacion_destino_id: ubicacion_destino_id || null,
        cantidad,
        motivo,
        usuario_id: req.user.userId,
        costo_unitario: costo_unitario ?? null,
      },
    });

    res.status(201).json({ ok: true, movimiento });
  } catch (err) {
    console.error("POST /inventory/movimientos error", err);
    res
      .status(500)
      .json({ ok: false, message: "Error registrando movimiento" });
  }
}

/**
 * ✅ NUEVO: ASEGURAR STOCK DE VITRINA PARA POS (múltiples items)
 * POST /api/inventory/pos/ensure-vitrina
 * body: { items: [{producto_id, cantidad}], sucursal_id? , motivo? }
 *
 * - Si no mandas sucursal_id, toma la del usuario (usuarios.sucursal_id) o fallback SP
 * - Mueve de BODEGA -> VITRINA lo que haga falta
 * - Devuelve 409 si BODEGA no alcanza
 */
async function ensureVitrinaForPOS(req, res) {
  try {
    const { items, sucursal_id, motivo } = req.body;

    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ ok: false, message: "No autenticado" });

    const sucId = sucursal_id ? String(sucursal_id) : await resolveSucursalIdForUser(userId);
    if (!sucId) {
      return res.status(400).json({
        ok: false,
        message: "No se pudo resolver sucursal (asigna usuarios.sucursal_id o crea sucursal SP).",
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      return await ensureVitrinaStockTx(tx, { userId, sucursalId: sucId, items, motivo });
    });

    return res.status(201).json({ ok: true, ...result });
  } catch (err) {
    console.error("POST /inventory/pos/ensure-vitrina error", err);

    if (err?.statusCode === 409) {
      return res.status(409).json({ ok: false, ...(err.payload || { message: err.message }) });
    }
    if (err?.statusCode === 400) {
      return res.status(400).json({ ok: false, message: err.message });
    }

    return res.status(500).json({ ok: false, message: "Error asegurando stock de vitrina" });
  }
}

/**
 * ✅ NUEVO: TRASLADO BODEGA -> VITRINA (para POS / manual)
 * POST /api/inventory/traslado-vitrina
 * body: { producto_id, cantidad, sucursal_id? , motivo? }
 */
async function transferToVitrina(req, res) {
  try {
    const { producto_id, cantidad, sucursal_id, motivo } = req.body;

    if (!producto_id || !cantidad) {
      return res.status(400).json({ ok: false, message: "producto_id y cantidad son obligatorios" });
    }

    const qty = Math.max(1, Number(cantidad));
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ ok: false, message: "cantidad inválida" });
    }

    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ ok: false, message: "No autenticado" });

    const sucId = sucursal_id ? String(sucursal_id) : await resolveSucursalIdForUser(userId);
    if (!sucId) {
      return res.status(400).json({
        ok: false,
        message: "No se pudo resolver sucursal (asigna usuarios.sucursal_id o crea sucursal SP).",
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Usa el helper para que sea consistente con POS
      return await ensureVitrinaStockTx(tx, {
        userId,
        sucursalId: sucId,
        items: [{ producto_id: String(producto_id), cantidad: qty }],
        motivo: motivo || "TRASPASO A VITRINA (manual)",
      });
    });

    return res.status(201).json({ ok: true, ...result });
  } catch (err) {
    console.error("POST /inventory/traslado-vitrina error", err);

    if (err?.statusCode === 409) {
      return res.status(409).json({ ok: false, ...(err.payload || { message: err.message }) });
    }
    if (err?.statusCode === 400) {
      return res.status(400).json({ ok: false, message: err.message });
    }

    return res.status(500).json({ ok: false, message: "Error trasladando a vitrina" });
  }
}

/**
 * CONFIRMAR COMPRA
 * Llama a fn_confirmar_compra(p_compra) en PostgreSQL
 * ✅ BONUS: Inventariar a BODEGA automáticamente con fn_inventariar_compra_a_bodega()
 */
async function confirmPurchase(req, res) {
  const { id } = req.params;

  try {
    const compra = await prisma.compras.findUnique({
      where: { id },
      select: { estado: true },
    });

    if (!compra) {
      return res
        .status(404)
        .json({ ok: false, message: "Compra no encontrada" });
    }

    if (compra.estado !== "BORRADOR") {
      return res.status(400).json({
        ok: false,
        message: "Solo se pueden confirmar compras en estado BORRADOR",
      });
    }

    await prisma.$executeRaw`
      SELECT fn_confirmar_compra(${id}::uuid);
    `;

    // ✅ Esto mete ENTRADAS a BODEGA por cada compras_detalle y actualiza existencias vía trigger
    const invent = await prisma.$queryRaw`
      SELECT public.fn_inventariar_compra_a_bodega(${id}::uuid) AS movimientos_creados;
    `;
    const movimientosCreados = invent?.[0]?.movimientos_creados ?? 0;

    const compraActualizada = await prisma.compras.findUnique({
      where: { id },
    });

    return res.json({
      ok: true,
      message: "Compra confirmada e inventariada a bodega correctamente",
      movimientosCreados,
      compra: compraActualizada,
    });
  } catch (err) {
    console.error("POST /inventory/compras/:id/confirmar error", err);
    res
      .status(500)
      .json({ ok: false, message: "Error confirmando compra" });
  }
}

module.exports = {
  getStock,
  getLowStock,
  createMovement,

  // ✅ NUEVOS
  transferToVitrina,
  ensureVitrinaForPOS,

  // ✅ (OPCIONAL PRO) si luego quieres llamarlo desde sales.controller dentro de tx:
  ensureVitrinaStockTx,

  confirmPurchase,
};
