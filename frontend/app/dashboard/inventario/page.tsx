"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AdminSidebar from "../../_components/AdminSidebar";

/**
 * ✅ En Render (misma app / mismo dominio): usar rutas relativas "/api/..."
 * ✅ En local: si defines NEXT_PUBLIC_API_URL, lo respeta (ej. http://localhost:4000)
 */
const API_BASE_RAW = process.env.NEXT_PUBLIC_API_URL || "";
const API_BASE = API_BASE_RAW.replace(/\/+$/, ""); // quita slash final

function buildApiUrl(path: string) {
  // Si existe NEXT_PUBLIC_API_URL (local o prod separado), úsalo
  if (API_BASE) return `${API_BASE}${path}`;

  // Si estamos en producción (no localhost), usa el mismo dominio del frontend
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

/** =========================
 *  VISTA PÚBLICA (tipos)
 *  ========================= */
interface ProductoPublico {
  id: string;
  sku: string;
  nombre: string;
  precio_venta: number;
  codigo_barras: string | null;
  creado_en: string;

  categoria?: string | null;
  precio_mayorista?: number | null;
  disponible?: boolean;
}

/** =========================
 *  VISTA INTERNA (desde /inventory/stock)
 *  ========================= */
interface SucursalInv {
  id: string;
  nombre: string;
  codigo?: string;
}

interface UbicacionInv {
  id: string;
  nombre: string;
  es_vitrina: boolean;
  es_bodega: boolean;
  sucursal_id: string;
  sucursales: SucursalInv;
}

interface InventarioExistenciaRow {
  producto_id: string;
  ubicacion_id: string;
  stock: number;

  // vienen como JSON desde tu queryRaw
  productos: any;
  ubicaciones: UbicacionInv;
}

interface ProductoInternoResumen {
  id: string;
  sku: string;
  nombre: string;
  codigo_barras: string | null;

  costo_compra: number;
  costo_envio: number;
  costo_impuestos: number;
  costo_desaduanaje: number;

  costo_total_unitario: number;
  stock_total: number;
  valor_inventario: number;
}

export default function InventarioPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const [search, setSearch] = useState("");

  // 🔹 Vista seleccionada: interno / público / nada
  const [viewMode, setViewMode] = useState<"interno" | "publico" | null>(null);

  // ✅ SOLO para la vista pública
  const [publicLoading, setPublicLoading] = useState(false);
  const [publicProductos, setPublicProductos] = useState<ProductoPublico[]>([]);
  const [publicError, setPublicError] = useState<string | null>(null);

  // ✅ Paginación vista pública
  const [publicPage, setPublicPage] = useState(1);
  const [publicPageSize, setPublicPageSize] = useState(50);

  // ✅ Edición rápida categoría (vista pública)
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatValue, setEditingCatValue] = useState<string>("");
  const [savingCategory, setSavingCategory] = useState(false);

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

  // ✅ Cargar inventario público desde el endpoint correcto
  const cargarInventarioPublico = async () => {
    if (!token) return;
    try {
      setPublicLoading(true);
      setPublicError(null);

      const res = await fetch(buildApiUrl(`/api/inventory/stock?vista=publico`), {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error("Error al cargar inventario público");
      const data = await res.json();

      const items = (data.productos || data.existencias || []) as any[];

      const normalized: ProductoPublico[] = items.map((r) => ({
        id: String(r.id || r.producto_id),
        sku: String(r.sku ?? ""),
        nombre: String(r.nombre ?? ""),
        codigo_barras: r.codigo_barras ?? null,
        precio_venta: Number(r.precio_venta ?? 0),
        precio_mayorista:
          r.precio_mayorista === null || r.precio_mayorista === undefined
            ? null
            : Number(r.precio_mayorista),
        categoria: r.categoria ?? null,
        disponible: typeof r.disponible === "boolean" ? r.disponible : true,
        creado_en: r.creado_en ?? new Date().toISOString(),
      }));

      setPublicProductos(normalized);
    } catch (err: any) {
      console.error(err);
      setPublicError(err?.message ?? "Error al cargar inventario público");
      setPublicProductos([]);
    } finally {
      setPublicLoading(false);
    }
  };

  // ✅ Cuando el usuario elige vista pública, cargamos el endpoint público
  useEffect(() => {
    if (!token) return;
    if (viewMode !== "publico") return;
    cargarInventarioPublico();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, token]);

  // ✅ Reset de paginación / edición al cambiar a vista pública o búsqueda
  useEffect(() => {
    if (viewMode === "publico") {
      setPublicPage(1);
      setEditingCatId(null);
      setEditingCatValue("");
    }
  }, [viewMode]);

  useEffect(() => {
    if (viewMode === "publico") setPublicPage(1);
  }, [search, viewMode]);

  // ==========================
  // ✅ Derivados (PÚBLICO) + hooks SIEMPRE antes del return
  // ==========================
  const q = search.trim().toLowerCase();

  const productosPublicosFiltrados = useMemo(() => {
    return (publicProductos || []).filter((p) => {
      if (!q) return true;
      return (
        (p.nombre ?? "").toLowerCase().includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q) ||
        (p.codigo_barras ?? "").toLowerCase().includes(q) ||
        (p.categoria ?? "").toLowerCase().includes(q)
      );
    });
  }, [publicProductos, q]);

  const publicTotalItems = productosPublicosFiltrados.length;

  const publicTotalPages = useMemo(() => {
    return Math.max(
      1,
      Math.ceil(publicTotalItems / Math.max(1, publicPageSize))
    );
  }, [publicTotalItems, publicPageSize]);

  useEffect(() => {
    if (viewMode !== "publico") return;
    if (publicPage > publicTotalPages) setPublicPage(publicTotalPages);
    if (publicPage < 1) setPublicPage(1);
  }, [publicPage, publicTotalPages, viewMode]);

  const publicStartIndex = (publicPage - 1) * publicPageSize;
  const publicEndIndex = Math.min(
    publicStartIndex + publicPageSize,
    publicTotalItems
  );

  const productosPublicosPaginados = useMemo(() => {
    return productosPublicosFiltrados.slice(publicStartIndex, publicEndIndex);
  }, [productosPublicosFiltrados, publicStartIndex, publicEndIndex]);

  // ==========================
  // ✅ Helpers vista pública: editar categoría + imprimir códigos
  // ==========================
  const escapeHtml = (s: any) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  // ✅ SOLO imprimir códigos AUTOMÁTICOS (los que son SOLO dígitos)
  const isCodigoAutomatico = (code: string | null | undefined) => {
    const c = String(code ?? "").trim();
    if (!c) return false;
    return /^\d+$/.test(c);
  };

  const startEditCategory = (p: ProductoPublico) => {
    setEditingCatId(p.id);
    setEditingCatValue(p.categoria || "");
  };

  const cancelEditCategory = () => {
    setEditingCatId(null);
    setEditingCatValue("");
  };

  // ✅ Guardar categoría usando tu endpoint existente
  const saveCategory = async (p: ProductoPublico) => {
    if (!token) return;

    const nueva = editingCatValue.trim();

    try {
      setSavingCategory(true);
      setPublicError(null);

      const body = {
        items: [
          {
            id: p.id,
            nombre: p.nombre,
            precio_venta: p.precio_venta,
            precio_mayorista: p.precio_mayorista ?? null,
            codigo_barras: p.codigo_barras ?? null,
            categoria: nueva,
          },
        ],
      };

      const res = await fetch(buildApiUrl(`/api/sales/bulk-products`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Error al guardar categoría");

      setPublicProductos((prev) =>
        prev.map((x) =>
          x.id === p.id ? { ...x, categoria: nueva || null } : x
        )
      );

      cancelEditCategory();
    } catch (err: any) {
      console.error(err);
      setPublicError(err?.message ?? "Error al guardar categoría");
    } finally {
      setSavingCategory(false);
    }
  };

  /**
   * ✅ Etiqueta 50mm x 25mm, CODE128
   * ✅ Imprime SOLO códigos AUTOMÁTICOS (solo dígitos)
   */
  const printBarcodes = (
    items: ProductoPublico[],
    title = "Códigos de barras"
  ) => {
    if (typeof window === "undefined") return;

    const rows = (items || []).filter((p) => isCodigoAutomatico(p.codigo_barras));

    if (rows.length === 0) {
      setPublicError("No hay códigos automáticos para imprimir en esta selección.");
      return;
    }

    const w = window.open("", "_blank");
    if (!w) {
      setPublicError(
        "El navegador bloqueó la ventana de impresión (pop-up). Permite pop-ups y reintenta."
      );
      return;
    }

    const labelsHtml = rows
      .map((p, i) => {
        const code = escapeHtml(p.codigo_barras);
        const name = escapeHtml(p.nombre);
        const sku = escapeHtml(p.sku);

        const price = Number(p.precio_venta || 0).toLocaleString("es-GT", {
          minimumFractionDigits: 2,
        });

        return `
          <div class="label">
            <div class="name">${name}</div>
            <svg class="barcode" id="bc-${i}"></svg>
            <div class="meta">
              <span class="sku">${sku ? `SKU: ${sku}` : ""}</span>
              <span class="price">${price ? `Q ${price}` : ""}</span>
            </div>
            <div class="code">${code}</div>
          </div>
        `;
      })
      .join("");

    w.document.open();
    w.document.write(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <title>${escapeHtml(title)}</title>
          <style>
            @page { margin: 6mm; }
            body { font-family: Arial, sans-serif; margin: 0; padding: 0; }
            .wrap { padding: 6mm; }
            .grid {
              display: grid;
              grid-template-columns: repeat(3, 50mm);
              gap: 4mm;
              justify-content: start;
              align-content: start;
            }
            .label {
              width: 50mm;
              height: 25mm;
              border: 1px solid #111;
              padding: 3mm;
              border-radius: 6px;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
              box-sizing: border-box;
              overflow: hidden;
            }
            .name { font-size: 9px; font-weight: 700; line-height: 1.1; max-height: 18px; overflow: hidden; }
            .meta { display: flex; justify-content: space-between; gap: 6px; font-size: 8px; }
            .code { font-size: 8px; text-align: center; letter-spacing: 0.6px; }
            .barcode { width: 100%; height: 10mm; }
            .hint { font-size: 10px; margin-bottom: 4mm; }
            @media print { .hint { display: none; } }
          </style>
          <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"></script>
        </head>
        <body>
          <div class="wrap">
            <div class="hint">Etiqueta 50×25mm. Si algo se corta, ajusta la escala en impresión.</div>
            <div class="grid">
              ${labelsHtml}
            </div>
          </div>

          <script>
            (function() {
              const rows = ${JSON.stringify(
                rows.map((p) => String(p.codigo_barras || ""))
              )};
              rows.forEach((code, i) => {
                try {
                  JsBarcode("#bc-" + i, code, {
                    format: "CODE128",
                    displayValue: false,
                    height: 36,
                    margin: 0
                  });
                } catch (e) {}
              });
              setTimeout(() => window.print(), 350);
            })();
          </script>
        </body>
      </html>
    `);
    w.document.close();
  };

  const handleLogout = () => {
    localStorage.removeItem("joyeria_token");
    localStorage.removeItem("joyeria_user");
    router.push("/login");
  };

  // ✅ Return condicional DESPUÉS de todos los hooks
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#2b0a0b] text-[#f1e4d4]">
        Cargando sesión...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#2b0a0b] text-[#f8f1e6] flex flex-col md:flex-row">
      <AdminSidebar user={user} onLogout={handleLogout} />

      <div className="flex-1 flex flex-col">
        <header className="border-b border-[#5a1b22] bg-[#2b0a0b]/80 backdrop-blur px-4 md:px-8 py-4 sticky top-0 z-10">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-xl md:text-2xl font-semibold">Inventario</h1>
              <p className="text-xs md:text-sm text-[#c9b296] capitalize">
                {today}
              </p>
            </div>

            <div className="flex items-center gap-3 w-full md:w-auto">
              <input
                type="text"
                placeholder="Buscar por nombre, SKU o código de barras..."
                className="w-full md:w-72 md:max-w-xs rounded-full border border-[#6b232b] bg-[#3a0d12]/80 px-4 py-1.5 text-xs text-[#f8f1e6] placeholder-[#b39878] focus:outline-none focus:ring-2 focus:ring-[#d6b25f]"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </header>

        <main className="flex-1 w-full max-w-6xl mx-auto px-4 md:px-8 py-6 space-y-4">
          {!viewMode && (
            <section className="bg-[#3a0d12]/80 border border-[#5a1b22] rounded-2xl p-6 md:p-8 flex flex-col gap-6 items-stretch">
              <div className="space-y-1">
                <p className="text-[11px] text-[#c9b296] uppercase tracking-wide">
                  Tipo de inventario
                </p>
                <p className="text-sm text-[#e3d2bd]">
                  Elige qué vista deseas abrir: inventario interno (costos +
                  existencias) o inventario público (lista de precios).
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setViewMode("interno")}
                  className="rounded-2xl border border-[#d6b25f]/60 bg-[#d6b25f]/10 hover:bg-[#d6b25f]/20 transition-colors px-4 py-4 text-left"
                >
                  <p className="text-xs font-semibold text-[#e3c578] mb-1">
                    Inventario interno
                  </p>
                  <p className="text-[11px] text-[#f1e4d4]">
                    Costos reales + existencias. (Sin precio venta, sin márgenes.)
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setViewMode("publico")}
                  className="rounded-2xl border border-[#c39a4c]/60 bg-[#c39a4c]/10 hover:bg-[#c39a4c]/20 transition-colors px-4 py-4 text-left"
                >
                  <p className="text-xs font-semibold text-[#d9ba72] mb-1">
                    Inventario público
                  </p>
                  <p className="text-[11px] text-[#f1e4d4]">
                    Lista de precios: categoría, precio público/mayorista y disponibilidad.
                  </p>
                </button>
              </div>
            </section>
          )}

          {viewMode && (
            <>
              <section className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-[11px] text-[#c9b296] uppercase tracking-wide">
                    Vista seleccionada
                  </p>
                  <p className="text-xs text-[#e3d2bd]">
                    {viewMode === "interno"
                      ? "Inventario interno (costos + existencias)."
                      : "Inventario público (lista de precios)."}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setViewMode(null)}
                  className="inline-flex items-center justify-center rounded-full border border-[#7a2b33] px-3 py-1.5 text-[11px] font-medium text-[#f1e4d4] hover:bg-[#4b141a]/80"
                >
                  ← Volver a seleccionar tipo
                </button>
              </section>

              {viewMode === "interno" && token && (
                <InventoryInternalSection token={token} search={search} />
              )}

              {viewMode === "publico" && (
                <section className="bg-[#3a0d12]/80 border border-[#5a1b22] rounded-2xl p-4">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
                    <div>
                      <h2 className="text-sm font-semibold">
                        Inventario público (lista de precios)
                      </h2>
                      <p className="text-[11px] text-[#c9b296]">
                        Nota: aquí solo aparecen productos ACTIVO=true y NO archivados.
                      </p>
                      {!!publicError && (
                        <p className="text-[11px] text-red-300 mt-2">
                          Error: {publicError}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          printBarcodes(
                            productosPublicosFiltrados,
                            "Códigos automáticos (filtrado)"
                          )
                        }
                        className="rounded-full border border-[#d6b25f]/60 bg-[#d6b25f]/10 hover:bg-[#d6b25f]/20 transition-colors px-3 py-1.5 text-[11px] text-[#f1e4d4] disabled:opacity-40"
                        disabled={publicLoading || productosPublicosFiltrados.length === 0}
                      >
                        🖨️ Imprimir códigos (automáticos)
                      </button>

                      <button
                        type="button"
                        onClick={cargarInventarioPublico}
                        className="rounded-full border border-[#7a2b33] px-3 py-1.5 text-[11px] text-[#f1e4d4] hover:bg-[#4b141a]/80 disabled:opacity-40"
                        disabled={publicLoading}
                      >
                        ⟳ Recargar
                      </button>
                    </div>
                  </div>

                  {!publicLoading && publicTotalItems > 0 && (
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
                      <p className="text-[11px] text-[#c9b296]">
                        Mostrando{" "}
                        <span className="text-[#f1e4d4]">{publicStartIndex + 1}</span>–
                        <span className="text-[#f1e4d4]">{publicEndIndex}</span>{" "}
                        de <span className="text-[#f1e4d4]">{publicTotalItems}</span>
                      </p>

                      <div className="flex items-center gap-2">
                        <select
                          value={publicPageSize}
                          onChange={(e) => {
                            setPublicPageSize(Number(e.target.value));
                            setPublicPage(1);
                          }}
                          className="rounded-full border border-[#6b232b] bg-[#3a0d12]/80 px-3 py-1 text-[11px] text-[#f8f1e6] focus:outline-none focus:ring-2 focus:ring-[#d6b25f]"
                        >
                          <option value={25}>25</option>
                          <option value={50}>50</option>
                          <option value={100}>100</option>
                          <option value={200}>200</option>
                        </select>

                        <button
                          type="button"
                          onClick={() => setPublicPage((p) => Math.max(1, p - 1))}
                          disabled={publicPage <= 1}
                          className="rounded-full border border-[#7a2b33] px-3 py-1 text-[11px] text-[#f1e4d4] hover:bg-[#4b141a]/80 disabled:opacity-40 disabled:hover:bg-transparent"
                        >
                          ← Anterior
                        </button>

                        <span className="text-[11px] text-[#c9b296]">
                          Página <span className="text-[#f1e4d4]">{publicPage}</span> /{" "}
                          <span className="text-[#f1e4d4]">{publicTotalPages}</span>
                        </span>

                        <button
                          type="button"
                          onClick={() =>
                            setPublicPage((p) => Math.min(publicTotalPages, p + 1))
                          }
                          disabled={publicPage >= publicTotalPages}
                          className="rounded-full border border-[#7a2b33] px-3 py-1 text-[11px] text-[#f1e4d4] hover:bg-[#4b141a]/80 disabled:opacity-40 disabled:hover:bg-transparent"
                        >
                          Siguiente →
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            printBarcodes(
                              productosPublicosPaginados,
                              `Códigos automáticos (página ${publicPage})`
                            )
                          }
                          className="rounded-full border border-[#d6b25f]/60 bg-[#d6b25f]/10 hover:bg-[#d6b25f]/20 transition-colors px-3 py-1 text-[11px] text-[#f1e4d4] disabled:opacity-40"
                          disabled={publicLoading || productosPublicosPaginados.length === 0}
                        >
                          🧾 Imprimir página (automáticos)
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="text-[#c9b296] border-b border-[#5a1b22]">
                          <th className="text-left py-2 px-2">Nombre</th>
                          <th className="text-left py-2 px-2">Categoría</th>
                          <th className="text-right py-2 px-2">Precio público (Q)</th>
                          <th className="text-right py-2 px-2">Precio mayorista (Q)</th>
                          <th className="text-left py-2 px-2">Código de barras</th>
                          <th className="text-center py-2 px-2">Disponibilidad</th>
                          <th className="text-center py-2 px-2">Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {publicLoading && (
                          <tr>
                            <td colSpan={7} className="py-4 text-center text-[#b39878]">
                              Cargando inventario público...
                            </td>
                          </tr>
                        )}

                        {!publicLoading && productosPublicosPaginados.length === 0 && (
                          <tr>
                            <td colSpan={7} className="py-4 text-center text-[#b39878]">
                              No hay productos disponibles para mostrar.
                            </td>
                          </tr>
                        )}

                        {!publicLoading &&
                          productosPublicosPaginados.map((p) => {
                            const mayoristaDefinido =
                              p.precio_mayorista !== null &&
                              p.precio_mayorista !== undefined &&
                              !Number.isNaN(Number(p.precio_mayorista));

                            const disponible = p.disponible !== false;
                            const editing = editingCatId === p.id;

                            const esAuto = isCodigoAutomatico(p.codigo_barras);

                            return (
                              <tr
                                key={p.id}
                                className="border-b border-[#3a0d12]/70 hover:bg-[#3a0d12]/70"
                              >
                                <td className="py-2 px-2 text-[#f8f1e6]">{p.nombre}</td>

                                <td className="py-2 px-2 text-[#e3d2bd]">
                                  {!editing ? (
                                    <div className="flex items-center gap-2">
                                      <span>{p.categoria || "-"}</span>
                                      <button
                                        type="button"
                                        onClick={() => startEditCategory(p)}
                                        className="text-[11px] rounded-full border border-[#7a2b33] px-2 py-0.5 hover:bg-[#4b141a]/80"
                                      >
                                        Editar
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-2">
                                      <input
                                        value={editingCatValue}
                                        onChange={(e) => setEditingCatValue(e.target.value)}
                                        className="w-40 rounded-full border border-[#6b232b] bg-[#3a0d12]/80 px-3 py-1 text-[11px] text-[#f8f1e6] focus:outline-none focus:ring-2 focus:ring-[#d6b25f]"
                                        placeholder="Ej: Pulseras"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => saveCategory(p)}
                                        disabled={savingCategory}
                                        className="text-[11px] rounded-full border border-[#d6b25f]/60 bg-[#d6b25f]/10 px-2 py-0.5 hover:bg-[#d6b25f]/20 disabled:opacity-50"
                                      >
                                        Guardar
                                      </button>
                                      <button
                                        type="button"
                                        onClick={cancelEditCategory}
                                        disabled={savingCategory}
                                        className="text-[11px] rounded-full border border-[#7a2b33] px-2 py-0.5 hover:bg-[#4b141a]/80 disabled:opacity-50"
                                      >
                                        Cancelar
                                      </button>
                                    </div>
                                  )}
                                </td>

                                <td className="py-2 px-2 text-right text-[#e3c578]">
                                  Q{" "}
                                  {Number(p.precio_venta || 0).toLocaleString("es-GT", {
                                    minimumFractionDigits: 2,
                                  })}
                                </td>

                                <td className="py-2 px-2 text-right text-[#f1e4d4]">
                                  {mayoristaDefinido
                                    ? `Q ${Number(p.precio_mayorista).toLocaleString("es-GT", {
                                        minimumFractionDigits: 2,
                                      })}`
                                    : "—"}
                                </td>

                                <td className="py-2 px-2 text-[#e3d2bd]">
                                  {p.codigo_barras || "-"}
                                </td>

                                <td className="py-2 px-2 text-center">
                                  <span
                                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border ${
                                      disponible
                                        ? "border-[#d6b25f]/60 text-[#e3c578] bg-[#d6b25f]/10"
                                        : "border-[#7a2b33] text-[#c9b296] bg-[#4b141a]"
                                    }`}
                                  >
                                    {disponible ? "Disponible" : "Agotado"}
                                  </span>
                                </td>

                                <td className="py-2 px-2 text-center">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      printBarcodes([p], `Código automático: ${p.nombre}`)
                                    }
                                    disabled={!esAuto}
                                    className="text-[11px] rounded-full border border-[#d6b25f]/60 bg-[#d6b25f]/10 px-2 py-0.5 hover:bg-[#d6b25f]/20 disabled:opacity-40"
                                  >
                                    Imprimir
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

/** =========================================================
 * ✅ Helper: descargar plantilla Excel para precios (ventas)
 * ======================================================= */
async function descargarPlantillaPrecios(
  items: Array<{
    codigo_barras: string | null;
    sku: string;
    nombre: string;
    stock_total: number;
  }>
) {
  const XLSX = await import("xlsx");

  const rows = items.map((p) => ({
    codigo_barras: p.codigo_barras ?? "",
    sku: p.sku ?? "",
    nombre: p.nombre ?? "",
    stock: Number(p.stock_total ?? 0),
    precio_cliente_final: "",
    precio_mayorista: "",
  }));

  const ws = XLSX.utils.json_to_sheet(rows, { skipHeader: false });

  (ws as any)["!cols"] = [
    { wch: 18 },
    { wch: 18 },
    { wch: 35 },
    { wch: 10 },
    { wch: 20 },
    { wch: 18 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Plantilla_Precios");

  const fileName = `plantilla_precios_ventas_${new Date()
    .toISOString()
    .slice(0, 10)}.xlsx`;

  const arrayBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([arrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** =========================
 *  COMPONENTE: INVENTARIO INTERNO
 * ========================= */
function InventoryInternalSection({
  token,
  search,
}: {
  token: string;
  search: string;
}) {
  const [rows, setRows] = useState<InventarioExistenciaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    const fetchStock = async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(
          buildApiUrl(`/api/inventory/stock?includeSinMovimientos=true`),
          { headers: { Authorization: `Bearer ${token}` } }
        );

        if (!res.ok) throw new Error("Error al cargar existencias");
        const data = await res.json();

        setRows((data.existencias || []) as InventarioExistenciaRow[]);
      } catch (err: any) {
        console.error(err);
        setError(err.message ?? "Error al cargar existencias");
        setRows([]);
      } finally {
        setLoading(false);
      }
    };

    fetchStock();
  }, [token]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const items: ProductoInternoResumen[] = useMemo(() => {
    const map = new Map<string, ProductoInternoResumen>();

    for (const r of rows) {
      const pid = String(r.producto_id);
      const prod = r.productos || {};
      const stock = Number(r.stock ?? 0) || 0;

      const costo_compra = Number(prod.costo_compra ?? 0);
      const costo_envio = Number(prod.costo_envio ?? 0);
      const costo_impuestos = Number(prod.costo_impuestos ?? 0);
      const costo_desaduanaje = Number(prod.costo_desaduanaje ?? 0);
      const costo_total_unitario =
        costo_compra + costo_envio + costo_impuestos + costo_desaduanaje;

      if (!map.has(pid)) {
        map.set(pid, {
          id: pid,
          sku: String(prod.sku ?? ""),
          nombre: String(prod.nombre ?? ""),
          codigo_barras: prod.codigo_barras ?? null,
          costo_compra,
          costo_envio,
          costo_impuestos,
          costo_desaduanaje,
          costo_total_unitario,
          stock_total: stock,
          valor_inventario: stock * costo_total_unitario,
        });
      } else {
        const prev = map.get(pid)!;
        const newStock = prev.stock_total + stock;
        map.set(pid, {
          ...prev,
          stock_total: newStock,
          valor_inventario: newStock * prev.costo_total_unitario,
        });
      }
    }

    const arr = Array.from(map.values());

    const q = String(search ?? "").trim().toLowerCase();
    const filtered = !q
      ? arr
      : arr.filter((p) => {
          return (
            (p.nombre ?? "").toLowerCase().includes(q) ||
            (p.sku ?? "").toLowerCase().includes(q) ||
            (p.codigo_barras ?? "").toLowerCase().includes(q)
          );
        });

    filtered.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
    return filtered;
  }, [rows, search]);

  const totalCostoInventario = useMemo(() => {
    return items.reduce((acc, p) => acc + (Number(p.valor_inventario) || 0), 0);
  }, [items]);

  const totalPiezas = useMemo(() => {
    return items.reduce((acc, p) => acc + (Number(p.stock_total) || 0), 0);
  }, [items]);

  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
    if (page < 1) setPage(1);
  }, [page, totalPages]);

  const startIndex = (page - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const itemsPaginados = items.slice(startIndex, endIndex);

  const handleDownloadTemplate = async () => {
    await descargarPlantillaPrecios(
      items.map((p) => ({
        codigo_barras: p.codigo_barras,
        sku: p.sku,
        nombre: p.nombre,
        stock_total: p.stock_total,
      }))
    );
  };

  return (
    <section className="bg-[#3a0d12]/80 border border-[#5a1b22] rounded-2xl p-4 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">
            Inventario interno (costos + existencias)
          </h2>
          <p className="text-[11px] text-[#c9b296]">
            SKU, nombre, costos (incluye desaduanaje), stock y el total del inventario (costo).
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="grid grid-cols-2 gap-3 min-w-[260px]">
            <MiniCard
              titulo="Total inventario (costo)"
              valor={totalCostoInventario}
              tipo="currency"
            />
            <MiniCard titulo="Piezas totales" valor={totalPiezas} tipo="number" />
          </div>

          <button
            type="button"
            onClick={handleDownloadTemplate}
            disabled={loading || !!error || items.length === 0}
            className="inline-flex items-center justify-center rounded-full border border-[#d6b25f]/60 bg-[#d6b25f]/10 hover:bg-[#d6b25f]/20 transition-colors px-3 py-1.5 text-[11px] font-medium text-[#f1e4d4] disabled:opacity-40 disabled:hover:bg-transparent"
          >
            ⬇ Descargar plantilla de precios (Excel)
          </button>

          <p className="text-[10px] text-[#c9b296] text-right max-w-[320px]">
            La plantilla sale con <b>SKU + código de barras reales</b> y <b>stock</b>.
            Tú solo llenas <b>precio_cliente_final</b> y opcional <b>precio_mayorista</b>.
          </p>
        </div>
      </div>

      {loading && <p className="text-xs text-[#c9b296]">Cargando existencias…</p>}
      {!loading && error && <p className="text-xs text-red-400">Error: {error}</p>}

      {!loading && !error && totalItems > 0 && (
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <p className="text-[11px] text-[#c9b296]">
            Mostrando <span className="text-[#f1e4d4]">{startIndex + 1}</span>–
            <span className="text-[#f1e4d4]">{endIndex}</span> de{" "}
            <span className="text-[#f1e4d4]">{totalItems}</span>
          </p>

          <div className="flex items-center gap-2">
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="rounded-full border border-[#6b232b] bg-[#3a0d12]/80 px-3 py-1 text-[11px] text-[#f8f1e6] focus:outline-none focus:ring-2 focus:ring-[#d6b25f]"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>

            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-full border border-[#7a2b33] px-3 py-1 text-[11px] text-[#f1e4d4] hover:bg-[#4b141a]/80 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              ← Anterior
            </button>

            <span className="text-[11px] text-[#c9b296]">
              Página <span className="text-[#f1e4d4]">{page}</span> /{" "}
              <span className="text-[#f1e4d4]">{totalPages}</span>
            </span>

            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-full border border-[#7a2b33] px-3 py-1 text-[11px] text-[#f1e4d4] hover:bg-[#4b141a]/80 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Siguiente →
            </button>
          </div>
        </div>
      )}

      {!loading && !error && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-[11px]">
            <thead>
              <tr className="text-[#c9b296] border-b border-[#5a1b22]">
                <th className="text-left py-2 px-2">SKU</th>
                <th className="text-left py-2 px-2">Nombre</th>
                <th className="text-right py-2 px-2">Compra</th>
                <th className="text-right py-2 px-2">Envío</th>
                <th className="text-right py-2 px-2">Impuestos</th>
                <th className="text-right py-2 px-2">Desaduanaje</th>
                <th className="text-right py-2 px-2">Costo unit. total</th>
                <th className="text-right py-2 px-2">Stock</th>
                <th className="text-right py-2 px-2">Valor inventario</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-4 text-center text-[#b39878]">
                    No hay productos con existencias para mostrar.
                  </td>
                </tr>
              )}

              {itemsPaginados.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-[#3a0d12]/70 hover:bg-[#3a0d12]/70"
                >
                  <td className="py-2 px-2 text-[#f1e4d4]">{p.sku}</td>
                  <td className="py-2 px-2 text-[#f8f1e6]">{p.nombre}</td>
                  <td className="py-2 px-2 text-right text-[#f1e4d4]">
                    {p.costo_compra.toFixed(2)}
                  </td>
                  <td className="py-2 px-2 text-right text-[#f1e4d4]">
                    {p.costo_envio.toFixed(2)}
                  </td>
                  <td className="py-2 px-2 text-right text-[#f1e4d4]">
                    {p.costo_impuestos.toFixed(2)}
                  </td>
                  <td className="py-2 px-2 text-right text-[#f1e4d4]">
                    {p.costo_desaduanaje.toFixed(2)}
                  </td>
                  <td className="py-2 px-2 text-right text-[#e3c578]">
                    {p.costo_total_unitario.toFixed(2)}
                  </td>
                  <td className="py-2 px-2 text-right text-[#f1e4d4]">
                    {p.stock_total}
                  </td>
                  <td className="py-2 px-2 text-right text-[#f1e4d4]">
                    {p.valor_inventario.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function MiniCard({
  titulo,
  valor,
  tipo,
}: {
  titulo: string;
  valor: number;
  tipo: "currency" | "number";
}) {
  const texto =
    tipo === "currency"
      ? valor.toLocaleString("es-GT", {
          style: "currency",
          currency: "GTQ",
          maximumFractionDigits: 2,
        })
      : `${Math.round(valor).toLocaleString("es-GT")}`;

  return (
    <div className="rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 p-3">
      <p className="text-[11px] text-[#c9b296]">{titulo}</p>
      <p className="mt-1 text-sm font-semibold text-[#f8f1e6]">{texto}</p>
    </div>
  );
}
