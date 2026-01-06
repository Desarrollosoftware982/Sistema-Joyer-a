// src/controllers/catalog.controller.js
const prisma = require("../config/prisma");

/**
 * CATEGORÍAS
 */

// GET /api/catalog/categories
async function getCategories(req, res) {
  try {
    const categorias = await prisma.categorias.findMany({
      orderBy: { nombre: "asc" },
    });

    return res.json({ ok: true, data: categorias });
  } catch (err) {
    console.error("GET /categories error", err);
    return res
      .status(500)
      .json({ ok: false, message: "Error listando categorías" });
  }
}

// POST /api/catalog/categories
async function createCategory(req, res) {
  try {
    const { nombre } = req.body;

    if (!nombre || !nombre.trim()) {
      return res
        .status(400)
        .json({ ok: false, message: "El nombre es obligatorio" });
    }

    const categoria = await prisma.categorias.create({
      data: { nombre: nombre.trim() },
    });

    return res.status(201).json({ ok: true, data: categoria });
  } catch (err) {
    console.error("POST /categories error", err);
    if (err.code === "P2002") {
      // unique constraint
      return res.status(400).json({
        ok: false,
        message: "Ya existe una categoría con ese nombre",
      });
    }
    return res
      .status(500)
      .json({ ok: false, message: "Error creando categoría" });
  }
}

// PUT /api/catalog/categories/:id
async function updateCategory(req, res) {
  try {
    const { id } = req.params;
    const { nombre } = req.body;

    if (!nombre || !nombre.trim()) {
      return res
        .status(400)
        .json({ ok: false, message: "El nombre es obligatorio" });
    }

    const categoria = await prisma.categorias.update({
      where: { id },
      data: { nombre: nombre.trim() },
    });

    return res.json({ ok: true, data: categoria });
  } catch (err) {
    console.error("PUT /categories/:id error", err);
    return res
      .status(500)
      .json({ ok: false, message: "Error actualizando categoría" });
  }
}

// DELETE /api/catalog/categories/:id
async function deleteCategory(req, res) {
  try {
    const { id } = req.params;

    // Validar que no tenga productos asociados
    const usados = await prisma.productos_categorias.count({
      where: { categoria_id: id },
    });
    if (usados > 0) {
      return res.status(400).json({
        ok: false,
        message: "No se puede eliminar: la categoría tiene productos asociados",
      });
    }

    await prisma.categorias.delete({ where: { id } });

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /categories/:id error", err);
    return res
      .status(500)
      .json({ ok: false, message: "Error eliminando categoría" });
  }
}

/**
 * PRODUCTOS
 */

// GET /api/catalog/products?q=&page=&pageSize=&soloActivos=&includeInactivos=
async function getProducts(req, res) {
  try {
    const { q, page = "1", pageSize = "10" } = req.query;

    // ✅ Nuevo: permite listar también inactivos (sin mostrar archivados)
    const includeInactivos = ["1", "true", "yes"].includes(
      String(req.query.includeInactivos || "").toLowerCase()
    );

    // 🔁 Compatibilidad total: si no te mandan nada, se mantiene "true"
    const soloActivos = String(req.query.soloActivos ?? "true").toLowerCase();

    const pageNum = Math.max(parseInt(String(page), 10) || 1, 1);
    const sizeNum = Math.min(
      Math.max(parseInt(String(pageSize), 10) || 10, 1),
      100
    );

    const where = {};

    if (q && typeof q === "string" && q.trim() !== "") {
      where.OR = [
        { nombre: { contains: q, mode: "insensitive" } },
        { sku: { contains: q, mode: "insensitive" } },
        { codigo_barras: { contains: q, mode: "insensitive" } },
      ];
    }

    /**
     * ✅ LÓGICA DE FILTRO (sin romper lo existente):
     *
     * - Por defecto: soloActivos=true => activo=true AND archivado=false (igual que antes)
     * - Si includeInactivos=1 => archivado=false (activos + inactivos)
     * - Si soloActivos=false => archivado=false (activos + inactivos)
     */
    if (includeInactivos || soloActivos !== "true") {
      where.archivado = false;
    } else {
      where.activo = true;
      where.archivado = false;
    }

    const [total, items] = await Promise.all([
      prisma.productos.count({ where }),
      prisma.productos.findMany({
        where,
        orderBy: { creado_en: "desc" },
        skip: (pageNum - 1) * sizeNum,
        take: sizeNum,
        select: {
          id: true,
          sku: true,
          codigo_barras: true,
          nombre: true,
          precio_venta: true,
          iva_porcentaje: true,
          stock_minimo: true,
          activo: true,
          archivado: true,
          creado_en: true,

          // 🔹 Nuevos campos de costos (solo lectura):
          costo_compra: true,
          costo_envio: true,
          costo_impuestos: true,
          costo_desaduanaje: true,
          costo_promedio: true,
          costo_ultimo: true,
        },
      }),
    ]);

    return res.json({
      ok: true,
      data: {
        total,
        page: pageNum,
        pageSize: sizeNum,
        items,
      },
    });
  } catch (err) {
    console.error("GET /products error", err);
    return res
      .status(500)
      .json({ ok: false, message: "Error listando productos" });
  }
}

/**
 * ✅ Helper nuevo (NO rompe nada):
 * Asegura que el producto tenga filas en inventario_existencias para TODAS las ubicaciones existentes.
 * - Es idempotente: usa skipDuplicates para no duplicar.
 * - Si ya lo crea el trigger, aquí no pasa nada (se omiten duplicados).
 */
async function ensureInventarioExistenciasForProducto(tx, productoId) {
  // Traer ubicaciones existentes (todas)
  const ubicaciones = await tx.ubicaciones.findMany({
    select: { id: true },
  });

  if (!ubicaciones || ubicaciones.length === 0) return;

  // Crear filas de inventario (stock 0, existe false) si no existen
  // (si tu campo stock es Decimal/numeric, "0" como string es seguro)
  await tx.inventario_existencias.createMany({
    data: ubicaciones.map((u) => ({
      producto_id: productoId,
      ubicacion_id: u.id,
      stock: "0",
      existe: false,
    })),
    skipDuplicates: true,
  });
}

// POST /api/catalog/products
async function createProduct(req, res) {
  try {
    const {
      sku,
      nombre,
      precioVenta,
      ivaPorcentaje = 0,
      stockMinimo = 0,
      categoriasIds = [],
      codigoBarras,
    } = req.body;

    if (!sku || !nombre) {
      return res.status(400).json({
        ok: false,
        message: "SKU y nombre son obligatorios",
      });
    }

    const precioNumber = Number(precioVenta) || 0;

    // ✅ Transacción para mantener consistencia (sin cambiar contrato)
    const producto = await prisma.$transaction(async (tx) => {
      const created = await tx.productos.create({
        data: {
          sku: sku.trim(),
          nombre: nombre.trim(),
          precio_venta: precioNumber,
          iva_porcentaje: Number(ivaPorcentaje) || 0,
          stock_minimo: Number(stockMinimo) || 0,
          activo: true,
          archivado: false,
          codigo_barras: codigoBarras ? String(codigoBarras).trim() : null,
          productos_categorias:
            Array.isArray(categoriasIds) && categoriasIds.length > 0
              ? {
                  create: categoriasIds.map((id) => ({
                    categoria_id: id,
                  })),
                }
              : undefined,
        },
      });

      // ✅ NUEVO: asegurar filas en inventario_existencias (sin duplicar)
      await ensureInventarioExistenciasForProducto(tx, created.id);

      return created;
    });

    return res.status(201).json({ ok: true, data: producto });
  } catch (err) {
    console.error("POST /products error", err);
    if (err.code === "P2002") {
      return res.status(400).json({
        ok: false,
        message: "Ya existe un producto con ese SKU o código de barras",
      });
    }
    return res
      .status(500)
      .json({ ok: false, message: "Error creando producto" });
  }
}

// PUT /api/catalog/products/:id  (editar básico)
async function updateProduct(req, res) {
  try {
    const { id } = req.params;
    const {
      nombre,
      precioVenta,
      ivaPorcentaje,
      stockMinimo,
      activo,
      archivado,
    } = req.body;

    const data = {};
    if (nombre !== undefined) data.nombre = String(nombre).trim();
    if (precioVenta !== undefined) data.precio_venta = Number(precioVenta) || 0;
    if (ivaPorcentaje !== undefined)
      data.iva_porcentaje = Number(ivaPorcentaje) || 0;
    if (stockMinimo !== undefined)
      data.stock_minimo = Number(stockMinimo) || 0;
    if (activo !== undefined) data.activo = Boolean(activo);
    if (archivado !== undefined) data.archivado = Boolean(archivado);

    const producto = await prisma.productos.update({
      where: { id },
      data,
    });

    return res.json({ ok: true, data: producto });
  } catch (err) {
    console.error("PUT /products/:id error", err);
    return res
      .status(500)
      .json({ ok: false, message: "Error actualizando producto" });
  }
}

// GET /api/catalog/products/:id
async function getProductById(req, res) {
  try {
    const { id } = req.params;

    const producto = await prisma.productos.findUnique({
      where: { id },
      select: {
        id: true,
        sku: true,
        nombre: true,
        codigo_barras: true,

        // 🔹 También puedes querer ver los costos aquí:
        costo_compra: true,
        costo_envio: true,
        costo_impuestos: true,
        costo_desaduanaje: true,
        costo_promedio: true,
        costo_ultimo: true,
      },
    });

    if (!producto) {
      return res
        .status(404)
        .json({ ok: false, message: "Producto no encontrado" });
    }

    return res.json({ ok: true, data: producto });
  } catch (err) {
    console.error("GET /products/:id error", err);
    return res
      .status(500)
      .json({ ok: false, message: "Error obteniendo producto" });
  }
}

module.exports = {
  // Categorías
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  // Productos
  getProducts,
  createProduct,
  updateProduct,
  getProductById,
};
