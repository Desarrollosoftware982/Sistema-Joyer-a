// src/controllers/sales.controller.js
const prisma = require("../config/prisma");
const fs = require("fs");
const path = require("path");

// Excel/CSV reader (si no está instalado, el endpoint te lo dirá con mensaje claro)
let XLSX = null;
try {
  XLSX = require("xlsx");
} catch (e) {
  XLSX = null;
}

/**
 * Paracaídas: si en tu BD aún no existe precio_mayorista, lo crea.
 * (No afecta si ya existe)
 */
async function ensurePrecioMayoristaColumn() {
  await prisma.$executeRaw`
    ALTER TABLE public.productos
    ADD COLUMN IF NOT EXISTS precio_mayorista numeric(12,2);
  `;
}

/**
 * Genera un SKU básico a partir del nombre del producto.
 * Se usa solo cuando el cliente NO envía un sku manualmente.
 */
function generarSkuDesdeNombre(nombre) {
  if (!nombre || typeof nombre !== "string") {
    return `PROD-${Date.now().toString(36).toUpperCase()}`;
  }

  const base =
    nombre
      .normalize("NFD") // quita acentos
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-") // espacios y raros -> guiones
      .replace(/^-+|-+$/g, "") // limpia guiones al inicio/fin
      .slice(0, 10) || "PROD";

  const rand = Math.floor(Math.random() * 9000) + 1000; // 4 dígitos
  return `${base}-${rand}`;
}

/**
 * Detecta una categoría a partir del nombre del producto.
 * Ajusta estos textos para que coincidan con tus categorías reales.
 */
function detectarCategoriaPorNombre(nombre) {
  if (!nombre || typeof nombre !== "string") return null;

  const n = nombre.toLowerCase();

  if (n.includes("anillo")) return "Anillos";
  if (n.includes("collar")) return "Collares";
  if (n.includes("cadena")) return "Cadenas";
  if (n.includes("arete") || n.includes("aros")) return "Aretes";
  if (n.includes("reloj")) return "Relojes";
  if (n.includes("pulsera") || n.includes("bracelet")) return "Pulseras";

  return null;
}

/**
 * Normaliza el nombre para evitar duplicados:
 *  "  Ánillos  " -> "anillos"
 */
function normalizarCategoriaNombre(nombre = "") {
  return nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // sin acentos
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Busca una categoría por nombre.
 * Si no existe, la crea.
 *
 * ✅ usa nombre_norm (unique) para evitar duplicados
 * y para cumplir con tu schema Prisma (nombre_norm es obligatorio).
 */
async function findOrCreateCategoriaPorNombre(tx, nombreCategoria) {
  if (!nombreCategoria || typeof nombreCategoria !== "string") return null;

  const nombreTrim = nombreCategoria.trim();
  if (!nombreTrim) return null;

  const nombreNorm = normalizarCategoriaNombre(nombreTrim);

  const categoria = await tx.categorias.upsert({
    where: { nombre_norm: nombreNorm },
    update: {}, // no tocar nombre si ya existe
    create: {
      nombre: nombreTrim,
      nombre_norm: nombreNorm,
    },
  });

  return categoria;
}

/* =========================================================
 *  HELPERS EXCEL/CSV (SOLO PARA importSalesExcel)
 * =======================================================*/

function normalizeKey(k) {
  return String(k || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function pickAny(obj, keys = []) {
  for (const k of keys) {
    const nk = normalizeKey(k);
    if (obj[nk] !== undefined && obj[nk] !== null && String(obj[nk]).trim() !== "") {
      return obj[nk];
    }
  }
  return null;
}

function parseMoney(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === "number") return Number.isFinite(val) ? val : null;

  let s = String(val).trim();
  if (!s) return null;

  // Q36.41 -> 36.41 | 1,234.56 -> 1234.56 | 36,41 -> 36.41
  s = s.replace(/[^\d.,-]/g, "");
  if (!s) return null;

  if (s.includes(".") && s.includes(",")) {
    // asumimos coma como separador de miles
    s = s.replace(/,/g, "");
  } else if (!s.includes(".") && s.includes(",")) {
    // coma como decimal
    s = s.replace(/,/g, ".");
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function isUsableIdentifier(s) {
  if (!s) return false;
  const t = String(s).trim();
  if (!t) return false;
  // Evita casos tipo "E", "R", "P"
  if (t.length < 4) return false;
  return true;
}

function deriveCategoriaFromArticulo(articulo) {
  const a = String(articulo || "").trim().toLowerCase();
  if (!a) return null;

  // Reglas simples por tu Excel (ajustables)
  if (a.includes("arete")) return "Aretes";
  if (a.includes("ring") || a.includes("anillo")) return "Anillos";
  if (a.includes("cadena") || a.includes("n_cadena") || a.includes("n-cadena")) return "Cadenas";
  if (a.includes("tobillera")) return "Tobilleras";
  if (
    a.includes("razalete") ||
    a.includes("brazalete") ||
    a.includes("pulsera") ||
    a.includes("bw_pulsera") ||
    a.includes("bw-pulsera")
  ) {
    return "Pulseras";
  }
  if (a.includes("pendiente") || a.includes("p_endiente") || a.includes("p-endiente")) return "Pendientes";
  if (a.includes("set")) return "Sets";

  return null;
}

/**
 * ✅ FIX IMPORTANTE:
 * - Soporta multer.single() (req.file)
 * - Soporta multer.any() (req.files = [ ... ])
 * - Soporta multer.fields() (req.files = { campo: [ ... ] })
 * - Soporta express-fileupload (req.files.file.data)
 */
function getUploadFromReq(req) {
  // multer.single("file") o multer.single(...)
  if (req.file) {
    if (req.file.buffer) {
      return { buffer: req.file.buffer, filename: req.file.originalname || "upload.xlsx" };
    }
    if (req.file.path) {
      const b = fs.readFileSync(req.file.path);
      return { buffer: b, filename: req.file.originalname || path.basename(req.file.path) };
    }
  }

  // ✅ multer.any() => req.files es un array
  if (Array.isArray(req.files) && req.files.length > 0) {
    const f0 = req.files[0];
    if (f0?.buffer) {
      return { buffer: f0.buffer, filename: f0.originalname || "upload.xlsx" };
    }
    if (f0?.path) {
      const b = fs.readFileSync(f0.path);
      return { buffer: b, filename: f0.originalname || path.basename(f0.path) };
    }
  }

  // ✅ multer.fields() => req.files es objeto { fieldName: [files...] }
  if (req.files && typeof req.files === "object" && !Array.isArray(req.files)) {
    const firstKey = Object.keys(req.files)[0];
    const arr = req.files[firstKey];
    if (Array.isArray(arr) && arr.length > 0) {
      const f0 = arr[0];
      if (f0?.buffer) {
        return { buffer: f0.buffer, filename: f0.originalname || "upload.xlsx" };
      }
      if (f0?.path) {
        const b = fs.readFileSync(f0.path);
        return { buffer: b, filename: f0.originalname || path.basename(f0.path) };
      }
    }
  }

  // express-fileupload
  if (req.files && typeof req.files === "object") {
    const f =
      req.files.file ||
      req.files.archivo ||
      req.files.excel ||
      req.files.upload ||
      Object.values(req.files)[0];

    if (Array.isArray(f) && f[0]?.data) {
      return { buffer: f[0].data, filename: f[0].name || "upload.xlsx" };
    }
    if (f?.data) {
      return { buffer: f.data, filename: f.name || "upload.xlsx" };
    }
  }

  // (opcional) base64
  if (req.body?.fileBase64) {
    const b = Buffer.from(String(req.body.fileBase64), "base64");
    return { buffer: b, filename: req.body?.filename || "upload.xlsx" };
  }

  return null;
}

function readSpreadsheetRows(buffer) {
  if (!XLSX) {
    const e = new Error("Falta instalar dependencia 'xlsx'. Ejecuta: npm i xlsx");
    e.statusCode = 400;
    throw e;
  }

  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames?.[0];
  if (!sheetName) {
    const e = new Error("El archivo no contiene hojas legibles.");
    e.statusCode = 400;
    throw e;
  }

  const ws = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });

  // normaliza llaves
  return raw.map((r) => {
    const o = {};
    for (const [k, v] of Object.entries(r || {})) {
      o[normalizeKey(k)] = typeof v === "string" ? v.trim() : v;
    }
    return o;
  });
}

/* =========================================================
 *  VENTAS NORMALES (lo que ya tenías)
 * =======================================================*/

async function createSale(req, res) {
  const {
    sucursal_id,
    cliente_id,
    cliente_nombre,
    items,
    pagos,
  } = req.body;

  if (
    !sucursal_id ||
    !Array.isArray(items) ||
    items.length === 0 ||
    !Array.isArray(pagos) ||
    pagos.length === 0
  ) {
    return res.status(400).json({ ok: false, message: "Datos de venta incompletos" });
  }

  try {
    const ventaCreada = await prisma.$transaction(async (tx) => {
      let subtotal = 0;
      let descuentoTotal = 0;
      let impuestosTotal = 0;

      items.forEach((it) => {
        const lineaBruta = it.precio_unitario * it.cantidad;
        subtotal += lineaBruta;
        descuentoTotal += it.descuento || 0;
        impuestosTotal += it.impuesto || 0;
      });

      const total = subtotal - descuentoTotal + impuestosTotal;

      const venta = await tx.ventas.create({
        data: {
          sucursal_id,
          usuario_id: req.user.userId,
          cliente_id: cliente_id || null,
          cliente_nombre: cliente_nombre || null,
          subtotal,
          descuento: descuentoTotal,
          impuestos: impuestosTotal,
          total,
          estado: "PENDIENTE",
        },
      });

      for (const it of items) {
        await tx.ventas_detalle.create({
          data: {
            venta_id: venta.id,
            producto_id: it.producto_id,
            cantidad: it.cantidad,
            precio_unitario: it.precio_unitario,
            descuento: it.descuento || 0,
            impuesto: it.impuesto || 0,
            total_linea: it.cantidad * it.precio_unitario - (it.descuento || 0) + (it.impuesto || 0),
          },
        });
      }

      for (const p of pagos) {
        await tx.ventas_pagos.create({
          data: {
            venta_id: venta.id,
            metodo: p.metodo,
            monto: p.monto,
            card_brand: p.card_brand || null,
            card_last4: p.card_last4 || null,
            auth_code: p.auth_code || null,
            processor_txn_id: p.processor_txn_id || null,
          },
        });
      }

      await tx.$executeRawUnsafe(`SELECT fn_confirmar_venta($1::uuid);`, venta.id);

      return venta;
    });

    return res.status(201).json({ ok: true, venta: ventaCreada });
  } catch (err) {
    console.error("POST /sales error", err);
    return res.status(500).json({ ok: false, message: "Error creando venta" });
  }
}

/* =========================================================
 *  ✅ NUEVO: VENTA POS (CAJERO)
 *  - No rompe tu flujo: usa las MISMAS tablas y fn_confirmar_venta()
 *  - ✅ MODO CORPORACIÓN: sucursal sale de usuarios.sucursal_id (fallback SP)
 *  - ✅ AUTO: si falta en VITRINA, mueve de BODEGA -> VITRINA dentro de la transacción
 * =======================================================*/

function normalizeMetodoPago(m) {
  const s = String(m || "").trim().toUpperCase();
  if (!s) return "EFECTIVO";

  // Variantes comunes -> tu enum real
  if (s === "CASH") return "EFECTIVO";
  if (s === "CARD" || s === "CREDITO" || s === "DEBITO") return "TARJETA";
  if (s === "TRANSFER" || s === "BANK") return "TRANSFERENCIA";

  return s; // EFECTIVO / TARJETA / TRANSFERENCIA (o el que uses)
}

/**
 * ✅ MODO CORPORACIÓN:
 * - Toma la sucursal desde usuarios.sucursal_id
 * - Fallback a SP para compatibilidad
 */
async function resolveSucursalIdForUser(userId) {
  const user = await prisma.usuarios.findUnique({
    where: { id: userId },
    select: { sucursal_id: true },
  });

  if (user?.sucursal_id) {
    const suc = await prisma.sucursales.findUnique({
      where: { id: user.sucursal_id },
      select: { id: true },
    });
    if (suc?.id) return suc.id;
  }

  const sp = await prisma.sucursales.findFirst({
    where: { codigo: "SP" },
    select: { id: true },
  });

  return sp?.id ?? null;
}

/* =========================
 *  ✅ HELPERS STOCK POS
 * =======================*/

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

/**
 * Busca las ubicaciones VITRINA y BODEGA de una sucursal
 * - Primero por banderas (es_vitrina/es_bodega)
 * - Fallback por nombre (VITRINA/BODEGA)
 */
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
      stock: "0",
      existe: false,
    })),
    skipDuplicates: true,
  });
}

async function loadStockMap(tx, ubicacionId, productoIds) {
  const map = new Map();
  if (!ubicacionId || !Array.isArray(productoIds) || productoIds.length === 0) return map;

  const rows = await tx.inventario_existencias.findMany({
    where: {
      ubicacion_id: ubicacionId,
      producto_id: { in: productoIds },
    },
    select: {
      producto_id: true,
      stock: true,
      existe: true,
    },
  });

  for (const r of rows) {
    map.set(String(r.producto_id), {
      stock: toNumberSafe(r.stock),
      existe: Boolean(r.existe),
    });
  }
  return map;
}

/**
 * ✅ NUEVO: asegura que VITRINA tenga stock suficiente.
 * Si falta, mueve desde BODEGA -> VITRINA (TRASPASO) dentro de la misma transacción.
 *
 * - Si no hay BODEGA o no alcanza: lanza 409 con detalle.
 * - Devuelve lista de traspasos realizados (para debug / auditoría).
 */
async function ensureVitrinaStockTx(tx, { sucursalId, usuarioId, items, mapProd }) {
  const ids = Array.from(new Set(items.map((x) => x.producto_id)));

  const { vitrina, bodega } = await resolveUbicacionesPOS(tx, sucursalId);

  if (!vitrina?.id) {
    const e = new Error(
      "No existe ubicación VITRINA en la sucursal (marca es_vitrina=true o nombre='VITRINA')."
    );
    e.statusCode = 400;
    throw e;
  }

  // asegurar filas (idempotente / no duplica)
  await ensureExistencias(tx, vitrina.id, ids);
  if (bodega?.id) await ensureExistencias(tx, bodega.id, ids);

  // consolidar cantidades por producto (por si el frontend manda repetidos)
  const reqMap = new Map();
  for (const it of items) {
    const pid = String(it.producto_id);
    const prev = reqMap.get(pid) || 0;
    reqMap.set(pid, prev + Number(it.cantidad || 0));
  }

  // stocks actuales
  const stockV = await loadStockMap(tx, vitrina.id, ids);
  const stockB = bodega?.id ? await loadStockMap(tx, bodega.id, ids) : new Map();

  const traspasos = [];
  const faltantes = [];

  for (const [pid, requerido] of reqMap.entries()) {
    const p = mapProd.get(pid);
    const sv = stockV.get(pid)?.stock ?? 0;

    if (sv + 1e-9 >= requerido) continue; // ya alcanza en vitrina

    const falta = requerido - sv;

    if (!bodega?.id) {
      faltantes.push({
        producto_id: pid,
        producto: p?.nombre || null,
        requerido,
        stock_vitrina: sv,
        stock_bodega: null,
        falta_en_vitrina: falta,
        motivo: "No existe BODEGA configurada en esta sucursal.",
      });
      continue;
    }

    const sb = stockB.get(pid)?.stock ?? 0;

    if (sb + 1e-9 < falta) {
      faltantes.push({
        producto_id: pid,
        producto: p?.nombre || null,
        requerido,
        stock_vitrina: sv,
        stock_bodega: sb,
        falta_en_vitrina: falta,
        motivo: "No hay suficiente stock en BODEGA para cubrir la VITRINA.",
      });
      continue;
    }

    // ✅ crear TRASPASO BODEGA -> VITRINA por lo que falta
    const mov = await tx.inventario_movimientos.create({
      data: {
        tipo: "TRASPASO",
        producto_id: pid,
        ubicacion_origen_id: bodega.id,
        ubicacion_destino_id: vitrina.id,
        cantidad: falta,
        motivo: "AUTO TRASPASO A VITRINA (POS)",
        usuario_id: usuarioId,
        costo_unitario: null,
      },
    });

    traspasos.push({
      movimiento_id: mov.id,
      producto_id: pid,
      producto: p?.nombre || null,
      cantidad: falta,
      desde: { id: bodega.id, nombre: bodega.nombre },
      hacia: { id: vitrina.id, nombre: vitrina.nombre },
    });
  }

  if (faltantes.length > 0) {
    const e = new Error("Stock insuficiente para completar la venta POS.");
    e.statusCode = 409;
    e.payload = {
      code: "STOCK_INSUFICIENTE",
      message:
        "No hay stock suficiente para completar la venta. (Se intentó auto-traspaso BODEGA→VITRINA cuando fue posible.)",
      faltantes,
      traspasos_realizados: traspasos,
    };
    throw e;
  }

  return {
    vitrina: { id: vitrina.id, nombre: vitrina.nombre },
    bodega: bodega?.id ? { id: bodega.id, nombre: bodega.nombre } : null,
    traspasos,
  };
}

async function crearVentaPOS(req, res) {
  try {
    const {
      // ✅ ya NO exigimos sucursal_id para POS (modo corporación)
      sucursal_id: sucursal_id_body,

      cliente_id,
      cliente_nombre,
      items,
      metodo_pago,
      efectivo_recibido,
      // opcionales para tarjeta
      card_brand,
      card_last4,
      auth_code,
      processor_txn_id,
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, message: "Items inválidos" });
    }

    // Token trae { userId, roleName }
    const usuarioId = req.user?.userId;
    if (!usuarioId) {
      return res.status(401).json({ ok: false, message: "No autenticado" });
    }

    // ✅ resolver sucursal por usuario (fallback SP)
    const roleNorm = String(req.user?.roleName ?? "").trim().toUpperCase();

    let sucursalId = await resolveSucursalIdForUser(usuarioId);

    // (Opcional PRO) Si eres ADMIN y mandas sucursal_id explícito, lo respetamos.
    if (roleNorm === "ADMIN" && sucursal_id_body) {
      sucursalId = String(sucursal_id_body);
    }

    if (!sucursalId) {
      return res.status(400).json({
        ok: false,
        message: "sucursal_id es requerido (asigna usuarios.sucursal_id o crea SP).",
      });
    }

    // Normaliza items: soporta qty o cantidad
    const cleanItems = items.map((x) => ({
      producto_id: String(x.producto_id),
      cantidad: Math.max(1, Number(x.cantidad ?? x.qty ?? 1)),
      precio_unitario: Number(x.precio_unitario || 0),
    }));

    const ids = Array.from(new Set(cleanItems.map((x) => x.producto_id)));

    // Traer productos
    const productos = await prisma.productos.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        nombre: true,
        precio_venta: true,
        activo: true,
        archivado: true,
      },
    });

    const mapProd = new Map(productos.map((p) => [String(p.id), p]));

    // Validaciones + precio unitario fallback a precio_venta
    for (const it of cleanItems) {
      const p = mapProd.get(it.producto_id);
      if (!p) return res.status(404).json({ ok: false, message: "Producto no encontrado" });

      if (p.archivado || !p.activo) {
        return res.status(400).json({ ok: false, message: `Producto no disponible: ${p.nombre}` });
      }

      if (Number.isNaN(it.precio_unitario) || it.precio_unitario <= 0) {
        it.precio_unitario = Number(p.precio_venta || 0);
      }

      if (!Number.isFinite(it.precio_unitario) || it.precio_unitario <= 0) {
        return res.status(400).json({ ok: false, message: `Producto sin precio de venta: ${p.nombre}` });
      }
    }

    // Total server-side
    const subtotal = cleanItems.reduce((acc, it) => acc + it.cantidad * it.precio_unitario, 0);
    const total = subtotal;

    // Pago
    const metodo = normalizeMetodoPago(metodo_pago || "EFECTIVO");

    let cambio = null;
    if (metodo === "EFECTIVO" && efectivo_recibido != null && efectivo_recibido !== "") {
      const recibido = Number(efectivo_recibido);
      if (!Number.isFinite(recibido) || recibido <= 0) {
        return res.status(400).json({ ok: false, message: "efectivo_recibido inválido" });
      }
      if (recibido + 1e-9 < total) {
        return res.status(400).json({ ok: false, message: "Efectivo insuficiente" });
      }
      cambio = Math.round((recibido - total) * 100) / 100;
    }

    let metaTraslados = null;

    const ventaCreada = await prisma.$transaction(async (tx) => {
      // ✅ NUEVO: auto-asegurar stock de vitrina (si falta, mueve desde bodega)
      metaTraslados = await ensureVitrinaStockTx(tx, {
        sucursalId,
        usuarioId,
        items: cleanItems,
        mapProd,
      });

      // 1) Venta
      const venta = await tx.ventas.create({
        data: {
          sucursal_id: sucursalId, // ✅ sale del usuario (corporación)
          usuario_id: usuarioId,
          cliente_id: cliente_id || null,
          cliente_nombre: cliente_nombre || null,
          subtotal: total,
          descuento: 0,
          impuestos: 0,
          total,
          estado: "PENDIENTE",
        },
      });

      // 2) Detalle
      for (const it of cleanItems) {
        await tx.ventas_detalle.create({
          data: {
            venta_id: venta.id,
            producto_id: it.producto_id,
            cantidad: it.cantidad,
            precio_unitario: it.precio_unitario,
            descuento: 0,
            impuesto: 0,
            total_linea: it.cantidad * it.precio_unitario,
          },
        });
      }

      // 3) Pago (uno solo por POS)
      await tx.ventas_pagos.create({
        data: {
          venta_id: venta.id,
          metodo,
          monto: total,
          card_brand: card_brand || null,
          card_last4: card_last4 || null,
          auth_code: auth_code || null,
          processor_txn_id: processor_txn_id || null,
        },
      });

      // 4) Confirmar (descuenta stock con tu lógica)
      await tx.$executeRawUnsafe(`SELECT fn_confirmar_venta($1::uuid);`, venta.id);

      return venta;
    });

    return res.status(201).json({
      ok: true,
      venta_id: ventaCreada.id,
      total,
      cambio,
      // ✅ útil para debug/auditoría: qué se movió automáticamente
      inventario: metaTraslados,
    });
  } catch (err) {
    console.error("Error crearVentaPOS:", err);

    // ✅ devuelve errores claros sin 500
    if (err && err.statusCode === 409) {
      return res.status(409).json({
        ok: false,
        ...((err.payload && typeof err.payload === "object") ? err.payload : { message: err.message }),
      });
    }

    if (err && err.statusCode === 400) {
      return res.status(400).json({ ok: false, message: err.message });
    }

    // Si la función DB tronó por stock, intentamos mapearlo (sin asumir demasiado)
    const msg = String(err?.message || "");
    if (msg.toLowerCase().includes("stock") || msg.toLowerCase().includes("insuf")) {
      return res.status(409).json({
        ok: false,
        code: "STOCK_INSUFICIENTE",
        message: "No se pudo confirmar la venta por stock insuficiente.",
        detail: msg.slice(0, 500),
      });
    }

    return res.status(500).json({ ok: false, message: "Error creando venta POS" });
  }
}

/* =========================================================
 *  NUEVOS HANDLERS PARA "Ventas · Configuración"
 * =======================================================*/

async function createManualProduct(req, res) {
  try {
    await ensurePrecioMayoristaColumn();

    const {
      sku,
      nombre,
      categoria,
      precio_venta,
      precio_mayorista,
      codigo_barras,
    } = req.body;

    if (!nombre || precio_venta == null) {
      return res.status(400).json({
        ok: false,
        message: "Nombre y precio_venta son obligatorios",
      });
    }

    const skuInput =
      sku && typeof sku === "string" && sku.trim().length > 0 ? sku.trim() : null;

    const skuFinal = skuInput || generarSkuDesdeNombre(nombre);

    const categoriaTexto =
      categoria && typeof categoria === "string" ? categoria.trim() : "";
    const categoriaDetectada = categoriaTexto ? null : detectarCategoriaPorNombre(nombre);

    const codigoBarrasTrim =
      codigo_barras && typeof codigo_barras === "string" ? codigo_barras.trim() : "";
    const codigoFinal = codigoBarrasTrim === "" ? null : codigoBarrasTrim;

    const { producto, categoriaNombreFinal } = await prisma.$transaction(async (tx) => {
      let categoriaRecord = null;
      const categoriaFinal = categoriaTexto || categoriaDetectada || "";

      if (categoriaFinal) {
        categoriaRecord = await findOrCreateCategoriaPorNombre(tx, categoriaFinal);
      }

      const categoriaNombreFinal = categoriaRecord
        ? categoriaRecord.nombre
        : categoriaFinal || null;

      let existente = null;

      if (codigoFinal) {
        existente = await tx.productos.findFirst({
          where: { codigo_barras: codigoFinal },
        });

        if (existente?.archivado) {
          const e = new Error(
            "Ya existe un producto eliminado con ese código de barras. No se puede reutilizar."
          );
          e.statusCode = 400;
          throw e;
        }

        if (existente && skuInput && existente.sku !== skuInput) {
          const e = new Error(
            "Ese código de barras ya pertenece a otro SKU. No se puede cambiar el SKU de un producto existente."
          );
          e.statusCode = 400;
          throw e;
        }
      }

      if (!existente && skuInput) {
        existente = await tx.productos.findUnique({
          where: { sku: skuInput },
        });

        if (existente?.archivado) {
          const e = new Error("Ese SKU pertenece a un producto eliminado. No se puede reutilizar.");
          e.statusCode = 400;
          throw e;
        }

        if (existente && codigoFinal) {
          const otro = await tx.productos.findFirst({
            where: {
              codigo_barras: codigoFinal,
              NOT: { id: existente.id },
            },
            select: { id: true },
          });
          if (otro) {
            const e = new Error(
              "Ya existe otro producto con ese código de barras. No se puede reutilizar."
            );
            e.statusCode = 400;
            throw e;
          }
        }
      }

      let productoCreadoOActualizado = null;

      if (existente) {
        productoCreadoOActualizado = await tx.productos.update({
          where: { id: existente.id },
          data: {
            nombre,
            codigo_barras: codigoFinal ?? existente.codigo_barras,
            precio_venta: Number(precio_venta),
            precio_mayorista:
              precio_mayorista == null || precio_mayorista === ""
                ? null
                : Number(precio_mayorista),
            activo: true,
            archivado: false,
          },
        });

        await tx.productos_categorias.deleteMany({
          where: { producto_id: existente.id },
        });

        if (categoriaRecord) {
          await tx.productos_categorias.create({
            data: {
              producto_id: existente.id,
              categoria_id: categoriaRecord.id,
            },
          });
        }
      } else {
        productoCreadoOActualizado = await tx.productos.create({
          data: {
            sku: skuFinal,
            nombre,
            precio_venta: Number(precio_venta),
            precio_mayorista:
              precio_mayorista == null || precio_mayorista === ""
                ? null
                : Number(precio_mayorista),
            codigo_barras: codigoFinal,
            activo: true,
            archivado: false,
          },
        });

        if (categoriaRecord) {
          await tx.productos_categorias.create({
            data: {
              producto_id: productoCreadoOActualizado.id,
              categoria_id: categoriaRecord.id,
            },
          });
        }
      }

      return { producto: productoCreadoOActualizado, categoriaNombreFinal };
    });

    return res.status(201).json({
      ok: true,
      data: {
        ...producto,
        categoria: categoriaNombreFinal,
      },
    });
  } catch (err) {
    console.error("Error createManualProduct:", err);

    if (err && err.statusCode === 400) {
      return res.status(400).json({ ok: false, message: err.message });
    }

    if (
      err &&
      typeof err === "object" &&
      err.code === "P2002" &&
      err.meta &&
      Array.isArray(err.meta.target) &&
      err.meta.target.includes("codigo_barras")
    ) {
      return res.status(400).json({
        ok: false,
        message:
          "Ya existe un producto con ese código de barras. No se puede reutilizar. Deja el campo vacío o genera un código nuevo.",
      });
    }

    return res.status(500).json({ ok: false, message: "Error al registrar el nuevo producto" });
  }
}

async function deleteManualProduct(req, res) {
  try {
    const { id } = req.params;

    await prisma.$transaction(async (tx) => {
      await tx.productos_categorias.deleteMany({
        where: { producto_id: id },
      });

      await tx.productos.update({
        where: { id },
        data: { archivado: true, activo: false },
      });
    });

    return res.json({
      ok: true,
      message:
        "Producto eliminado correctamente. El código de barras queda bloqueado para futuros registros.",
    });
  } catch (err) {
    console.error("Error deleteManualProduct:", err);
    return res.status(500).json({ ok: false, message: "Error al eliminar producto" });
  }
}

async function bulkUpdateProducts(req, res) {
  try {
    await ensurePrecioMayoristaColumn();

    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        ok: false,
        message: "No hay productos para actualizar.",
      });
    }

    await prisma.$transaction(async (tx) => {
      for (const p of items) {
        const catTexto =
          p.categoria && typeof p.categoria === "string" ? p.categoria.trim() : "";

        const codigoTrim =
          p.codigo_barras && typeof p.codigo_barras === "string"
            ? p.codigo_barras.trim()
            : "";
        const codigoFinal = codigoTrim === "" ? null : codigoTrim;

        if (codigoFinal) {
          const dup = await tx.productos.findFirst({
            where: {
              codigo_barras: codigoFinal,
              NOT: { id: p.id },
            },
            select: { id: true },
          });
          if (dup) {
            const e = new Error("Ya existe un producto con ese código de barras. No se puede reutilizar.");
            e.statusCode = 400;
            throw e;
          }
        }

        let categoriaRecord = null;
        if (catTexto) {
          categoriaRecord = await findOrCreateCategoriaPorNombre(tx, catTexto);
        }

        await tx.productos.update({
          where: { id: p.id },
          data: {
            nombre: p.nombre,
            codigo_barras: codigoFinal,
            precio_venta: Number(p.precio_venta),
            precio_mayorista:
              p.precio_mayorista == null || p.precio_mayorista === ""
                ? null
                : Number(p.precio_mayorista),
          },
        });

        await tx.productos_categorias.deleteMany({
          where: { producto_id: p.id },
        });

        if (categoriaRecord) {
          await tx.productos_categorias.create({
            data: {
              producto_id: p.id,
              categoria_id: categoriaRecord.id,
            },
          });
        }
      }
    });

    return res.json({
      ok: true,
      message: "Productos actualizados correctamente.",
    });
  } catch (err) {
    console.error("Error bulkUpdateProducts:", err);

    if (err && err.statusCode === 400) {
      return res.status(400).json({ ok: false, message: err.message });
    }

    if (
      err &&
      typeof err === "object" &&
      err.code === "P2002" &&
      err.meta &&
      Array.isArray(err.meta.target) &&
      err.meta.target.includes("codigo_barras")
    ) {
      return res.status(400).json({
        ok: false,
        message:
          "Ya existe un producto con ese código de barras. No se puede reutilizar. Genera otro código.",
      });
    }

    return res.status(500).json({ ok: false, message: "Error al guardar cambios" });
  }
}

/**
 * ✅ IMPLEMENTACIÓN: Carga masiva de PRECIOS PARA VENTAS (Excel/CSV)
 *
 * Reglas:
 * - NO crea productos nuevos.
 * - Busca por SKU o por código de barras usable.
 * - Actualiza precio_venta y activa el producto.
 * - precio_mayorista:
 *    - Si Excel trae valor → usa ese
 *    - Si NO trae valor → calcula (solo si el producto NO tiene mayorista aún)
 */
async function importSalesExcel(req, res) {
  try {
    await ensurePrecioMayoristaColumn();

    const upload = getUploadFromReq(req);
    if (!upload?.buffer) {
      return res.status(400).json({
        ok: false,
        message:
          "No se recibió archivo. Envíalo como multipart/form-data con campo 'file' (o 'archivo').",
      });
    }

    const rows = readSpreadsheetRows(upload.buffer);
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({
        ok: false,
        message: "El archivo no contiene filas para procesar.",
      });
    }

    let mayoristaFactor = Number(
      req.body?.mayorista_factor ??
        req.query?.mayorista_factor ??
        process.env.MAYORISTA_FACTOR ??
        0.9
    );
    if (!Number.isFinite(mayoristaFactor) || mayoristaFactor <= 0 || mayoristaFactor > 1) {
      mayoristaFactor = 0.9;
    }

    const parsed = [];
    const invalidas = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};

      const barcode = String(
        pickAny(r, ["bar_code", "barcode", "codigo_barras", "codigo_de_barras", "bar code"])
      || "").trim();

      const sku = String(
        pickAny(r, ["sku", "producto_sku"])
      || "").trim();

      const articulo = String(
        pickAny(r, ["articulo", "nombre", "producto", "descripcion"])
      || "").trim();

      const precioFinal = parseMoney(
        pickAny(r, ["precio_cliente_final", "precio_final", "precio_publico", "precio_venta", "precio"])
      );

      const mayoristaExcel = parseMoney(
        pickAny(r, ["precio_mayorista", "mayorista", "precio_wholesale"])
      );

      const categoriaExcel = String(
        pickAny(r, ["categoria", "category"])
      || "").trim();

      const hasIdentifier = (sku && sku.length > 0) || isUsableIdentifier(barcode);
      if (!hasIdentifier || precioFinal === null) {
        invalidas.push({
          fila: i + 2,
          motivo: !hasIdentifier
            ? "Sin SKU ni Bar Code usable (ej: 'E', 'R' o vacío)"
            : "Precio cliente final inválido",
          barcode,
          sku,
          articulo,
        });
        continue;
      }

      const categoriaDerivada =
        categoriaExcel ||
        deriveCategoriaFromArticulo(articulo) ||
        detectarCategoriaPorNombre(articulo);

      parsed.push({
        fila: i + 2,
        barcode,
        sku,
        articulo,
        precioFinal: Number(precioFinal),
        mayoristaExcel: mayoristaExcel === null ? null : Number(mayoristaExcel),
        categoria: categoriaDerivada || null,
      });
    }

    if (parsed.length === 0) {
      return res.status(400).json({
        ok: false,
        message:
          "No hay filas válidas para procesar. Revisa columnas y que exista 'PRECIO CLIENTE FINAL'.",
        invalidas: invalidas.slice(0, 30),
      });
    }

    const skus = Array.from(new Set(parsed.map((x) => x.sku).filter(Boolean)));
    const barcodes = Array.from(new Set(parsed.map((x) => x.barcode).filter((b) => isUsableIdentifier(b))));

    const or = [];
    if (skus.length) or.push({ sku: { in: skus } });
    if (barcodes.length) or.push({ codigo_barras: { in: barcodes } });

    if (or.length === 0) {
      return res.status(400).json({
        ok: false,
        message:
          "No se encontró ningún SKU o código de barras usable en el archivo (ej: códigos de 1 letra se ignoran).",
      });
    }

    const productos = await prisma.productos.findMany({
      where: { OR: or },
      select: {
        id: true,
        sku: true,
        codigo_barras: true,
        archivado: true,
        precio_mayorista: true,
      },
    });

    const bySku = new Map();
    const byBarcode = new Map();

    for (const p of productos) {
      if (p.sku) bySku.set(String(p.sku).trim(), p);
      if (p.codigo_barras) byBarcode.set(String(p.codigo_barras).trim(), p);
    }

    const noEncontrados = [];
    const archivados = [];
    const updates = [];

    for (const row of parsed) {
      let prod = null;

      if (row.sku && bySku.has(row.sku)) prod = bySku.get(row.sku);
      if (!prod && isUsableIdentifier(row.barcode) && byBarcode.has(row.barcode)) prod = byBarcode.get(row.barcode);

      if (!prod) {
        noEncontrados.push({
          fila: row.fila,
          barcode: row.barcode,
          sku: row.sku || null,
          articulo: row.articulo,
          precio_cliente_final: row.precioFinal,
          nota:
            "No se encontró producto por SKU/Bar Code. (Si no tenía Bar Code real, usa el SKU del sistema en tu Excel para matchear.)",
        });
        continue;
      }

      if (prod.archivado) {
        archivados.push({
          fila: row.fila,
          barcode: row.barcode,
          sku: row.sku || prod.sku,
          articulo: row.articulo,
          nota: "Producto está archivado; no se actualiza por seguridad.",
        });
        continue;
      }

      let mayoristaFinal = null;
      if (row.mayoristaExcel !== null && row.mayoristaExcel !== undefined) {
        mayoristaFinal = Number(row.mayoristaExcel);
      } else if (prod.precio_mayorista !== null && prod.precio_mayorista !== undefined) {
        mayoristaFinal = Number(prod.precio_mayorista);
      } else {
        mayoristaFinal = Math.round(row.precioFinal * mayoristaFactor * 100) / 100;
      }

      updates.push({
        producto_id: prod.id,
        precio_venta: row.precioFinal,
        precio_mayorista: mayoristaFinal,
        categoria: row.categoria,
      });
    }

    if (updates.length === 0) {
      return res.json({
        ok: true,
        message: "Archivo leído, pero no hubo productos actualizables.",
        resumen: {
          filas_total: rows.length,
          filas_validas: parsed.length,
          actualizados: 0,
          no_encontrados: noEncontrados.length,
          archivados: archivados.length,
          invalidas: invalidas.length,
        },
        no_encontrados: noEncontrados.slice(0, 50),
        archivados: archivados.slice(0, 50),
        invalidas: invalidas.slice(0, 50),
      });
    }

    await prisma.$transaction(async (tx) => {
      const cats = Array.from(new Set(updates.map((u) => u.categoria).filter(Boolean)));
      const catMap = new Map();

      for (const c of cats) {
        const cat = await findOrCreateCategoriaPorNombre(tx, c);
        if (cat) catMap.set(c, cat.id);
      }

      for (const u of updates) {
        await tx.productos.update({
          where: { id: u.producto_id },
          data: {
            precio_venta: Number(u.precio_venta),
            precio_mayorista:
              u.precio_mayorista == null || u.precio_mayorista === ""
                ? null
                : Number(u.precio_mayorista),
            activo: true,
            archivado: false,
          },
        });

        const catId = u.categoria ? catMap.get(u.categoria) : null;
        if (catId) {
          await tx.productos_categorias.deleteMany({
            where: { producto_id: u.producto_id },
          });
          await tx.productos_categorias.create({
            data: {
              producto_id: u.producto_id,
              categoria_id: catId,
            },
          });
        }
      }
    });

    return res.json({
      ok: true,
      message: "Archivo procesado correctamente. Precios de venta actualizados sin duplicar productos.",
      resumen: {
        filas_total: rows.length,
        filas_validas: parsed.length,
        actualizados: updates.length,
        no_encontrados: noEncontrados.length,
        archivados: archivados.length,
        invalidas: invalidas.length,
        mayorista_factor_usado: mayoristaFactor,
      },
      no_encontrados: noEncontrados.slice(0, 50),
      archivados: archivados.slice(0, 50),
      invalidas: invalidas.slice(0, 50),
    });
  } catch (err) {
    console.error("Error importSalesExcel:", err);

    if (err && err.statusCode === 400) {
      return res.status(400).json({ ok: false, message: err.message });
    }

    return res.status(500).json({ ok: false, message: "Error al procesar archivo de ventas" });
  }
}

module.exports = {
  createSale,
  crearVentaPOS, // ✅ POS ahora hace auto-traspaso BODEGA->VITRINA si falta stock
  createManualProduct,
  deleteManualProduct,
  bulkUpdateProducts,
  importSalesExcel,
};
