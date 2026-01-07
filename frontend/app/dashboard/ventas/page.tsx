"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminSidebar from "../../_components/AdminSidebar";

// ✅ En Render (1 servicio): usar rutas relativas "/api/..."
// ✅ En local: si defines NEXT_PUBLIC_API_URL, lo respeta
const API_BASE_RAW = process.env.NEXT_PUBLIC_API_URL || "";
const API_BASE = API_BASE_RAW.replace(/\/+$/, ""); // quita slash final si existe

function buildApiUrl(path: string) {
  // Si viene definido (ej: en local con .env.local), úsalo
  if (API_BASE) return `${API_BASE}${path}`;

  // En producción (Render) -> mismo dominio
  if (typeof window !== "undefined") {
    const isLocalhost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    if (!isLocalhost) return path; // "/api/..."
  }

  // Fallback local si Next corre separado del backend
  return `http://localhost:4000${path}`;
}

interface User {
  id: string;
  nombre: string;
  email: string;
  rol: string;
}

interface Producto {
  id: string;
  sku: string;
  nombre: string;
  precio_venta: number;
  codigo_barras: string | null;
  activo: boolean;
  archivado: boolean;
  creado_en: string;

  categoria?: string | null;
  precio_mayorista?: number | null;
}

interface ProductosResponse {
  ok: boolean;
  data: {
    total: number;
    page: number;
    pageSize: number;
    items: Producto[];
  };
}

// Para edición local en la tabla
type ProductoEditable = Producto & {
  _dirty?: boolean;
};

type VistaVentas = "seleccion" | "manual" | "masivo";

// Nuevo producto (modo manual) – sin SKU
interface NuevoProductoManual {
  nombre: string;
  categoria: string;
  precio_venta: string;
  precio_mayorista: string;
  codigo_barras: string;
}

/**
 * Detecta una categoría a partir del nombre del producto.
 * Ajusta estos textos para que coincidan con tus categorías reales.
 */
function detectarCategoriaPorNombre(nombre: string): string | null {
  const n = nombre.toLowerCase();

  if (n.includes("anillo")) return "Anillos";
  if (n.includes("collar")) return "Collares";
  if (n.includes("cadena")) return "Cadenas";
  if (n.includes("arete") || n.includes("aros")) return "Aretes";
  if (n.includes("reloj")) return "Relojes";
  if (n.includes("pulsera") || n.includes("bracelet")) return "Pulseras";

  return null;
}

export default function VentasPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const [vista, setVista] = useState<VistaVentas>("seleccion");

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [rows, setRows] = useState<ProductoEditable[]>([]);
  const [search, setSearch] = useState("");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Estados para carga masiva (Excel)
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);

  // Estado del nuevo producto manual (sin SKU)
  const [nuevo, setNuevo] = useState<NuevoProductoManual>({
    nombre: "",
    categoria: "",
    precio_venta: "",
    precio_mayorista: "",
    codigo_barras: "",
  });

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

  // ==========================
  // 2) Cargar productos (se usa solo cuando haga falta, no al entrar)
  // ==========================
  const cargarProductos = async (q: string): Promise<ProductoEditable[]> => {
    if (!token) return [];
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      params.set("pageSize", "500");
      if (q.trim()) params.set("q", q.trim());

      const res = await fetch(
        buildApiUrl(`/api/catalog/products?${params.toString()}`),
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!res.ok) throw new Error("Error al cargar productos");

      const data: ProductosResponse = await res.json();
      const items = (data.data.items || []) as Producto[];

      // Solo productos activos (para ventas)
      const activos = items.filter((p) => p.activo && !p.archivado);

      const mapeados: ProductoEditable[] = activos.map((p) => {
        const categoriaDetectada =
          p.categoria && p.categoria.trim() !== ""
            ? p.categoria
            : detectarCategoriaPorNombre(p.nombre);

        return {
          ...p,
          categoria: categoriaDetectada ?? p.categoria ?? null,
        };
      });

      setRows(mapeados);
      setSelectedIds(new Set());
      return mapeados;
    } catch (err: any) {
      console.error(err);
      setError(err.message ?? "Error al cargar productos");
      return [];
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("joyeria_token");
    localStorage.removeItem("joyeria_user");
    router.push("/login");
  };

  // ==========================
  // Helpers de edición
  // ==========================

  const marcarDirty = (id: string, changes: Partial<ProductoEditable>) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              ...changes,
              _dirty: true,
            }
          : r
      )
    );
  };

  const handleChangeTexto = (
    id: string,
    field: keyof ProductoEditable,
    value: string
  ) => {
    marcarDirty(id, { [field]: value } as any);
  };

  const handleChangeNumero = (
    id: string,
    field: keyof ProductoEditable,
    value: string
  ) => {
    const num = value === "" ? null : Number(value);
    marcarDirty(id, { [field]: num as any });
  };

  // Generar un código de barras sencillo si no tiene (productos existentes)
  const generarCodigoBarras = (p: ProductoEditable, index: number) => {
    if (p.codigo_barras) return p.codigo_barras;

    const base = (p.sku || p.id).replace(/[^0-9A-Za-z]/g, "").slice(-6);
    return `GT${base}${(index % 90) + 10}`;
  };

  const handleGenerarCodigosFaltantes = () => {
    setRows((prev) =>
      prev.map((p, idx) => {
        if (p.codigo_barras && p.codigo_barras.trim() !== "") return p;
        return {
          ...p,
          codigo_barras: generarCodigoBarras(p, idx),
          _dirty: true,
        };
      })
    );
  };

  // ==========================
  // Nuevo producto (modo manual) SIN SKU
  // ==========================

  const handleNuevoChange = (
    field: keyof NuevoProductoManual,
    value: string
  ) => {
    setNuevo((prev) => ({ ...prev, [field]: value }));
  };

  const handleNuevoNombreChange = (value: string) => {
    setNuevo((prev) => {
      const next: NuevoProductoManual = { ...prev, nombre: value };

      // Si no hay categoría escrita, intentamos detectar una por nombre
      if (!prev.categoria || prev.categoria.trim() === "") {
        const cat = detectarCategoriaPorNombre(value);
        if (cat) {
          next.categoria = cat;
        }
      }

      return next;
    });
  };

  const handleGenerarCodigoNuevo = () => {
    setNuevo((prev) => {
      if (prev.codigo_barras && prev.codigo_barras.trim() !== "") return prev;

      const base = prev.nombre.trim() || `P${Date.now().toString().slice(-6)}`;
      const clean = base.replace(/[^0-9A-Za-z]/g, "").slice(-8) || "00000000";
      const code = `GT${clean}${(rows.length % 90) + 10}`;

      return { ...prev, codigo_barras: code };
    });
  };

  // ======= FUNCIÓN ACTUALIZADA =======
  const handleAgregarNuevoProducto = async () => {
    if (!token) return;

    // Validaciones mínimas
    if (!nuevo.nombre.trim()) {
      setError("Ingresa al menos el nombre del producto.");
      setSuccess(null);
      return;
    }
    if (!nuevo.precio_venta.trim()) {
      setError("Ingresa el precio público (Q) del producto.");
      setSuccess(null);
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const payload = {
        nombre: nuevo.nombre.trim(),
        categoria: nuevo.categoria.trim() || null,
        precio_venta: Number(nuevo.precio_venta),
        precio_mayorista: nuevo.precio_mayorista.trim()
          ? Number(nuevo.precio_mayorista)
          : null,
        codigo_barras: nuevo.codigo_barras.trim() || null,
      };

      const res = await fetch(buildApiUrl("/api/sales/manual-product"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      // Leemos el body una sola vez
      let body: any = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }

      if (!res.ok) {
        const backendMsg: string | undefined = body?.message;
        const msg =
          backendMsg ||
          (res.status === 400
            ? "Revisa los datos del producto (nombre, precio o código de barras)."
            : "Error al registrar el nuevo producto");
        throw new Error(msg);
      }

      // Intentamos extraer el producto creado de la respuesta
      const created: any =
        body?.data || body?.product || body?.item || body || {};

      const row: ProductoEditable = {
        id: created.id ?? crypto.randomUUID(),
        sku: created.sku ?? created.codigo ?? created.codigo_interno ?? "",
        nombre: created.nombre ?? payload.nombre,
        precio_venta: created.precio_venta ?? payload.precio_venta,
        codigo_barras: created.codigo_barras ?? payload.codigo_barras,
        activo: created.activo ?? true,
        archivado: created.archivado ?? false,
        creado_en: created.creado_en ?? new Date().toISOString(),
        categoria:
          created.categoria ??
          payload.categoria ??
          detectarCategoriaPorNombre(payload.nombre) ??
          null,
        precio_mayorista:
          created.precio_mayorista ?? payload.precio_mayorista ?? null,
        _dirty: false,
      };

      // Solo mostramos en la tabla los productos registrados desde aquí
      setRows((prev) => [row, ...prev]);

      setSuccess("Producto registrado correctamente para ventas.");

      // Limpiar formulario
      setNuevo({
        nombre: "",
        categoria: "",
        precio_venta: "",
        precio_mayorista: "",
        codigo_barras: "",
      });
    } catch (err: any) {
      console.error(err);
      setError(err.message ?? "Error al registrar el nuevo producto");
    } finally {
      setSaving(false);
    }
  };
  // ======= FIN FUNCIÓN ACTUALIZADA =======

  // ==========================
  // Eliminar producto (tabla manual)
  // ==========================
  const handleEliminarProducto = async (id: string) => {
    if (!token) return;

    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const res = await fetch(buildApiUrl(`/api/sales/manual-product/${id}`), {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) throw new Error("Error al eliminar producto");

      setRows((prev) => prev.filter((p) => p.id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });

      setSuccess("Producto eliminado correctamente.");
    } catch (err: any) {
      console.error(err);
      setError(err.message ?? "Error al eliminar producto");
    } finally {
      setSaving(false);
    }
  };

  // ==========================
  // Selección para imprimir códigos
  // ==========================
  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    setSelectedIds((prev) => {
      const allIds = rows.map((r) => r.id);
      const allSelected =
        allIds.length > 0 && allIds.every((id) => prev.has(id));
      if (allSelected) {
        return new Set();
      }
      return new Set(allIds);
    });
  };

  // ======== NUEVA LÓGICA DE IMPRESIÓN =========
  const handlePrintSelected = () => {
    if (selectedIds.size === 0) {
      setError("Selecciona al menos un producto para imprimir sus códigos.");
      setSuccess(null);
      return;
    }

    // Productos seleccionados en la tabla
    const seleccionados = rows.filter((p) => selectedIds.has(p.id));

    // Solo los que tienen código de barras
    const conCodigo = seleccionados.filter(
      (p) => p.codigo_barras && p.codigo_barras.trim() !== ""
    );

    if (conCodigo.length === 0) {
      setError(
        "Los productos seleccionados no tienen código de barras. Genera los códigos antes de imprimir."
      );
      setSuccess(null);
      return;
    }

    // Construimos el HTML de las etiquetas
    const labelsHtml = conCodigo
      .map((p) => {
        const safeName = (p.nombre || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        const safeCode = (p.codigo_barras || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");

        return `
        <div class="label">
          <div class="name">${safeName}</div>
          <svg
            class="barcode"
            jsbarcode-value="${safeCode}"
            jsbarcode-format="CODE128"
            jsbarcode-textmargin="1"
            jsbarcode-fontsize="10"
            jsbarcode-height="40"
          ></svg>
          <div class="code">${safeCode}</div>
        </div>`;
      })
      .join("");

    const html = `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Códigos de barras</title>
    <style>
      * { box-sizing: border-box; }
      body {
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        margin: 0;
        padding: 16px;
      }
      .label-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .label {
        border: 1px solid #ccc;
        padding: 6px 8px;
        width: 260px;
        text-align: center;
      }
      .name {
        font-size: 11px;
        margin-bottom: 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .code {
        font-size: 10px;
        letter-spacing: 2px;
        margin-top: 4px;
      }
      svg.barcode {
        width: 100%;
      }
      @media print {
        body { padding: 8px; }
        .label {
          page-break-inside: avoid;
        }
      }
    </style>
  </head>
  <body>
    <div class="label-grid">
      ${labelsHtml}
    </div>
    <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"></script>
    <script>
      window.addEventListener("load", function () {
        JsBarcode(".barcode").init();
        window.print();
      });
    </script>
  </body>
</html>`;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setError(
        "No se pudo abrir la ventana de impresión (revisa el bloqueador de ventanas emergentes)."
      );
      setSuccess(null);
      return;
    }

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();

    setError(null);
    setSuccess(
      `Abriendo vista de impresión para ${conCodigo.length} código(s) de barras.`
    );
  };
  // ======== FIN NUEVA LÓGICA DE IMPRESIÓN =========

  // ==========================
  // Guardar cambios manuales
  // ==========================
  const handleGuardarCambios = async () => {
    if (!token) return;
    const modificados = rows.filter((r) => r._dirty);

    if (modificados.length === 0) {
      setSuccess("No hay cambios pendientes por guardar.");
      setError(null);
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const payload = modificados.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        categoria: p.categoria ?? null,
        codigo_barras: p.codigo_barras,
        precio_venta: p.precio_venta,
        precio_mayorista:
          p.precio_mayorista === null || p.precio_mayorista === undefined
            ? null
            : p.precio_mayorista,
      }));

      const res = await fetch(buildApiUrl("/api/sales/bulk-products"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ items: payload }),
      });

      if (!res.ok) throw new Error("Error al guardar cambios");

      setSuccess("Cambios guardados correctamente.");
      setRows((prev) => prev.map((r) => ({ ...r, _dirty: false })));
    } catch (err: any) {
      console.error(err);
      setError(err.message ?? "Error al guardar cambios");
    } finally {
      setSaving(false);
    }
  };

  // ==========================
  // Carga masiva (Excel)
  // ==========================
  const handleFileChange = (e: any) => {
    const file = e.target.files?.[0] ?? null;
    setImportFile(file);
    setSuccess(null);
    setError(null);
  };

  const handleUploadExcel = async () => {
    if (!token || !importFile) return;

    try {
      setImporting(true);
      setError(null);
      setSuccess(null);

      const formData = new FormData();
      formData.append("file", importFile);

      const res = await fetch(buildApiUrl("/api/sales/import-excel"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!res.ok) throw new Error("Error al importar archivo");

      const data = await res.json();
      setSuccess(
        data.message || "Archivo procesado correctamente. Ventas actualizadas."
      );
    } catch (err: any) {
      console.error(err);
      setError(err.message ?? "Error al importar archivo");
    } finally {
      setImporting(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#2b0a0b] text-[#f1e4d4]">
        Cargando sesión...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#2b0a0b] text-[#f8f1e6] flex flex-col md:flex-row">
      {/* Sidebar reutilizable */}
      <AdminSidebar user={user} onLogout={handleLogout} />

      <div className="flex-1 flex flex-col">
        {/* Top bar */}
        <header className="border-b border-[#5a1b22] bg-[#2b0a0b]/80 backdrop-blur px-4 md:px-8 py-4 sticky top-0 z-10">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-xl md:text-2xl font-semibold">Ventas</h1>
              <p className="text-xs md:text-sm text-[#c9b296] capitalize">
                {today}
              </p>
            </div>

            <div
              className={`flex items-center gap-3 w-full md:w-auto ${
                vista === "seleccion" ? "opacity-50 pointer-events-none" : ""
              }`}
            >
              <input
                type="text"
                placeholder="Buscar por nombre, SKU o código de barras..."
                className="w-full md:w-72 md:max-w-xs rounded-full border border-[#6b232b] bg-[#3a0d12]/80 px-4 py-1.5 text-xs text-[#f8f1e6] placeholder-[#b39878] focus:outline-none focus:ring-2 focus:ring-[#d6b25f]"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                disabled={vista !== "masivo"} // búsqueda desactivada aquí
              />
            </div>
          </div>
        </header>

        {/* Contenido principal */}
        <main className="flex-1 w-full max-w-6xl mx-auto px-4 md:px-8 py-6 space-y-4">
          {/* ==========================
              VISTA 0: SELECCIÓN DE MODO
             ========================== */}
          {vista === "seleccion" && (
            <section className="bg-[#3a0d12]/80 border border-[#5a1b22] rounded-2xl p-6 md:p-8 flex flex-col gap-6 items-stretch">
              <div className="space-y-1">
                <p className="text-[11px] text-[#c9b296] uppercase tracking-wide">
                  Modo de registro de ventas
                </p>
                <p className="text-sm text-[#e3d2bd]">
                  actualizar los datos de ventade tus productos.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setVista("masivo")}
                  className="rounded-2xl border border-[#c39a4c]/60 bg-[#c39a4c]/10 hover:bg-[#c39a4c]/20 transition-colors px-4 py-4 text-left"
                >
                  <p className="text-xs font-semibold text-[#d9ba72] mb-1">
                    Carga masiva desde Excel
                  </p>
                  <p className="text-[11px] text-[#f1e4d4]">
                    Importa en bloque nombre, categoría, precios y códigos de
                    barras desde un archivo Excel o CSV. Ideal para catálogos
                    grandes.
                  </p>
                </button>
              </div>
            </section>
          )}

          {/* ==========================
              VISTA 1: MODO MANUAL
             ========================== */}
          {vista === "manual" && (
            <>
              {/* Encabezado del modo + volver */}
              <section className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-[11px] text-[#c9b296] uppercase tracking-wide">
                    Modo: registro / edición manual
                  </p>
                  <p className="text-xs text-[#e3d2bd]">
                    Registra nuevos productos para ventas y ajusta sus
                    categorías, precios y códigos de barras. Solo verás aquí los
                    productos que registres manualmente desde esta pantalla.
                  </p>
                  <p className="text-[11px] text-[#b39878] mt-1">
                    Productos en esta tabla: {rows.length}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setVista("seleccion")}
                  className="inline-flex items-center justify-center rounded-full border border-[#7a2b33] px-3 py-1.5 text-[11px] font-medium text-[#f1e4d4] hover:bg-[#4b141a]/80"
                >
                  ← Volver a selección
                </button>
              </section>

              {/* Panel de configuración manual */}
              <section className="bg-[#3a0d12]/80 border border-[#5a1b22] rounded-2xl p-4 space-y-3">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div>
                    <p className="text-[11px] text-[#c9b296] uppercase tracking-wide">
                      Configuración de ventas (modo manual)
                    </p>
                    <p className="text-xs text-[#e3d2bd]">
                      Completa y corrige la información de venta de los
                      productos que registres aquí: categoría, códigos de
                      barras, precios unitarios y mayoristas.
                    </p>
                  </div>

                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={handleGenerarCodigosFaltantes}
                      className="rounded-full border border-[#b98c3f] bg-[#c39a4c]/10 px-3 py-1.5 text-[11px] font-medium text-[#e7c979] hover:bg-[#c39a4c]/20"
                    >
                      Generar códigos de barras faltantes
                    </button>

                    <button
                      type="button"
                      onClick={handlePrintSelected}
                      className="rounded-full border border-indigo-500 bg-indigo-500/10 px-3 py-1.5 text-[11px] font-medium text-indigo-200 hover:bg-indigo-500/20"
                    >
                      Imprimir códigos (seleccionados)
                    </button>

                    <button
                      type="button"
                      onClick={handleGuardarCambios}
                      disabled={saving}
                      className="rounded-full border border-[#d6b25f] bg-[#d6b25f]/90 px-4 py-1.5 text-[11px] font-semibold text-[#2b0a0b] hover:bg-[#e3c578] disabled:opacity-60"
                    >
                      {saving ? "Guardando..." : "Guardar cambios"}
                    </button>
                  </div>
                </div>

                {error && (
                  <p className="text-xs text-red-400 mt-1">Error: {error}</p>
                )}
                {success && (
                  <p className="text-xs text-[#d6b25f] mt-1">{success}</p>
                )}
              </section>

              {/* Formulario: nuevo producto manual (sin SKU) */}
              <section className="bg-[#3a0d12]/80 border border-[#5a1b22] rounded-2xl p-4 space-y-3">
                <p className="text-[11px] text-[#c9b296] uppercase tracking-wide">
                  Registrar nuevo producto para ventas (modo manual)
                </p>
                <p className="text-xs text-[#e3d2bd]">
                  Ingresa un nuevo producto. A partir del nombre se intenta
                  detectar la categoría automáticamente. Puedes ajustar los
                  valores antes de guardarlo.
                </p>

                <div className="grid gap-3 md:grid-cols-6 text-[11px]">
                  <div className="md:col-span-3 flex flex-col gap-1">
                    <label className="text-[#c9b296]">Nombre del producto</label>
                    <input
                      type="text"
                      className="rounded border border-[#6b232b] bg-[#2b0a0b]/70 px-2 py-1 text-[#f8f1e6] focus:outline-none focus:ring-1 focus:ring-[#d6b25f]"
                      value={nuevo.nombre}
                      onChange={(e) => handleNuevoNombreChange(e.target.value)}
                      placeholder="Ej. Anillo oro 14K corazón"
                    />
                  </div>

                  <div className="md:col-span-1 flex flex-col gap-1">
                    <label className="text-[#c9b296]">Categoría</label>
                    <input
                      type="text"
                      className="rounded border border-[#6b232b] bg-[#2b0a0b]/70 px-2 py-1 text-[#f8f1e6] focus:outline-none focus:ring-1 focus:ring-[#d6b25f]"
                      value={nuevo.categoria}
                      onChange={(e) =>
                        handleNuevoChange("categoria", e.target.value)
                      }
                      placeholder="Ej. Anillos"
                    />
                  </div>

                  <div className="md:col-span-1 flex flex-col gap-1">
                    <label className="text-[#c9b296]">Precio público (Q)</label>
                    <input
                      type="number"
                      step="0.01"
                      className="rounded border border-[#6b232b] bg-[#2b0a0b]/70 px-2 py-1 text-[#f0d99a] text-right focus:outline-none focus:ring-1 focus:ring-[#d6b25f]"
                      value={nuevo.precio_venta}
                      onChange={(e) =>
                        handleNuevoChange("precio_venta", e.target.value)
                      }
                      placeholder="0.00"
                    />
                  </div>

                  <div className="md:col-span-1 flex flex-col gap-1">
                    <label className="text-[#c9b296]">
                      Precio mayorista (Q)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      className="rounded border border-[#6b232b] bg-[#2b0a0b]/70 px-2 py-1 text-[#f1e4d4] text-right focus:outline-none focus:ring-1 focus:ring-[#d6b25f]"
                      value={nuevo.precio_mayorista}
                      onChange={(e) =>
                        handleNuevoChange("precio_mayorista", e.target.value)
                      }
                      placeholder="Opcional"
                    />
                  </div>

                  <div className="md:col-span-3 md:col-start-1 flex flex-col gap-1">
                    <label className="text-[#c9b296]">Código de barras</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        className="flex-1 rounded border border-[#6b232b] bg-[#2b0a0b]/70 px-2 py-1 text-[#f8f1e6] focus:outline-none focus:ring-1 focus:ring-[#d6b25f]"
                        value={nuevo.codigo_barras}
                        onChange={(e) =>
                          handleNuevoChange("codigo_barras", e.target.value)
                        }
                        placeholder="Si ya trae código, escríbelo aquí."
                      />
                      <button
                        type="button"
                        onClick={handleGenerarCodigoNuevo}
                        className="text-[10px] px-2 py-1 rounded-full border border-[#c39a4c] text-[#d9ba72] hover:bg-[#c39a4c]/20"
                      >
                        Generar
                      </button>
                    </div>
                  </div>

                  <div className="md:col-span-2 md:col-end-7 flex items-end justify-end">
                    <button
                      type="button"
                      onClick={handleAgregarNuevoProducto}
                      disabled={saving}
                      className="rounded-full border border-[#d6b25f] bg-[#d6b25f]/90 px-4 py-1.5 text-[11px] font-semibold text-[#2b0a0b] hover:bg-[#e3c578] disabled:opacity-60"
                    >
                      {saving ? "Guardando..." : "Agregar producto a ventas"}
                    </button>
                  </div>
                </div>
              </section>

              {/* Tabla editable SOLO con los productos registrados aquí */}
              <section className="bg-[#3a0d12]/80 border border-[#5a1b22] rounded-2xl p-4">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-[11px]">
                    <thead>
                      <tr className="text-[#c9b296] border-b border-[#5a1b22]">
                        <th className="w-8 text-center py-2 px-2">
                          <input
                            type="checkbox"
                            className="h-3 w-3 rounded border-[#7a2b33] bg-[#3a0d12]"
                            onChange={handleToggleSelectAll}
                            checked={
                              rows.length > 0 &&
                              rows.every((r) => selectedIds.has(r.id))
                            }
                          />
                        </th>
                        {/* SKU eliminado */}
                        <th className="text-left py-2 px-2">Nombre</th>
                        <th className="text-left py-2 px-2">Categoría</th>
                        <th className="text-right py-2 px-2">
                          Precio público (Q)
                        </th>
                        <th className="text-right py-2 px-2">
                          Precio mayorista (Q)
                        </th>
                        <th className="text-left py-2 px-2">
                          Código de barras
                        </th>
                        <th className="text-center py-2 px-2">Estado</th>
                        <th className="text-center py-2 px-2">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading && (
                        <tr>
                          <td
                            colSpan={8}
                            className="py-4 text-center text-[#b39878]"
                          >
                            Cargando productos...
                          </td>
                        </tr>
                      )}

                      {!loading && rows.length === 0 && (
                        <tr>
                          <td
                            colSpan={8}
                            className="py-4 text-center text-[#b39878]"
                          >
                            Aún no has registrado productos manualmente para
                            ventas.
                          </td>
                        </tr>
                      )}

                      {!loading &&
                        rows.map((p, index) => (
                          <tr
                            key={p.id}
                            className={`border-b border-[#3a0d12]/70 hover:bg-[#3a0d12]/70 ${
                              p._dirty ? "bg-[#3a0d12]/80" : ""
                            }`}
                          >
                            {/* Checkbox selección */}
                            <td className="py-2 px-2 text-center">
                              <input
                                type="checkbox"
                                className="h-3 w-3 rounded border-[#7a2b33] bg-[#3a0d12]"
                                checked={selectedIds.has(p.id)}
                                onChange={() => handleToggleSelect(p.id)}
                              />
                            </td>

                            {/* Nombre */}
                            <td className="py-2 px-2 text-[#f8f1e6] min-w-[160px]">
                              <input
                                type="text"
                                className="w-full rounded border border-[#6b232b] bg-[#2b0a0b]/70 px-2 py-1 text-[11px] text-[#f8f1e6] focus:outline-none focus:ring-1 focus:ring-[#d6b25f]"
                                value={p.nombre}
                                onChange={(e) =>
                                  handleChangeTexto(
                                    p.id,
                                    "nombre",
                                    e.target.value
                                  )
                                }
                              />
                            </td>

                            {/* Categoría */}
                            <td className="py-2 px-2 text-[#f8f1e6] min-w-[140px]">
                              <input
                                type="text"
                                className="w-full rounded border border-[#6b232b] bg-[#2b0a0b]/70 px-2 py-1 text-[11px] text-[#f8f1e6] focus:outline-none focus:ring-1 focus:ring-[#d6b25f]"
                                value={p.categoria ?? ""}
                                onChange={(e) =>
                                  handleChangeTexto(
                                    p.id,
                                    "categoria",
                                    e.target.value
                                  )
                                }
                                placeholder="Ej. Anillos, Cadenas..."
                              />
                            </td>

                            {/* Precio público */}
                            <td className="py-2 px-2 text-right min-w-[120px]">
                              <input
                                type="number"
                                step="0.01"
                                className="w-full text-right rounded border border-[#6b232b] bg-[#2b0a0b]/70 px-2 py-1 text-[11px] text-[#f0d99a] focus:outline-none focus:ring-1 focus:ring-[#d6b25f]"
                                value={
                                  p.precio_venta === null ||
                                  p.precio_venta === undefined
                                    ? ""
                                    : p.precio_venta
                                }
                                onChange={(e) =>
                                  handleChangeNumero(
                                    p.id,
                                    "precio_venta",
                                    e.target.value
                                  )
                                }
                              />
                            </td>

                            {/* Precio mayorista */}
                            <td className="py-2 px-2 text-right min-w-[120px]">
                              <input
                                type="number"
                                step="0.01"
                                className="w-full text-right rounded border border-[#6b232b] bg-[#2b0a0b]/70 px-2 py-1 text-[11px] text-[#f1e4d4] focus:outline-none focus:ring-1 focus:ring-[#d6b25f]"
                                value={
                                  p.precio_mayorista === null ||
                                  p.precio_mayorista === undefined
                                    ? ""
                                    : p.precio_mayorista
                                }
                                onChange={(e) =>
                                  handleChangeNumero(
                                    p.id,
                                    "precio_mayorista",
                                    e.target.value
                                  )
                                }
                                placeholder="Opcional"
                              />
                            </td>

                            {/* Código de barras */}
                            <td className="py-2 px-2 text-[#f8f1e6] min-w-[160px]">
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  className="flex-1 rounded border border-[#6b232b] bg-[#2b0a0b]/70 px-2 py-1 text-[11px] text-[#f8f1e6] focus:outline-none focus:ring-1 focus:ring-[#d6b25f]"
                                  value={p.codigo_barras ?? ""}
                                  onChange={(e) =>
                                    handleChangeTexto(
                                      p.id,
                                      "codigo_barras",
                                      e.target.value
                                    )
                                  }
                                />
                                {!p.codigo_barras && (
                                  <button
                                    type="button"
                                    className="text-[10px] px-2 py-1 rounded-full border border-[#c39a4c] text-[#d9ba72] hover:bg-[#c39a4c]/20"
                                    onClick={() =>
                                      marcarDirty(p.id, {
                                        codigo_barras: generarCodigoBarras(
                                          p,
                                          index
                                        ),
                                      })
                                    }
                                  >
                                    Generar
                                  </button>
                                )}
                              </div>
                            </td>

                            {/* Estado */}
                            <td className="py-2 px-2 text-center">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border border-[#d6b25f]/60 text-[#e3c578] bg-[#d6b25f]/10">
                                Activo
                              </span>
                            </td>

                            {/* Acciones */}
                            <td className="py-2 px-2 text-center">
                              <button
                                type="button"
                                onClick={() => handleEliminarProducto(p.id)}
                                className="text-[10px] px-2 py-1 rounded-full border border-red-500 text-red-300 hover:bg-red-500/10"
                              >
                                Eliminar
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {/* ==========================
              VISTA 2: CARGA MASIVA (EXCEL)
             ========================== */}
          {vista === "masivo" && (
            <>
              <section className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-[11px] text-[#c9b296] uppercase tracking-wide">
                    Modo: carga masiva desde Excel
                  </p>
                  <p className="text-xs text-[#e3d2bd]">
                    Importa en bloque nombre, categoría, precio público, precio
                    mayorista y código de barras desde un archivo Excel o CSV.
                  </p>
                  <p className="text-[11px] text-[#b39878] mt-1">
                    Tras importar, puedes ir al modo manual para revisar y
                    ajustar detalles, o imprimir códigos de barras.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setVista("seleccion")}
                  className="inline-flex items-center justify-center rounded-full border border-[#7a2b33] px-3 py-1.5 text-[11px] font-medium text-[#f1e4d4] hover:bg-[#4b141a]/80"
                >
                  ← Volver a selección
                </button>
              </section>

              <section className="bg-[#3a0d12]/80 border border-[#5a1b22] rounded-2xl p-5 space-y-4">
                <div className="space-y-1">
                  <p className="text-[11px] text-[#c9b296] uppercase tracking-wide">
                    Carga masiva de productos para ventas
                  </p>
                  <p className="text-xs text-[#e3d2bd]">
                    1. Descarga la plantilla de ejemplo (cuando tengas el
                    endpoint listo).
                    <br className="hidden md:block" />
                    2. Llena o actualiza los datos de tus productos.
                    <br className="hidden md:block" />
                    3. Sube el archivo para que se actualicen los productos en
                    el sistema.
                  </p>
                </div>

                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] text-[#c9b296]">
                      Archivo Excel / CSV
                    </label>
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={handleFileChange}
                      className="text-[11px] text-[#f1e4d4] file:mr-3 file:rounded-full file:border file:border-[#6b232b] file:bg-[#4b141a] file:px-3 file:py-1.5 file:text-[11px] file:text-[#f8f1e6] hover:file:bg-[#5c1b22]"
                    />
                    {importFile && (
                      <p className="text-[11px] text-[#c9b296]">
                        Archivo seleccionado:{" "}
                        <span className="text-[#f1e4d4]">
                          {importFile.name}
                        </span>
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 md:justify-end">
                    <button
                      type="button"
                      onClick={handleUploadExcel}
                      disabled={!importFile || importing}
                      className="rounded-full border border-[#c39a4c] bg-[#c39a4c]/90 px-4 py-1.5 text-[11px] font-semibold text-[#2b0a0b] hover:bg-[#d9ba72] disabled:opacity-60"
                    >
                      {importing ? "Procesando..." : "Subir y procesar archivo"}
                    </button>
                  </div>
                </div>

                {error && (
                  <p className="text-xs text-red-400 mt-1">Error: {error}</p>
                )}
                {success && (
                  <p className="text-xs text-[#d6b25f] mt-1">{success}</p>
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
