// src/controllers/sales.controller.js
const prisma = require("../config/prisma");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";

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
      await updateZeroSinceForProducts(tx, items.map((it) => it.producto_id));

      return venta;
    });

    notifySummarySubscribers().catch(() => {});
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

async function recordCambioCajaChica(tx, { sucursalId, cajeraId, cambio, venta, itemsCount, totalVenta }) {
  const monto = Number(cambio || 0);
  if (!Number.isFinite(monto) || monto <= 0) return;

  const refBase = venta?.folio ? `Cambio venta #${venta.folio}` : `Cambio venta ${venta?.id || ""}`;
  const itemsLabel =
    Number.isFinite(itemsCount) && itemsCount > 0 ? ` · ${itemsCount} items` : "";
  const totalLabel =
    Number.isFinite(totalVenta) && totalVenta > 0
      ? ` · Total Q ${Number(totalVenta).toFixed(2)}`
      : "";
  const ref = `${refBase}${itemsLabel}${totalLabel}`;

  await tx.caja_chica_gastos.create({
    data: {
      sucursal_id: sucursalId,
      cajera_id: cajeraId,
      autorizado_por_id: cajeraId,
      monto,
      motivo: ref.trim(),
    },
  });
}

/* =========================================================
 *  ✅ AUTO-CIERRE DE CAJA (POS)
 *  - Cierra caja si:
 *      a) cambio de día (hora Guatemala)
 *      b) pasó 23:50 (hora Guatemala)
 *  - Si cerró: bloquea venta para no mezclar días.
 * =======================================================*/

const BUSINESS_TZ = process.env.BUSINESS_TZ || "America/Guatemala";
const AUTO_CLOSE_AT = { hour: 23, minute: 50 };

function tzParts(date, tz = BUSINESS_TZ) {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    const parts = fmt.formatToParts(date);
    const map = {};
    for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;

    return {
      year: Number(map.year),
      month: Number(map.month),
      day: Number(map.day),
      hour: Number(map.hour),
      minute: Number(map.minute),
      second: Number(map.second),
    };
  } catch (_) {
    // fallback: TZ del server (no ideal, pero no revienta)
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
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function tzOffsetMinutes(date, tz = BUSINESS_TZ) {
  const p = tzParts(date, tz);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUTC - date.getTime()) / 60000);
}

function makeDateInTz(y, m, d, hh, mm, ss, tz = BUSINESS_TZ) {
  let guess = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
  for (let i = 0; i < 2; i++) {
    const off = tzOffsetMinutes(guess, tz);
    guess = new Date(Date.UTC(y, m - 1, d, hh, mm, ss) - off * 60000);
  }
  return guess;
}

function shouldAutoCloseCaja(cierreAbierto, tz = BUSINESS_TZ) {
  if (!cierreAbierto) return { should: false, reason: null, endTs: null };

  const now = new Date();

  const nowY = tzYMD(now, tz);
  const startDate = cierreAbierto.fecha_inicio ? new Date(cierreAbierto.fecha_inicio) : null;
  const openY = startDate ? tzYMD(startDate, tz) : nowY;

  // ✅ Si ya es otro día en GT, cerrar a medianoche del día actual (00:00:00 GT)
  if (openY !== nowY) {
    const pNow = tzParts(now, tz);
    const startOfToday = makeDateInTz(pNow.year, pNow.month, pNow.day, 0, 0, 0, tz);
    return { should: true, reason: "DAY_CHANGE", endTs: startOfToday };
  }

  // ✅ Si ya pasó 23:50 GT, cerrar exactamente a las 23:50:00 GT del día actual
  const pNow = tzParts(now, tz);
  const mins = pNow.hour * 60 + pNow.minute;
  const threshold = AUTO_CLOSE_AT.hour * 60 + AUTO_CLOSE_AT.minute;

  if (mins >= threshold) {
    const cut = makeDateInTz(pNow.year, pNow.month, pNow.day, AUTO_CLOSE_AT.hour, AUTO_CLOSE_AT.minute, 0, tz);
    return { should: true, reason: "CUTOFF_2350", endTs: cut };
  }

  return { should: false, reason: null, endTs: null };
}

function toNumberSafeMoney(val) {
  if (val === null || val === undefined) return 0;
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

async function findCajaAbiertaPOS(userId, sucursalId) {
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
    // fallback si no existe cerrado_at
    const cierre = await prisma.cierres_caja.findFirst({
      where: {
        usuario_id: userId,
        sucursal_id: sucursalId,
        fecha_fin: null,
      },
      orderBy: { fecha_inicio: "desc" },
    });
    return cierre || null;
  }
}

async function markCajaCerradaPOS(tx, cierreId) {
  try {
    await tx.$executeRaw`
      UPDATE public.cierres_caja
      SET cerrado_at = now()
      WHERE id = ${cierreId}::uuid;
    `;
  } catch (_) {
    // compatibilidad si no existe la columna
  }
}

async function getTotalesPagosPOS(tx, sucursalId, userId, startTs, endTs) {
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
    efectivo: toNumberSafeMoney(r.efectivo),
    transferencia: toNumberSafeMoney(r.transferencia),
    tarjeta: toNumberSafeMoney(r.tarjeta),
  };
}

async function closeCajaAutomaticoPOS(userId, sucursalId, cierreAbierto, endTs) {
  const startTs = cierreAbierto.fecha_inicio ? new Date(cierreAbierto.fecha_inicio) : new Date();
  let end = endTs instanceof Date ? endTs : new Date(endTs || new Date());

  // defensivo: si alguien abrió caja después del corte, no hacemos rangos negativos
  if (end.getTime() < startTs.getTime()) {
    end = new Date(startTs);
  }

  const actualizado = await prisma.$transaction(async (tx) => {
    const totals = await getTotalesPagosPOS(tx, sucursalId, userId, startTs, end);

    const efectivo = Number((totals.efectivo || 0).toFixed(2));
    const transferencia = Number((totals.transferencia || 0).toFixed(2));
    const tarjeta = Number((totals.tarjeta || 0).toFixed(2));
    const totalGeneral = Number((efectivo + transferencia + tarjeta).toFixed(2));

    const cierreUpdate = await tx.cierres_caja.update({
      where: { id: cierreAbierto.id },
      data: {
        fecha_fin: end,

        total_efectivo: efectivo,
        total_transferencia: transferencia,
        total_tarjeta: tarjeta,
        total_general: totalGeneral,

        // auto-cierre: no hay contado
        monto_cierre_reportado: null,
        diferencia: null,
      },
    });

    await markCajaCerradaPOS(tx, cierreAbierto.id);

    return cierreUpdate;
  });

  return actualizado;
}

async function autoCloseCajaIfNeededPOS(userId, sucursalId) {
  const abierta = await findCajaAbiertaPOS(userId, sucursalId);
  if (!abierta) return { status: "NO_OPEN", closed: false, reason: null, cierre: null };

  // defensivo: si ya trae fecha_fin, no la tratamos como abierta
  if (abierta.fecha_fin) return { status: "NO_OPEN", closed: false, reason: null, cierre: null };

  const d = shouldAutoCloseCaja(abierta, BUSINESS_TZ);
  if (!d.should) {
    return { status: "OPEN", closed: false, reason: null, cierre: abierta };
  }

  const cierreCerrado = await closeCajaAutomaticoPOS(userId, sucursalId, abierta, d.endTs);
  return { status: "CLOSED", closed: true, reason: d.reason, cierre: cierreCerrado };
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

async function updateZeroSinceForProducts(tx, productoIds) {
  const uniq = Array.from(
    new Set((productoIds || []).map((x) => String(x || "").trim()).filter(Boolean))
  );
  if (uniq.length === 0) return;

  for (const pid of uniq) {
    const agg = await tx.inventario_existencias.aggregate({
      where: { producto_id: pid },
      _sum: { stock: true },
    });

    const total = toNumberSafe(agg._sum.stock);

    if (total <= 0) {
      await tx.productos.updateMany({
        where: { id: pid, zero_since: null },
        data: { zero_since: new Date() },
      });
    } else {
      await tx.productos.updateMany({
        where: { id: pid, NOT: { zero_since: null } },
        data: { zero_since: null },
      });
    }
  }
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

    // =======================================================
    // ✅ NUEVO: Auto-cierre de caja (23:50 GT o cambio de día GT)
    // - Si NO hay caja abierta: bloquea venta (para mantener el día cuadrado)
    // - Si se autocerró: bloquea venta y exige aperturar caja.
    // =======================================================
    const cajaCheck = await autoCloseCajaIfNeededPOS(usuarioId, sucursalId);

    if (cajaCheck.status === "NO_OPEN") {
      return res.status(400).json({
        ok: false,
        code: "CAJA_NO_ABIERTA",
        message: "Debes aperturar la caja antes de vender.",
      });
    }

    if (cajaCheck.status === "CLOSED") {
      return res.status(409).json({
        ok: false,
        code: "CAJA_AUTOCERRADA",
        reason: cajaCheck.reason, // DAY_CHANGE | CUTOFF_2350
        message:
          cajaCheck.reason === "DAY_CHANGE"
            ? "La caja anterior se cerró automáticamente por cambio de día (hora Guatemala). Abre caja para continuar."
            : "Se alcanzó el corte de cierre (23:50, hora Guatemala). La caja se cerró automáticamente. Abre caja para continuar.",
        cierre: cajaCheck.cierre
          ? { id: cajaCheck.cierre.id, fecha_fin: cajaCheck.cierre.fecha_fin }
          : null,
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
        precio_mayorista: true,
        activo: true,
        archivado: true,
      },
    });

    const mapProd = new Map(productos.map((p) => [String(p.id), p]));

    // Validaciones + precio unitario fallback a precio_venta
    const totalQty = cleanItems.reduce((acc, it) => acc + (Number(it.cantidad) || 0), 0);
    const wholesaleApplies = totalQty >= 6;

    for (const it of cleanItems) {
      const p = mapProd.get(it.producto_id);
      if (!p) return res.status(404).json({ ok: false, message: "Producto no encontrado" });

      if (p.archivado || !p.activo) {
        return res.status(400).json({ ok: false, message: `Producto no disponible: ${p.nombre}` });
      }

      if (wholesaleApplies && p.precio_mayorista != null && Number(p.precio_mayorista) > 0) {
        it.precio_unitario = Number(p.precio_mayorista);
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
      await updateZeroSinceForProducts(tx, cleanItems.map((it) => it.producto_id));

      if (metodo === "EFECTIVO" && cambio && Number(cambio) > 0) {
        const itemsCount = cleanItems.reduce(
          (sum, it) => sum + Number(it.cantidad || 0),
          0
        );
        await recordCambioCajaChica(tx, {
          sucursalId,
          cajeraId: usuarioId,
          cambio,
          venta,
          itemsCount,
          totalVenta: total,
        });
      }

      return venta;
    });

    notifySummarySubscribers().catch(() => {});
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

/* =========================================================
 *  ✅ NUEVO: RESUMEN DEL DÍA (Mini Dashboard)
 *  - Totales por método (EFECTIVO / TRANSFERENCIA / TARJETA)
 *  - # ventas confirmadas
 *  - Producto más vendido (por cantidad)
 *  - Categoría más vendida (por cantidad)
 *  - Top 5 productos
 *
 *  🔥 “Tiempo real”: el frontend hace polling a este endpoint.
 *  ✅ Consistente con caja: si ya pasaron las 23:50 (GT), “corta” en 23:50.
 * =======================================================*/

function getSummaryRangeInTzNow(tz = BUSINESS_TZ) {
  const now = new Date();
  const p = tzParts(now, tz);

  const start = makeDateInTz(p.year, p.month, p.day, 0, 0, 0, tz);
  const cutoff = makeDateInTz(p.year, p.month, p.day, AUTO_CLOSE_AT.hour, AUTO_CLOSE_AT.minute, 0, tz);

  // Si ya pasó el corte, congelamos el resumen en el corte (para cuadrar con cierre de caja)
  const end = now.getTime() >= cutoff.getTime() ? cutoff : now;

  return { start, end, cutoff };
}

function parseYmd(dateStr) {
  if (!dateStr) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr).trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return { y, mo, d, ymd: `${m[1]}-${m[2]}-${m[3]}` };
}

function getSummaryRangeForDate(dateStr, tz = BUSINESS_TZ) {
  if (!dateStr) return getSummaryRangeInTzNow(tz);

  const parsed = parseYmd(dateStr);
  if (!parsed) return null;

  const { y, mo, d, ymd } = parsed;
  const start = makeDateInTz(y, mo, d, 0, 0, 0, tz);
  const cutoff = makeDateInTz(y, mo, d, AUTO_CLOSE_AT.hour, AUTO_CLOSE_AT.minute, 0, tz);

  const now = new Date();
  const todayYmd = tzYMD(now, tz);

  const end = ymd === todayYmd && now.getTime() < cutoff.getTime() ? now : cutoff;
  return { start, end, cutoff, ymd };
}

function money2(n) {
  const x = Number(n || 0);
  return Number.isFinite(x) ? Number(x.toFixed(2)) : 0;
}

async function getTotalesPagosSummary(tx, { sucursalId, userIdOrNull, startTs, endTs }) {
  if (userIdOrNull) {
    const rows = await tx.$queryRaw`
      SELECT
        COALESCE(SUM(CASE WHEN vp.metodo = 'EFECTIVO' THEN vp.monto ELSE 0 END), 0) AS efectivo,
        COALESCE(SUM(CASE WHEN vp.metodo = 'TRANSFERENCIA' THEN vp.monto ELSE 0 END), 0) AS transferencia,
        COALESCE(SUM(CASE WHEN vp.metodo = 'TARJETA' THEN vp.monto ELSE 0 END), 0) AS tarjeta
      FROM ventas v
      JOIN ventas_pagos vp ON vp.venta_id = v.id
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
    return rows?.[0] || {};
  }

  const rows = await tx.$queryRaw`
    SELECT
      COALESCE(SUM(CASE WHEN vp.metodo = 'EFECTIVO' THEN vp.monto ELSE 0 END), 0) AS efectivo,
      COALESCE(SUM(CASE WHEN vp.metodo = 'TRANSFERENCIA' THEN vp.monto ELSE 0 END), 0) AS transferencia,
      COALESCE(SUM(CASE WHEN vp.metodo = 'TARJETA' THEN vp.monto ELSE 0 END), 0) AS tarjeta
    FROM ventas v
    JOIN ventas_pagos vp ON vp.venta_id = v.id
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
  return rows?.[0] || {};
}

async function getVentasCountSummary(tx, { sucursalId, userIdOrNull, startTs, endTs }) {
  if (userIdOrNull) {
    const rows = await tx.$queryRaw`
      SELECT COALESCE(COUNT(*),0)::int AS n
      FROM ventas v
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
    return Number(rows?.[0]?.n || 0);
  }

  const rows = await tx.$queryRaw`
    SELECT COALESCE(COUNT(*),0)::int AS n
    FROM ventas v
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
  return Number(rows?.[0]?.n || 0);
}

async function getTopProductoSummary(tx, { sucursalId, userIdOrNull, startTs, endTs, limit = 1 }) {
  if (userIdOrNull) {
    return await tx.$queryRaw`
      SELECT
        p.id AS producto_id,
        p.nombre,
        p.sku,
        COALESCE(SUM(d.cantidad),0)::int AS qty,
        COALESCE(SUM(d.total_linea),0)::numeric AS total
      FROM ventas v
      JOIN ventas_detalle d ON d.venta_id = v.id
      JOIN productos p ON p.id = d.producto_id
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
        ) < ${endTs}::timestamptz
      GROUP BY p.id, p.nombre, p.sku
      ORDER BY COALESCE(SUM(d.cantidad),0) DESC, COALESCE(SUM(d.total_linea),0) DESC
      LIMIT ${Number(limit)};
    `;
  }

  return await tx.$queryRaw`
    SELECT
      p.id AS producto_id,
      p.nombre,
      p.sku,
      COALESCE(SUM(d.cantidad),0)::int AS qty,
      COALESCE(SUM(d.total_linea),0)::numeric AS total
    FROM ventas v
    JOIN ventas_detalle d ON d.venta_id = v.id
    JOIN productos p ON p.id = d.producto_id
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
      ) < ${endTs}::timestamptz
    GROUP BY p.id, p.nombre, p.sku
    ORDER BY COALESCE(SUM(d.cantidad),0) DESC, COALESCE(SUM(d.total_linea),0) DESC
    LIMIT ${Number(limit)};
  `;
}

async function getTopCategoriaSummary(tx, { sucursalId, userIdOrNull, startTs, endTs }) {
  // Elegimos 1 categoría por producto (MIN(nombre)) para evitar duplicados si algún producto tiene múltiples categorías
  if (userIdOrNull) {
    return await tx.$queryRaw`
      WITH prod_cat AS (
        SELECT pc.producto_id, MIN(c.nombre) AS categoria
        FROM productos_categorias pc
        JOIN categorias c ON c.id = pc.categoria_id
        GROUP BY pc.producto_id
      )
      SELECT
        COALESCE(pc.categoria, 'Sin categoría') AS categoria,
        COALESCE(SUM(d.cantidad),0)::int AS qty,
        COALESCE(SUM(d.total_linea),0)::numeric AS total
      FROM ventas v
      JOIN ventas_detalle d ON d.venta_id = v.id
      JOIN productos p ON p.id = d.producto_id
      LEFT JOIN prod_cat pc ON pc.producto_id = p.id
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
        ) < ${endTs}::timestamptz
      GROUP BY 1
      ORDER BY COALESCE(SUM(d.cantidad),0) DESC, COALESCE(SUM(d.total_linea),0) DESC
      LIMIT 1;
    `;
  }

  return await tx.$queryRaw`
    WITH prod_cat AS (
      SELECT pc.producto_id, MIN(c.nombre) AS categoria
      FROM productos_categorias pc
      JOIN categorias c ON c.id = pc.categoria_id
      GROUP BY pc.producto_id
    )
    SELECT
      COALESCE(pc.categoria, 'Sin categoría') AS categoria,
      COALESCE(SUM(d.cantidad),0)::int AS qty,
      COALESCE(SUM(d.total_linea),0)::numeric AS total
    FROM ventas v
    JOIN ventas_detalle d ON d.venta_id = v.id
    JOIN productos p ON p.id = d.producto_id
    LEFT JOIN prod_cat pc ON pc.producto_id = p.id
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
      ) < ${endTs}::timestamptz
    GROUP BY 1
    ORDER BY COALESCE(SUM(d.cantidad),0) DESC, COALESCE(SUM(d.total_linea),0) DESC
    LIMIT 1;
  `;
}

async function buildSummaryData({
  usuarioId,
  roleNorm,
  scope,
  sucursalId,
  dateStr,
}) {
  if (!usuarioId) {
    const e = new Error("No autenticado");
    e.statusCode = 401;
    throw e;
  }

  if (!sucursalId) {
    const e = new Error("sucursal_id es requerido (asigna usuarios.sucursal_id o crea SP).");
    e.statusCode = 400;
    throw e;
  }

  const userIdOrNull =
    roleNorm === "ADMIN" && String(scope || "").toUpperCase() === "SUCURSAL"
      ? null
      : usuarioId;

  const range = getSummaryRangeForDate(dateStr, BUSINESS_TZ);
  if (!range) {
    const e = new Error("date invalida. Formato esperado: YYYY-MM-DD");
    e.statusCode = 400;
    throw e;
  }

  const { start, end, cutoff, ymd } = range;

  const data = await prisma.$transaction(async (tx) => {
    const pagos = await getTotalesPagosSummary(tx, {
      sucursalId,
      userIdOrNull,
      startTs: start,
      endTs: end,
    });

    const efectivo = money2(pagos.efectivo);
    const transferencia = money2(pagos.transferencia);
    const tarjeta = money2(pagos.tarjeta);
    const totalGeneral = money2(efectivo + transferencia + tarjeta);

    const numVentas = await getVentasCountSummary(tx, {
      sucursalId,
      userIdOrNull,
      startTs: start,
      endTs: end,
    });

    const top1 = await getTopProductoSummary(tx, {
      sucursalId,
      userIdOrNull,
      startTs: start,
      endTs: end,
      limit: 1,
    });

    const top5 = await getTopProductoSummary(tx, {
      sucursalId,
      userIdOrNull,
      startTs: start,
      endTs: end,
      limit: 5,
    });

    const topCat = await getTopCategoriaSummary(tx, {
      sucursalId,
      userIdOrNull,
      startTs: start,
      endTs: end,
    });

    const topProductoRow = Array.isArray(top1) ? top1[0] : null;
    const topCatRow = Array.isArray(topCat) ? topCat[0] : null;

    return {
      date: ymd || tzYMD(new Date(), BUSINESS_TZ),
      timezone: BUSINESS_TZ,
      range: {
        start: start.toISOString(),
        end: end.toISOString(),
        cutoff: cutoff.toISOString(),
        cutoff_applied: end.getTime() === cutoff.getTime(),
      },
      scope: userIdOrNull ? "USER" : "SUCURSAL",
      totals: {
        total_general: totalGeneral,
        efectivo,
        transferencia,
        tarjeta,
        num_ventas: Number(numVentas || 0),
      },
      top: {
        producto: topProductoRow
          ? {
              producto_id: String(topProductoRow.producto_id),
              nombre: String(topProductoRow.nombre || ""),
              sku: String(topProductoRow.sku || ""),
              qty: Number(topProductoRow.qty || 0),
              total: money2(topProductoRow.total),
            }
          : null,
        categoria: topCatRow
          ? {
              categoria: String(topCatRow.categoria || "Sin categoria"),
              qty: Number(topCatRow.qty || 0),
              total: money2(topCatRow.total),
            }
          : null,
      },
      top_productos: Array.isArray(top5)
        ? top5.map((r) => ({
            producto_id: String(r.producto_id),
            nombre: String(r.nombre || ""),
            sku: String(r.sku || ""),
            qty: Number(r.qty || 0),
            total: money2(r.total),
          }))
        : [],
      updated_at: new Date().toISOString(),
    };
  });

  return data;
}

const summarySseClients = new Map();

function sseWrite(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function sendSummaryToClient(client) {
  const data = await buildSummaryData({
    usuarioId: client.usuarioId,
    roleNorm: client.roleNorm,
    scope: client.scope,
    sucursalId: client.sucursalId,
    dateStr: client.dateStr,
  });
  sseWrite(client.res, "summary", { ok: true, data });
}

async function notifySummarySubscribers() {
  const entries = Array.from(summarySseClients.entries());
  await Promise.all(
    entries.map(async ([id, client]) => {
      if (!client || !client.res || client.res.writableEnded) {
        summarySseClients.delete(id);
        return;
      }
      try {
        await sendSummaryToClient(client);
      } catch (e) {
        sseWrite(client.res, "error", { ok: false, message: e?.message || "Error SSE" });
      }
    })
  );
}

/**
 * ✅ GET resumen del día
 * Query opcional:
 *  - scope=USER | SUCURSAL
 *    * USER (default): resumen solo de la cajera (usuario actual)
 *    * SUCURSAL: resumen de TODA la sucursal (solo admin)
 */
async function resumenVentasHoy(req, res) {
  try {
    const usuarioId = req.user?.userId;
    if (!usuarioId) {
      return res.status(401).json({ ok: false, message: "No autenticado" });
    }

    const roleNorm = String(req.user?.roleName ?? "").trim().toUpperCase();
    const scope = String(req.query?.scope ?? "USER").trim().toUpperCase();

    // sucursal por usuario (fallback SP)
    let sucursalId = await resolveSucursalIdForUser(usuarioId);

    // Admin puede forzar sucursal
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
    const data = await buildSummaryData({
      usuarioId,
      roleNorm,
      scope,
      sucursalId,
      dateStr,
    });

    res.setHeader("Cache-Control", "no-store");
    return res.json({ ok: true, data });
  } catch (err) {
    console.error("Error resumenVentasHoy:", err);
    return res.status(500).json({ ok: false, message: "Error generando resumen del día" });
  }
}

async function resumenVentasStream(req, res) {
  try {
    const header = req.headers?.authorization || "";
    const headerToken = header.startsWith("Bearer ") ? header.split(" ")[1] : null;
    const token = String(req.query?.token || headerToken || "").trim();

    if (!token) {
      return res.status(401).json({ ok: false, message: "Token requerido" });
    }

    let payload = null;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ ok: false, message: "Token invalido" });
    }

    const usuarioId = payload?.userId;
    const roleNorm = String(payload?.roleName ?? "").trim().toUpperCase();
    const scope = String(req.query?.scope ?? "USER").trim().toUpperCase();

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

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const clientId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const client = {
      res,
      usuarioId,
      roleNorm,
      scope,
      sucursalId,
      dateStr,
    };
    summarySseClients.set(clientId, client);

    try {
      await sendSummaryToClient(client);
    } catch (e) {
      sseWrite(res, "error", { ok: false, message: e?.message || "Error SSE" });
      summarySseClients.delete(clientId);
      return res.end();
    }

    const keepAlive = setInterval(() => {
      if (res.writableEnded) return;
      res.write(": ping\n\n");
    }, 25000);

    req.on("close", () => {
      clearInterval(keepAlive);
      summarySseClients.delete(clientId);
    });
  } catch (err) {
    console.error("Error resumenVentasStream:", err);
    try {
      res.status(500).json({ ok: false, message: "Error stream resumen" });
    } catch {}
  }
}

module.exports = {
  createSale,
  crearVentaPOS, // ✅ POS ahora hace auto-traspaso BODEGA->VITRINA si falta stock
  createManualProduct,
  deleteManualProduct,
  bulkUpdateProducts,
  importSalesExcel,

  // ✅ NUEVO
  resumenVentasHoy,
  resumenVentasStream,
  buildSummaryData,
};
