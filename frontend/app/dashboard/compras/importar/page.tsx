"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import AdminSidebar from "../../../_components/AdminSidebar";

import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import JsBarcode from "jsbarcode";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface User {
  id: string;
  nombre: string;
  email: string;
  rol: string;
}

interface ImportItem {
  codigo_barras?: string; // ahora SIEMPRE lo llenamos si falta (EAN-13)
  sku?: string;
  nombre_producto: string;
  categoria?: string;
  costo_compra: number;
  costo_envio: number; // se mantiene por compatibilidad, aunque no lo mostremos
  costo_impuestos: number;
  costo_desaduanaje: number;
  cantidad: number;
}

interface ImportResumenItem {
  fila: number;
  productoId: string;
  sku: string;
  codigo_barras: string | null;
  creado: boolean;
  cantidad: number;
  costoTotalUnit: number;
  precioVentaSugerido: number;
}

interface LabelToPrint {
  producto_id?: string; // puede venir del backend o no
  sku: string;
  nombre: string;
  codigo_barras: string;
}

interface ImportResponseData {
  compra: any;
  resumen: ImportResumenItem[];
  labelsToPrint: LabelToPrint[];
}

interface ImportResponse {
  ok: boolean;
  message: string;
  data: ImportResponseData;
}

export default function ImportComprasPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [resumen, setResumen] = useState<ImportResumenItem[]>([]);
  const [labelsToPrint, setLabelsToPrint] = useState<LabelToPrint[]>([]);
  const [labelsLocal, setLabelsLocal] = useState<LabelToPrint[]>([]); // ✅ etiquetas de códigos generados en FE

  const today = new Date().toLocaleDateString("es-GT", {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  // ==========================
  // 1) Verificar sesión
  // ==========================
  useEffect(() => {
    const t = localStorage.getItem("joyeria_token");
    const uStr = localStorage.getItem("joyeria_user");

    if (!t || !uStr) {
      router.push("/login");
      return;
    }

    try {
      const u: User = JSON.parse(uStr);
      setUser(u);
      setToken(t);
    } catch {
      router.push("/login");
    }
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem("joyeria_token");
    localStorage.removeItem("joyeria_user");
    router.push("/login");
  };

  // ==========================
  // 2) Descargar plantilla CSV (sin envío)
  // ==========================
  const handleDownloadTemplate = () => {
    const header =
      "codigo_barras,sku,nombre_producto,categoria,costo_compra,costo_impuestos,costo_desaduanaje,cantidad\n";
    const exampleRow = ",,Aretes oro 14K,ARETES,100,5,3,2\n";

    const csv = header + exampleRow;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plantilla_compra_masiva.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ==========================
  // Helpers: normalización
  // ==========================
  const normalizeText = (s: any) =>
    String(s ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

  const normalizeKeyLite = (s: any) =>
    normalizeText(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

  // placeholders genéricos (para SKU/campos)
  const isPlaceholder = (v: any) => {
    const s = String(v ?? "").trim();
    if (!s) return true;
    if (s === "—" || s === "-" || s === "–") return true;
    if (/^[A-Za-z]$/.test(s)) return true; // "E", "R", etc.
    return false;
  };

  // ✅ Placeholder especial para barcode (más agresivo)
  const isBarcodePlaceholder = (v: any) => {
    const s = String(v ?? "").trim();
    if (!s) return true;

    const lower = s.toLowerCase();
    const bad = new Set([
      "-", "—", "–", "−", "_",
      "na", "n/a", "null", "none", "sin", "s/c", "sc",
    ]);

    if (bad.has(lower)) return true;
    if (/^[A-Za-z]$/.test(s)) return true; // UNA sola letra
    return false;
  };

  // ==========================
  // ✅ Generar EAN-13 válido (con dígito verificador)
  // ==========================
  const computeEan13CheckDigit = (base12: string) => {
    // base12 debe ser de 12 dígitos
    let sumOdd = 0;  // posiciones 1,3,5,... (0,2,4...)
    let sumEven = 0; // posiciones 2,4,6,... (1,3,5...)
    for (let i = 0; i < 12; i++) {
      const d = Number(base12[i] || "0");
      if (i % 2 === 0) sumOdd += d;
      else sumEven += d;
    }
    const total = sumOdd + sumEven * 3;
    const mod = total % 10;
    return (10 - mod) % 10;
  };

  const generateEan13Unique = (idx: number, seen: Set<string>) => {
    for (let tries = 0; tries < 80; tries++) {
      const rnd = Math.floor(Math.random() * 1_000_000)
        .toString()
        .padStart(6, "0");
      const seed = `${Date.now()}${rnd}${String(idx).padStart(3, "0")}`;

      const last10 = seed.slice(-10).padStart(10, "0");
      const base12 = `20${last10}`; // 12 dígitos (prefijo "20" para separar de tus códigos tipo X...)
      const cd = computeEan13CheckDigit(base12);
      const ean13 = `${base12}${cd}`;

      if (!seen.has(ean13)) {
        seen.add(ean13);
        return ean13;
      }
    }

    // fallback ultra raro
    while (true) {
      const last10 = Math.floor(Math.random() * 10_000_000_000)
        .toString()
        .padStart(10, "0");
      const base12 = `20${last10}`;
      const cd = computeEan13CheckDigit(base12);
      const ean13 = `${base12}${cd}`;
      if (!seen.has(ean13)) {
        seen.add(ean13);
        return ean13;
      }
    }
  };

  // ==========================
  // Helpers: categoría / SKU
  // ==========================
  const CANON_CATEGORIAS: Record<string, string> = {
    ARETES: "ARETES",
    ANILLOS: "ANILLOS",
    CADENAS: "CADENAS",
    PULSERAS: "PULSERAS",
    TOBILLERAS: "TOBILLERAS",
    BRAZALETES: "BRAZALETES",
    PENDIENTES: "PENDIENTES",
    SETS: "SETS",
  };

  const canonCategoria = (raw: any): string | undefined => {
    const k = normalizeKeyLite(raw);
    if (!k) return undefined;

    if (k.includes("arete")) return CANON_CATEGORIAS.ARETES;
    if (k.includes("anillo") || k.includes("ring")) return CANON_CATEGORIAS.ANILLOS;
    if (k.includes("cadena")) return CANON_CATEGORIAS.CADENAS;
    if (k.includes("pulsera")) return CANON_CATEGORIAS.PULSERAS;
    if (k.includes("tobillera")) return CANON_CATEGORIAS.TOBILLERAS;
    if (k.includes("brazalete") || k.includes("razalete")) return CANON_CATEGORIAS.BRAZALETES;
    if (k.includes("pendiente") || k.includes("endiente")) return CANON_CATEGORIAS.PENDIENTES;
    if (k.includes("set")) return CANON_CATEGORIAS.SETS;

    const upper = normalizeText(raw).toUpperCase();
    if (CANON_CATEGORIAS[upper]) return CANON_CATEGORIAS[upper];
    return upper || undefined;
  };

  const inferCategoriaFromArticulo = (articuloOrNombre: any): string | undefined => {
    const k = normalizeKeyLite(articuloOrNombre);
    if (!k) return undefined;

    if (k.startsWith("e_") || k.includes("e_arete") || k.includes("arete")) return CANON_CATEGORIAS.ARETES;
    if (k.startsWith("n_") || k.includes("n_cadena") || k.includes("cadena")) return CANON_CATEGORIAS.CADENAS;
    if (k.startsWith("a_") || k.includes("a_tobillera") || k.includes("tobillera")) return CANON_CATEGORIAS.TOBILLERAS;
    if (k.startsWith("b_") || k.includes("b_razalete") || k.includes("brazalete") || k.includes("razalete")) return CANON_CATEGORIAS.BRAZALETES;
    if (k.startsWith("p_") || k.includes("p_endiente") || k.includes("pendiente") || k.includes("endiente")) return CANON_CATEGORIAS.PENDIENTES;
    if (k.startsWith("bw") || k.includes("pulsera")) return CANON_CATEGORIAS.PULSERAS;
    if (k.includes("set")) return CANON_CATEGORIAS.SETS;

    if (k === "r" || k.includes("ring") || k.includes("anillo")) return CANON_CATEGORIAS.ANILLOS;

    return undefined;
  };

  const generarSkuDesdeNombreFE = (nombre: string) => {
    const clean = normalizeText(nombre);
    const base =
      clean
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 12) || "PROD";

    const rand = Math.floor(Math.random() * 9000) + 1000;
    return `${base}-${rand}`;
  };

  const makeUniqueSku = (sku: string, seen: Set<string>) => {
    let s = sku;
    let n = 2;
    while (seen.has(s)) {
      s = `${sku}-${n}`;
      n++;
    }
    seen.add(s);
    return s;
  };

  // ==========================
  // sheetToJsonSmart (excel “creativo”)
  // ==========================
  const sheetToJsonSmart = (sheet: XLSX.WorkSheet): Record<string, any>[] => {
    const normalizeKey = (s: string) =>
      String(s || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

    const toStr = (v: any) => (v === null || v === undefined ? "" : String(v).trim());

    const matrix = XLSX.utils.sheet_to_json<any[]>(sheet, {
      header: 1,
      defval: "",
      blankrows: false,
    }) as any[][];

    if (!matrix || matrix.length === 0) return [];

    const isRowEmpty = (r: any[]) => !r || r.every((c) => toStr(c) === "");

    let bestIdx = -1;
    let bestScore = -1;

    const limit = Math.min(matrix.length, 60);

    for (let i = 0; i < limit; i++) {
      const row = matrix[i];
      if (isRowEmpty(row)) continue;

      const normCells = row.map((c) => normalizeKey(toStr(c))).filter(Boolean);
      if (normCells.length < 3) continue;

      const set = new Set(normCells);
      const hasAny = (...keys: string[]) => keys.some((k) => set.has(k));

      let score = 0;

      if (hasAny("bar_code", "barcode", "codigo_barras")) score += 3;
      if (hasAny("articulo", "nombre_producto", "producto", "descripcion", "item", "nombre")) score += 3;
      if (hasAny("cantidad", "qty", "cant")) score += 3;

      if (hasAny("precio_unitario_compra_q", "precio_unitario_compra", "precio_unitario_q", "precio_unitario", "costo_compra")) {
        score += 3;
      }

      if (hasAny("costo_impuestos", "costo_desaduanaje")) score += 1;
      if (hasAny("pagos", "total")) score += 1;
      if (hasAny("sku")) score += 1;

      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) {
      bestIdx = matrix.findIndex((r) => !isRowEmpty(r));
      if (bestIdx === -1) return [];
    }

    const rawHeader = matrix[bestIdx] || [];
    const seen: Record<string, number> = {};

    const headers = rawHeader.map((h, colIdx) => {
      const base = normalizeKey(toStr(h)) || `col_${colIdx}`;
      if (!seen[base]) {
        seen[base] = 1;
        return base;
      }
      seen[base] += 1;
      return `${base}_${seen[base]}`;
    });

    const out: Record<string, any>[] = [];

    for (let r = bestIdx + 1; r < matrix.length; r++) {
      const row = matrix[r];
      if (isRowEmpty(row)) continue;

      const obj: Record<string, any> = {};
      for (let c = 0; c < headers.length; c++) {
        obj[headers[c]] = row[c] ?? "";
      }
      out.push(obj);
    }

    return out;
  };

  // ==========================
  // CSV -> Items (con barcode generado)
  // ==========================
  const parseCsvToItems = (csv: string): { items: ImportItem[]; labels: LabelToPrint[] } => {
    const lines = csv
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length < 2) throw new Error("El archivo no contiene datos suficientes.");

    const delimiter = lines[0].includes(";") ? ";" : ",";

    const headerCols = lines[0].split(delimiter).map((h) => h.trim());
    const normalizedHeaders = headerCols.map((h) => normalizeKeyLite(h).replace(/\s+/g, "_"));

    const getIndex = (key: string) => {
      const idx = normalizedHeaders.indexOf(key);
      return idx >= 0 ? idx : -1;
    };

    const idxCodigoBarras = getIndex("codigo_barras");
    const idxSku = getIndex("sku");
    const idxNombre = getIndex("nombre_producto");
    const idxCategoria = getIndex("categoria");
    const idxCostoCompra = getIndex("costo_compra");
    const idxCostoEnvio = getIndex("costo_envio"); // opcional aunque no esté en plantilla
    const idxCostoImpuestos = getIndex("costo_impuestos");
    const idxCostoDesaduanaje = getIndex("costo_desaduanaje");
    const idxCantidad = getIndex("cantidad");

    if (idxNombre === -1 || idxCostoCompra === -1 || idxCantidad === -1) {
      throw new Error("La plantilla debe contener al menos: nombre_producto, costo_compra, cantidad.");
    }

    const toNumber = (value: string | undefined): number => {
      if (!value) return 0;
      let s = String(value).trim();
      s = s.replace(/[^\d.,-]/g, "");
      const hasDot = s.includes(".");
      const hasComma = s.includes(",");
      if (hasDot && hasComma) s = s.replace(/,/g, "");
      else if (!hasDot && hasComma) s = s.replace(/,/g, ".");
      const n = parseFloat(s);
      return Number.isNaN(n) ? 0 : n;
    };

    const itemsParsed: ImportItem[] = [];
    const labels: LabelToPrint[] = [];

    const seenSkus = new Set<string>();
    const seenBarcodes = new Set<string>();

    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split(delimiter);
      if (row.length === 1 && row[0].trim() === "") continue;

      const codigo_barras_raw = idxCodigoBarras >= 0 ? String(row[idxCodigoBarras] ?? "").trim() : "";
      const sku_raw = idxSku >= 0 ? String(row[idxSku] ?? "").trim() : "";
      const nombre_producto = idxNombre >= 0 ? String(row[idxNombre] ?? "").trim() : "";
      const categoria_raw = idxCategoria >= 0 ? String(row[idxCategoria] ?? "").trim() : "";

      const costo_compra = idxCostoCompra >= 0 ? toNumber(row[idxCostoCompra]) : 0;
      const costo_envio = idxCostoEnvio >= 0 ? toNumber(row[idxCostoEnvio]) : 0;
      const costo_impuestos = idxCostoImpuestos >= 0 ? toNumber(row[idxCostoImpuestos]) : 0;
      const costo_desaduanaje = idxCostoDesaduanaje >= 0 ? toNumber(row[idxCostoDesaduanaje]) : 0;
      const cantidad = idxCantidad >= 0 ? toNumber(row[idxCantidad]) : 0;

      if (!nombre_producto && !sku_raw && !codigo_barras_raw) continue;
      if (!cantidad || cantidad <= 0) continue;
      if (!costo_compra || costo_compra <= 0) continue;

      const categoria = canonCategoria(categoria_raw) || inferCategoriaFromArticulo(nombre_producto);

      const skuBase = !isPlaceholder(sku_raw)
        ? sku_raw
        : generarSkuDesdeNombreFE(nombre_producto || categoria || "PROD");
      const sku = makeUniqueSku(skuBase, seenSkus);

      // ✅ Barcode: si es placeholder => generamos EAN-13 (y se muestra YA en vista previa)
      let codigo_barras_final = codigo_barras_raw;
      const wasAuto = isBarcodePlaceholder(codigo_barras_raw);

      if (wasAuto) {
        codigo_barras_final = generateEan13Unique(i, seenBarcodes);
      } else {
        // si vino algo real, lo respetamos y solo evitamos duplicados dentro del archivo
        if (codigo_barras_final) {
          if (seenBarcodes.has(codigo_barras_final)) {
            // si repetido en el archivo, generamos uno nuevo para no explotar después
            codigo_barras_final = generateEan13Unique(i, seenBarcodes);
          } else {
            seenBarcodes.add(codigo_barras_final);
          }
        }
      }

      const nombreFinal = nombre_producto || sku;

      itemsParsed.push({
        codigo_barras: codigo_barras_final,
        sku,
        nombre_producto: nombreFinal,
        categoria,
        costo_compra,
        costo_envio,
        costo_impuestos,
        costo_desaduanaje,
        cantidad,
      });

      if (wasAuto) {
        labels.push({
          sku,
          nombre: nombreFinal,
          codigo_barras: codigo_barras_final,
        });
      }
    }

    if (itemsParsed.length === 0) throw new Error("No se pudieron obtener filas válidas del archivo.");

    return { items: itemsParsed, labels };
  };

  // ==========================
  // XLSX -> Items (con barcode generado)
  // ==========================
  const parseXlsxRowsToItems = (rows: Record<string, any>[]): { items: ImportItem[]; labels: LabelToPrint[] } => {
    const normalizeKey = (s: string) =>
      String(s || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

    const buildNormRow = (row: Record<string, any>) => {
      const out: Record<string, any> = {};
      Object.keys(row || {}).forEach((k) => {
        out[normalizeKey(k)] = row[k];
      });
      return out;
    };

    const toStr = (v: any) => (v === null || v === undefined ? "" : String(v).trim());

    const toNumberMoney = (val: any): number => {
      if (val === null || val === undefined || val === "") return 0;
      if (typeof val === "number") return Number.isFinite(val) ? val : 0;

      let s = String(val).trim();
      if (!s) return 0;

      s = s.replace(/[^\d.,-]/g, "");
      const hasDot = s.includes(".");
      const hasComma = s.includes(",");

      if (hasDot && hasComma) s = s.replace(/,/g, "");
      else if (!hasDot && hasComma) s = s.replace(/,/g, ".");

      const n = parseFloat(s);
      return Number.isNaN(n) ? 0 : n;
    };

    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

    const pick = (r: Record<string, any>, keys: string[]) => {
      for (const k of keys) {
        if (r[k] !== undefined) return r[k];
      }
      return undefined;
    };

    let totalImpuestosGlobal = 0;
    let totalDesaduanajeGlobal = 0;
    let totalEnvioGlobal = 0;

    const itemsParsed: ImportItem[] = [];
    const labels: LabelToPrint[] = [];

    let anyImpuestosFila = false;
    let anyDesaduFila = false;
    let anyEnvioFila = false;

    const seenSkus = new Set<string>();
    const seenBarcodes = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const row = buildNormRow(rows[i] || {});

      // Totales globales desde PAGOS/TOTAL
      const pagos = toStr(pick(row, ["pagos", "pago", "payments"])).toLowerCase();
      const totalCell = pick(row, ["total", "total_q", "total_gtq", "total_pago"]);

      if (pagos.includes("impuesto")) {
        const n = toNumberMoney(totalCell);
        if (n > 0) totalImpuestosGlobal = n;
      }
      if (pagos.includes("desadu") || pagos.includes("aduana")) {
        const n = toNumberMoney(totalCell);
        if (n > 0) totalDesaduanajeGlobal = n;
      }
      if (pagos.includes("envio") || pagos.includes("flete") || pagos.includes("shipping")) {
        const n = toNumberMoney(totalCell);
        if (n > 0) totalEnvioGlobal = n;
      }

      const codigoBarrasRaw = toStr(pick(row, ["codigo_barras", "barcode", "bar_code"]));
      const skuRaw = toStr(pick(row, ["sku"]));

      const nombreRaw = toStr(
        pick(row, ["nombre_producto", "nombre", "producto", "descripcion", "articulo", "item"])
      );

      const categoriaRaw = toStr(pick(row, ["categoria", "category"]));
      const cantidad = toNumberMoney(pick(row, ["cantidad", "qty", "cant"]));

      const costoUnitQ = toNumberMoney(
        pick(row, ["costo_compra", "precio_unitario_compra_q", "precio_unitario_compra", "precio_unitario_q", "precio_unitario"])
      );

      const costoTotalQ = toNumberMoney(pick(row, ["precio_total_q", "precio_total", "total_q_producto"]));

      const costoCompra =
        costoUnitQ > 0 ? costoUnitQ : cantidad > 0 && costoTotalQ > 0 ? costoTotalQ / cantidad : 0;

      const costoEnvioFila = toNumberMoney(pick(row, ["costo_envio", "envio", "shipping", "flete"]));
      const costoImpuestosFila = toNumberMoney(pick(row, ["costo_impuestos", "impuestos", "tax", "taxes"]));
      const costoDesaduFila = toNumberMoney(pick(row, ["costo_desaduanaje", "desaduanaje", "aduana", "customs"]));

      if (costoEnvioFila > 0) anyEnvioFila = true;
      if (costoImpuestosFila > 0) anyImpuestosFila = true;
      if (costoDesaduFila > 0) anyDesaduFila = true;

      if (!cantidad || cantidad <= 0) continue;
      if (!costoCompra || costoCompra <= 0) continue;
      if (!nombreRaw && !skuRaw && isBarcodePlaceholder(codigoBarrasRaw)) continue;

      const skuBase = !isPlaceholder(skuRaw) ? skuRaw : generarSkuDesdeNombreFE(nombreRaw || "PROD");
      const skuFinal = makeUniqueSku(skuBase, seenSkus);

      const categoriaFinal = canonCategoria(categoriaRaw) || inferCategoriaFromArticulo(nombreRaw) || undefined;

      const wasAuto = isBarcodePlaceholder(codigoBarrasRaw);
      let codigo_barras_final = codigoBarrasRaw;

      if (wasAuto) {
        codigo_barras_final = generateEan13Unique(i, seenBarcodes);
      } else {
        if (codigo_barras_final) {
          if (seenBarcodes.has(codigo_barras_final)) {
            codigo_barras_final = generateEan13Unique(i, seenBarcodes);
          } else {
            seenBarcodes.add(codigo_barras_final);
          }
        }
      }

      const nombreFinal = nombreRaw || skuFinal || codigo_barras_final || "PRODUCTO";

      itemsParsed.push({
        codigo_barras: codigo_barras_final,
        sku: skuFinal,
        nombre_producto: nombreFinal,
        categoria: categoriaFinal,
        costo_compra: round2(costoCompra),
        costo_envio: round2(costoEnvioFila),
        costo_impuestos: round2(costoImpuestosFila),
        costo_desaduanaje: round2(costoDesaduFila),
        cantidad: round2(cantidad),
      });

      if (wasAuto) {
        labels.push({
          sku: skuFinal,
          nombre: nombreFinal,
          codigo_barras: codigo_barras_final,
        });
      }
    }

    if (itemsParsed.length === 0) {
      throw new Error(
        "No se encontraron filas válidas en la hoja de Excel. Revisa columnas tipo Bar Code/Articulo/Cantidad/Precio unitario COMPRA Q o la plantilla estándar."
      );
    }

    const sumBase = itemsParsed.reduce((acc, it) => acc + it.costo_compra * it.cantidad, 0);

    if (sumBase > 0) {
      if (!anyImpuestosFila && totalImpuestosGlobal > 0) {
        itemsParsed.forEach((it) => {
          const base = it.costo_compra * it.cantidad;
          const share = base / sumBase;
          const totalLinea = totalImpuestosGlobal * share;
          it.costo_impuestos = round2(totalLinea / it.cantidad);
        });
      }

      if (!anyDesaduFila && totalDesaduanajeGlobal > 0) {
        itemsParsed.forEach((it) => {
          const base = it.costo_compra * it.cantidad;
          const share = base / sumBase;
          const totalLinea = totalDesaduanajeGlobal * share;
          it.costo_desaduanaje = round2(totalLinea / it.cantidad);
        });
      }

      if (!anyEnvioFila && totalEnvioGlobal > 0) {
        itemsParsed.forEach((it) => {
          const base = it.costo_compra * it.cantidad;
          const share = base / sumBase;
          const totalLinea = totalEnvioGlobal * share;
          it.costo_envio = round2(totalLinea / it.cantidad);
        });
      }
    }

    return { items: itemsParsed, labels };
  };

  // ==========================
  // 3) Parsear archivo (CSV o Excel)
  // ==========================
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];

    setItems([]);
    setResumen([]);
    setLabelsToPrint([]);
    setLabelsLocal([]);
    setServerError(null);
    setServerMessage(null);
    setParseError(null);

    if (!file) {
      setFileName(null);
      return;
    }

    setFileName(file.name);

    const lower = file.name.toLowerCase();
    const isCsv = lower.endsWith(".csv");
    const isXlsx = lower.endsWith(".xlsx") || lower.endsWith(".xls");

    const reader = new FileReader();

    if (isCsv) {
      reader.onload = (evt) => {
        try {
          const text = String(evt.target?.result || "");
          const parsed = parseCsvToItems(text);
          setItems(parsed.items);
          setLabelsLocal(parsed.labels);
        } catch (err: any) {
          console.error(err);
          setParseError(err?.message || "No se pudo leer el archivo CSV. Revisa el formato.");
        }
      };
      reader.onerror = () => setParseError("Error leyendo el archivo CSV.");
      reader.readAsText(file, "utf-8");
    } else if (isXlsx) {
      reader.onload = (evt) => {
        try {
          const data = evt.target?.result;
          if (!data) throw new Error("Archivo vacío.");

          const workbook = XLSX.read(data, { type: "array" });
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];

          const smartRows = sheetToJsonSmart(sheet);
          const parsed = parseXlsxRowsToItems(smartRows);

          setItems(parsed.items);
          setLabelsLocal(parsed.labels);
        } catch (err: any) {
          console.error(err);
          setParseError(err?.message || "No se pudo leer el archivo Excel. Revisa la plantilla.");
        }
      };
      reader.onerror = () => setParseError("Error leyendo el archivo Excel.");
      reader.readAsArrayBuffer(file);
    } else {
      setParseError("Formato no soportado. Usa .csv, .xlsx o .xls.");
    }
  };

  // ==========================
  // 4) Enviar importación
  // ==========================
  const handleImport = async () => {
    if (!token) return;
    if (items.length === 0) {
      setParseError("Primero debes cargar un archivo con productos.");
      return;
    }

    setSaving(true);
    setServerError(null);
    setServerMessage(null);
    setResumen([]);
    setLabelsToPrint([]);

    try {
      const payload = {
        sucursalId: null,
        proveedorId: null,
        moneda: "GTQ",
        tipoCambio: 1,
        margenDefault: 0.4,
        items, // ✅ ya incluye código de barras real (si faltaba, fue generado aquí)
      };

      const res = await fetch(`${API_URL}/api/purchases/import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data: ImportResponse = await res.json();

      if (!res.ok || data.ok === false) {
        throw new Error(data.message || "Error importando compra masiva.");
      }

      setServerMessage(data.message || "Compra importada y confirmada correctamente.");
      setResumen(data.data?.resumen ?? []);

      // ✅ Si backend no envía labelsToPrint (porque ya mandamos barcode), usamos las locales
      const serverLabels = data.data?.labelsToPrint ?? [];
      setLabelsToPrint(serverLabels.length ? serverLabels : labelsLocal);
    } catch (err: any) {
      console.error(err);
      setServerError(err?.message || "No se pudo completar la importación masiva.");
    } finally {
      setSaving(false);
    }
  };

  // ==========================
  // 5) Generar PDF con todas las etiquetas
  // ==========================
  const handleDownloadLabelsPdf = () => {
    if (!labelsToPrint.length) return;
    if (typeof window === "undefined") return;

    const doc = new jsPDF({ unit: "mm", format: "a4" });

    const marginX = 8;
    const marginY = 8;
    const labelWidth = 60;
    const labelHeight = 30;
    const cols = 3;
    const rowsPerPage = 8;

    labelsToPrint.forEach((label, index) => {
      const indexInPage = index % (cols * rowsPerPage);
      const col = indexInPage % cols;
      const row = Math.floor(indexInPage / cols);

      if (indexInPage === 0 && index > 0) doc.addPage();

      const x = marginX + col * (labelWidth + marginX);
      const y = marginY + row * (labelHeight + marginY);

      const canvas = document.createElement("canvas");
      try {
        JsBarcode(canvas, label.codigo_barras, {
          format: "EAN13",
          displayValue: false,
          margin: 0,
        });
      } catch {
        JsBarcode(canvas, label.codigo_barras, {
          format: "CODE128",
          displayValue: false,
          margin: 0,
        });
      }

      const imgData = canvas.toDataURL("image/png");

      doc.roundedRect(x - 1, y - 1, labelWidth + 2, labelHeight + 2, 1, 1, "S");

      doc.setFontSize(7);
      doc.text((label.nombre || "").substring(0, 32), x, y + 3);
      doc.setFontSize(6);
      doc.text(`SKU: ${label.sku}`, x, y + 7);

      const barcodeHeight = 16;
      const barcodeWidth = labelWidth - 4;
      const barcodeX = x + 2;
      const barcodeY = y + 9;

      doc.addImage(imgData, "PNG", barcodeX, barcodeY, barcodeWidth, barcodeHeight);

      doc.setFontSize(7);
      doc.text(label.codigo_barras, x + labelWidth / 2, barcodeY + barcodeHeight + 4, {
        align: "center",
      });
    });

    doc.save("etiquetas_compra_masiva.pdf");
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#2b0a0b] text-[#f1e4d4]">
        Cargando sesión...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#2b0a0b] text-[#f8f1e6] flex">
      <AdminSidebar user={user} onLogout={handleLogout} />

      <div className="flex-1 flex flex-col">
        <header className="border-b border-[#5a1b22] bg-[#2b0a0b]/80 backdrop-blur flex items-center justify-between px-4 md:px-8 py-4 sticky top-0 z-10">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold">Importar compra masiva</h1>
            <p className="text-xs md:text-sm text-[#c9b296] capitalize">{today}</p>
          </div>
        </header>

        <main className="flex-1 px-4 md:px-8 py-6 space-y-6">
          <section className="bg-[#3a0d12]/80 border border-[#5a1b22] rounded-2xl p-4 space-y-4">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
              <div className="space-y-2">
                <h2 className="text-sm font-semibold">1. Preparar archivo de compra</h2>
                <p className="text-[11px] text-[#c9b296] max-w-xl">
                  Si el archivo trae código de barras real, se respeta. Si viene vacío, “-”, “—”, “NA” o una letra,
                  se genera automáticamente un EAN-13 válido y lo verás desde la vista previa.
                </p>

                <ul className="text-[11px] text-[#c9b296] list-disc list-inside space-y-1">
                  <li>
                    Columnas mínimas:{" "}
                    <span className="font-mono">nombre_producto, costo_compra, cantidad</span>
                  </li>
                  <li>
                    Opcionales recomendadas:{" "}
                    <span className="font-mono">codigo_barras, sku, categoria, costo_impuestos, costo_desaduanaje</span>
                  </li>
                  <li>Formato: CSV o Excel (.xlsx / .xls).</li>
                </ul>

                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#d6b25f]/60 text-[11px] text-[#e3c578] hover:bg-[#d6b25f]/10"
                >
                  Descargar plantilla CSV
                </button>
              </div>

              <div className="w-full md:w-80 space-y-2">
                <label className="text-xs text-[#e3d2bd]">2. Selecciona archivo (.csv / .xlsx / .xls)</label>
                <div className="flex flex-col gap-2">
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={handleFileChange}
                    className="block w-full text-xs text-[#f1e4d4]
                      file:mr-2 file:py-1.5 file:px-3
                      file:rounded-full file:border-0
                      file:text-xs file:font-semibold
                      file:bg-[#d6b25f] file:text-[#2b0a0b]
                      hover:file:bg-[#e3c578]
                      cursor-pointer
                    "
                  />
                  {fileName && (
                    <p className="text-[11px] text-[#c9b296]">
                      Archivo seleccionado:{" "}
                      <span className="font-mono text-[#f1e4d4]">{fileName}</span>
                    </p>
                  )}
                </div>

                {parseError && (
                  <p className="text-[11px] text-red-300 bg-red-900/40 border border-red-700/60 rounded-lg px-3 py-2 mt-1">
                    {parseError}
                  </p>
                )}

                {items.length > 0 && !parseError && (
                  <p className="text-[11px] text-[#e3c578] mt-1">
                    {items.length} filas válidas listas para importar.
                  </p>
                )}
              </div>
            </div>

            <div className="pt-2 flex flex-col md:flex-row md:items-center gap-2">
              <button
                type="button"
                disabled={saving || items.length === 0}
                onClick={handleImport}
                className="px-5 py-2.5 rounded-lg bg-[#d6b25f] hover:bg-[#e3c578] text-sm font-semibold text-[#2b0a0b] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {saving ? "Importando compra..." : "3. Confirmar importación"}
              </button>
            </div>

            {serverError && (
              <p className="text-[11px] text-red-300 bg-red-900/40 border border-red-700/60 rounded-lg px-3 py-2 mt-2">
                {serverError}
              </p>
            )}
            {serverMessage && (
              <p className="text-[11px] text-[#e3c578] bg-[#d6b25f]/10 border border-[#b98c3f]/60 rounded-lg px-3 py-2 mt-2">
                {serverMessage}
              </p>
            )}
          </section>

          {/* Vista previa */}
          {items.length > 0 && (
            <section className="bg-[#3a0d12]/80 border border-[#5a1b22] rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-sm font-semibold">Vista previa del archivo</h2>
                <span className="text-[11px] text-[#c9b296]">Solo se muestra un máximo de 50 filas</span>
              </div>

              <div className="overflow-x-auto max-h-72">
                <table className="min-w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-[#5a1b22] text-[#c9b296]">
                      <th className="py-2 px-2 text-left">#</th>
                      <th className="py-2 px-2 text-left">Código barras</th>
                      <th className="py-2 px-2 text-left">SKU</th>
                      <th className="py-2 px-2 text-left">Nombre</th>
                      <th className="py-2 px-2 text-left">Categoría</th>
                      <th className="py-2 px-2 text-right">Costo</th>
                      <th className="py-2 px-2 text-right">Impuestos</th>
                      <th className="py-2 px-2 text-right">Desaduanaje</th>
                      <th className="py-2 px-2 text-right">Cantidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.slice(0, 50).map((it, idx) => (
                      <tr key={idx} className="border-b border-[#3a0d12]/70 hover:bg-[#3a0d12]/60">
                        <td className="py-1.5 px-2 text-[#b39878]">{idx + 1}</td>
                        <td className="py-1.5 px-2 font-mono text-[#f1e4d4]">{it.codigo_barras || "—"}</td>
                        <td className="py-1.5 px-2 font-mono text-[#f1e4d4]">{it.sku || "—"}</td>
                        <td className="py-1.5 px-2 text-[#f8f1e6]">{it.nombre_producto}</td>
                        <td className="py-1.5 px-2 text-[#e3d2bd]">{it.categoria || "—"}</td>
                        <td className="py-1.5 px-2 text-right text-[#f1e4d4]">{it.costo_compra.toFixed(2)}</td>
                        <td className="py-1.5 px-2 text-right text-[#f1e4d4]">{it.costo_impuestos.toFixed(2)}</td>
                        <td className="py-1.5 px-2 text-right text-[#f1e4d4]">{it.costo_desaduanaje.toFixed(2)}</td>
                        <td className="py-1.5 px-2 text-right text-[#f1e4d4]">{it.cantidad}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Resumen backend */}
          {resumen.length > 0 && (
            <section className="bg-[#3a0d12]/80 border border-[#5a1b22] rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-sm font-semibold">Resultado de la importación</h2>
                <span className="text-[11px] text-[#c9b296]">Nuevos productos vs actualizados y precios sugeridos</span>
              </div>

              <div className="overflow-x-auto max-h-80">
                <table className="min-w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-[#5a1b22] text-[#c9b296]">
                      <th className="py-2 px-2 text-left">Fila</th>
                      <th className="py-2 px-2 text-left">SKU</th>
                      <th className="py-2 px-2 text-left">Código barras</th>
                      <th className="py-2 px-2 text-center">Tipo</th>
                      <th className="py-2 px-2 text-right">Cantidad</th>
                      <th className="py-2 px-2 text-right">Costo total unit.</th>
                      <th className="py-2 px-2 text-right">Precio venta sugerido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resumen.map((r) => (
                      <tr key={r.fila} className="border-b border-[#3a0d12]/70 hover:bg-[#3a0d12]/60">
                        <td className="py-1.5 px-2 text-[#c9b296]">{r.fila}</td>
                        <td className="py-1.5 px-2 font-mono text-[#f8f1e6]">{r.sku}</td>
                        <td className="py-1.5 px-2 font-mono text-[#f1e4d4]">{r.codigo_barras || "—"}</td>
                        <td className="py-1.5 px-2 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] border ${
                              r.creado
                                ? "border-[#d6b25f]/60 text-[#e3c578] bg-[#d6b25f]/10"
                                : "border-[#7a2b33] text-[#e3d2bd] bg-[#4b141a]"
                            }`}
                          >
                            {r.creado ? "Nuevo" : "Actualizado"}
                          </span>
                        </td>
                        <td className="py-1.5 px-2 text-right text-[#f8f1e6]">{r.cantidad}</td>
                        <td className="py-1.5 px-2 text-right text-[#f1e4d4]">{r.costoTotalUnit.toFixed(2)}</td>
                        <td className="py-1.5 px-2 text-right text-[#e3c578]">{r.precioVentaSugerido.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Etiquetas */}
          {labelsToPrint.length > 0 && (
            <section className="bg-[#3a0d12]/80 border border-[#b98c3f]/50 rounded-2xl p-4 space-y-3">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">Etiquetas generadas automáticamente</h2>
                  <p className="text-[11px] text-[#c9b296] max-w-xl">
                    Estos productos no traían código de barras válido; se generó uno automáticamente y ya puedes imprimir etiquetas.
                  </p>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadLabelsPdf}
                    className="px-4 py-2 rounded-full bg-[#d6b25f] hover:bg-[#e3c578] text-[11px] font-semibold text-[#2b0a0b]"
                  >
                    Descargar PDF con todas las etiquetas
                  </button>
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                {labelsToPrint.map((lbl) => (
                  <div
                    key={lbl.producto_id ?? lbl.codigo_barras}
                    className="border border-[#6b232b] rounded-xl px-3 py-2 bg-[#2b0a0b]/70 flex flex-col justify-between"
                  >
                    <div className="space-y-0.5">
                      <p className="text-[11px] text-[#c9b296]">{lbl.sku}</p>
                      <p className="text-xs font-semibold text-[#f8f1e6] line-clamp-2">{lbl.nombre}</p>
                      <p className="text-[11px] font-mono text-[#f1e4d4]">{lbl.codigo_barras}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        window.open(`/dashboard/productos/etiqueta/${encodeURIComponent(lbl.codigo_barras)}`, "_blank")
                      }
                      className="mt-2 self-start px-3 py-1 rounded-full bg-[#d6b25f] hover:bg-[#e3c578] text-[11px] font-semibold text-[#2b0a0b]"
                    >
                      Imprimir etiqueta individual
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
