// frontend/app/dashboard/inventario/InventoryCostDashboard.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

// -------------------- Tipos --------------------

type NumericLike = number | string;

interface Producto {
  id: string;
  sku: string;
  codigo_barras: string | null;
  nombre: string;
  precio_venta: NumericLike;
  iva_porcentaje: NumericLike;
  stock_minimo: NumericLike;
  activo: boolean;
  archivado: boolean;
  creado_en: string;

  // Campos de costo que ya expone el backend
  costo_compra?: NumericLike;
  costo_envio?: NumericLike;
  costo_impuestos?: NumericLike;
  costo_desaduanaje?: NumericLike;

  // Por si el backend los expone (fallback)
  costo_promedio?: NumericLike;
  costo_ultimo?: NumericLike;
}

interface Sucursal {
  id: string;
  nombre: string;
  codigo?: string;
}

interface Ubicacion {
  id: string;
  nombre: string;
  es_vitrina: boolean;
  es_bodega: boolean;
  sucursal_id: string;
  sucursales: Sucursal;
}

interface InventarioExistencia {
  producto_id: string;
  ubicacion_id: string;
  stock: NumericLike;
  productos: Producto;
  ubicaciones: Ubicacion;
}

// -------------------- Helpers --------------------

/**
 * ✅ En Render (misma app / mismo dominio): usar rutas relativas "/api/..."
 * ✅ En local: si defines NEXT_PUBLIC_API_URL, lo respeta (ej. http://localhost:4000)
 */
const API_BASE_RAW =
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "";
const API_BASE = API_BASE_RAW.replace(/\/+$/, "");

function buildApiUrl(path: string) {
  if (API_BASE) return `${API_BASE}${path}`;

  if (typeof window !== "undefined") {
    const isLocalhost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    if (!isLocalhost) return path; // "/api/..."
  }

  return `http://localhost:4000${path}`;
}

function toNumber(value: NumericLike | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  // tolera "1,234.56"
  const s = String(value).replace(/,/g, "").trim();
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : n;
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("joyeria_token");
}

function getAuthHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatGTQ(n: number) {
  return n.toLocaleString("es-GT", {
    style: "currency",
    currency: "GTQ",
    maximumFractionDigits: 2,
  });
}

function formatNum(n: number) {
  return n.toLocaleString("es-GT", { maximumFractionDigits: 2 });
}

// -------------------- Componente principal --------------------

type SortKey = "valor" | "margen" | "stock" | "nombre" | "sku";

const InventoryCostDashboard: React.FC = () => {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [stock, setStock] = useState<InventarioExistencia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // UI
  const [search, setSearch] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  const [onlyWithStock, setOnlyWithStock] = useState(false);

  const [sortKey, setSortKey] = useState<SortKey>("valor");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    async function loadData() {
      try {
        setLoading(true);
        setError(null);

        const token = getToken();
        if (!token) {
          throw new Error("No hay sesión activa. Inicia sesión nuevamente.");
        }

        const headers: HeadersInit = {
          ...getAuthHeaders(),
        };

        // 1) Productos con costos
        //    (Respuesta puede variar: {ok,data:{items}} | {data:{items}} | {items} | array)
        // 2) Existencias
        //    (Respuesta puede variar: {ok,existencias} | {existencias} | {data:{existencias}} | array)
        const [prodRes, stockRes] = await Promise.all([
          fetch(buildApiUrl(`/api/catalog/products?page=1&pageSize=500`), {
            headers,
            signal: controller.signal,
          }),
          fetch(buildApiUrl(`/api/inventory/stock`), {
            headers,
            signal: controller.signal,
          }),
        ]);

        if (!prodRes.ok) throw new Error("Error cargando productos");
        if (!stockRes.ok) throw new Error("Error cargando existencias");

        const prodJson = await prodRes.json().catch(() => null);
        const stockJson = await stockRes.json().catch(() => null);

        // Si backend manda ok=false
        if (prodJson?.ok === false) {
          throw new Error(prodJson?.message || "Respuesta inválida de productos");
        }
        if (stockJson?.ok === false) {
          throw new Error(stockJson?.message || "Respuesta inválida de existencias");
        }

        const prodItems: Producto[] = Array.isArray(prodJson)
          ? prodJson
          : (prodJson?.data?.items ??
              prodJson?.items ??
              prodJson?.data ??
              []) as Producto[];

        const existencias: InventarioExistencia[] = Array.isArray(stockJson)
          ? stockJson
          : (stockJson?.existencias ??
              stockJson?.data?.existencias ??
              stockJson?.data ??
              []) as InventarioExistencia[];

        if (!isMounted) return;

        setProductos(prodItems || []);
        setStock(existencias || []);
      } catch (err: any) {
        console.error(err);
        if (!isMounted) return;
        setError(err?.message ?? "Error cargando datos");
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadData();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, []);

  // Stock total por producto (sumando todas las sucursales)
  const stockPorProducto = useMemo(() => {
    const map = new Map<
      string,
      { stockTotal: number; sucursales: Record<string, number> }
    >();

    for (const ex of stock) {
      const pid = String((ex as any)?.producto_id ?? "");
      if (!pid) continue;

      const qty = toNumber(ex.stock);
      const sucursalNombre =
        ex?.ubicaciones?.sucursales?.nombre?.trim() || "Sucursal";

      if (!map.has(pid)) {
        map.set(pid, { stockTotal: 0, sucursales: {} });
      }

      const entry = map.get(pid)!;
      entry.stockTotal += qty;
      entry.sucursales[sucursalNombre] =
        (entry.sucursales[sucursalNombre] ?? 0) + qty;
    }

    return map;
  }, [stock]);

  // Métricas por producto (costo total, margen, valor inventario)
  const productosConMetricas = useMemo(() => {
    return (productos || []).map((p) => {
      const costoCompra = toNumber(p.costo_compra);
      const costoEnvio = toNumber(p.costo_envio);
      const costoImpuestos = toNumber(p.costo_impuestos);
      const costoDesaduanaje = toNumber(p.costo_desaduanaje);

      const costoSuma =
        costoCompra + costoEnvio + costoImpuestos + costoDesaduanaje;

      // Fallback si por algún motivo los 4 campos vienen en 0 pero hay costo_promedio/costo_ultimo
      const fallback =
        toNumber(p.costo_promedio) || toNumber(p.costo_ultimo) || 0;

      const costoTotalUnitario = costoSuma > 0 ? costoSuma : fallback;

      const precioVenta = toNumber(p.precio_venta);
      const margenUnitario = precioVenta - costoTotalUnitario;

      const margenPorcentaje =
        costoTotalUnitario > 0 ? (margenUnitario / costoTotalUnitario) * 100 : 0;

      const stockInfo = stockPorProducto.get(String(p.id));
      const stockTotal = stockInfo?.stockTotal ?? 0;

      const valorInventario = stockTotal * costoTotalUnitario;

      const stockMin = toNumber(p.stock_minimo);

      return {
        ...p,
        costoCompra,
        costoEnvio,
        costoImpuestos,
        costoDesaduanaje,
        costoTotalUnitario,
        margenUnitario,
        margenPorcentaje,
        stockTotal,
        valorInventario,
        stockMinimoNum: stockMin,
        sucursales: stockInfo?.sucursales ?? {},
      };
    });
  }, [productos, stockPorProducto]);

  // -------------------- Filtros + orden + paginación --------------------

  const q = search.trim().toLowerCase();

  const productosFiltrados = useMemo(() => {
    let arr = [...productosConMetricas];

    if (onlyActive) {
      arr = arr.filter((p) => p.activo && !p.archivado);
    }

    if (onlyWithStock) {
      arr = arr.filter((p) => (p.stockTotal ?? 0) > 0);
    }

    if (q) {
      arr = arr.filter((p) => {
        const nombre = String(p.nombre ?? "").toLowerCase();
        const sku = String(p.sku ?? "").toLowerCase();
        const barcode = String(p.codigo_barras ?? "").toLowerCase();
        return (
          nombre.includes(q) || sku.includes(q) || barcode.includes(q)
        );
      });
    }

    const dir = sortDir === "asc" ? 1 : -1;

    arr.sort((a, b) => {
      if (sortKey === "valor") return (a.valorInventario - b.valorInventario) * dir;
      if (sortKey === "margen") return (a.margenUnitario - b.margenUnitario) * dir;
      if (sortKey === "stock") return (a.stockTotal - b.stockTotal) * dir;
      if (sortKey === "sku") return String(a.sku || "").localeCompare(String(b.sku || "")) * dir;
      return String(a.nombre || "").localeCompare(String(b.nombre || "")) * dir;
    });

    return arr;
  }, [productosConMetricas, onlyActive, onlyWithStock, q, sortKey, sortDir]);

  const totalItems = productosFiltrados.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / Math.max(1, pageSize)));

  useEffect(() => {
    setPage(1);
  }, [search, onlyActive, onlyWithStock, pageSize, sortKey, sortDir]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
    if (page < 1) setPage(1);
  }, [page, totalPages]);

  const startIndex = (page - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);

  const productosPaginados = useMemo(() => {
    return productosFiltrados.slice(startIndex, endIndex);
  }, [productosFiltrados, startIndex, endIndex]);

  // Resumen global (sobre lo que estás viendo: filtrado)
  const resumenGlobal = useMemo(() => {
    let valorInventarioTotal = 0;
    let margenTotal = 0;
    let ventasPotenciales = 0;

    for (const p of productosFiltrados) {
      valorInventarioTotal += p.valorInventario || 0;
      margenTotal += (p.margenUnitario || 0) * (p.stockTotal || 0);
      ventasPotenciales += toNumber(p.precio_venta) * (p.stockTotal || 0);
    }

    const margenPromedio =
      valorInventarioTotal > 0 ? (margenTotal / valorInventarioTotal) * 100 : 0;

    return {
      valorInventarioTotal,
      margenTotal,
      margenPromedio,
      ventasPotenciales,
    };
  }, [productosFiltrados]);

  // -------------------- UI states --------------------

  if (loading) {
    return (
      <div className="p-4 text-xs text-[#c9b296]">
        Cargando inventario y costos… ⏳
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-xs text-red-400">
        Error al cargar datos: {error}
      </div>
    );
  }

  const toggleSort = (key: SortKey) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("desc");
      return;
    }
    setSortDir((d) => (d === "desc" ? "asc" : "desc"));
  };

  return (
    <div className="space-y-4">
      {/* Controles */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, SKU o código…"
            className="w-full md:w-80 rounded-full border border-[#6b232b] bg-[#2b0a0b]/70 px-4 py-2 text-xs text-[#f8f1e6] placeholder-[#b39878] focus:outline-none focus:ring-2 focus:ring-[#d6b25f]"
          />

          <label className="flex items-center gap-2 text-[11px] text-[#c9b296]">
            <input
              type="checkbox"
              checked={onlyActive}
              onChange={(e) => setOnlyActive(e.target.checked)}
              className="accent-[#d6b25f]"
            />
            Solo activos (no archivados)
          </label>

          <label className="flex items-center gap-2 text-[11px] text-[#c9b296]">
            <input
              type="checkbox"
              checked={onlyWithStock}
              onChange={(e) => setOnlyWithStock(e.target.checked)}
              className="accent-[#d6b25f]"
            />
            Solo con stock
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="rounded-full border border-[#6b232b] bg-[#2b0a0b]/70 px-3 py-2 text-[11px] text-[#f8f1e6] focus:outline-none focus:ring-2 focus:ring-[#d6b25f]"
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
            className="rounded-full border border-[#7a2b33] px-3 py-2 text-[11px] text-[#f1e4d4] hover:bg-[#4b141a]/80 disabled:opacity-40 disabled:hover:bg-transparent"
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
            className="rounded-full border border-[#7a2b33] px-3 py-2 text-[11px] text-[#f1e4d4] hover:bg-[#4b141a]/80 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            Siguiente →
          </button>
        </div>
      </div>

      {/* Resumen global */}
      <div className="grid gap-4 md:grid-cols-4">
        <ResumenCard
          titulo="Valor total inventario (costo)"
          valor={resumenGlobal.valorInventarioTotal}
          formato="currency"
        />
        <ResumenCard
          titulo="Margen total estimado"
          valor={resumenGlobal.margenTotal}
          formato="currency"
        />
        <ResumenCard
          titulo="Margen promedio"
          valor={resumenGlobal.margenPromedio}
          formato="percentage"
        />
        <ResumenCard
          titulo="Ventas potenciales (precio venta)"
          valor={resumenGlobal.ventasPotenciales}
          formato="currency"
        />
      </div>

      {/* Info de rango */}
      <div className="text-[11px] text-[#c9b296]">
        Mostrando{" "}
        <span className="text-[#f1e4d4]">{totalItems === 0 ? 0 : startIndex + 1}</span>–
        <span className="text-[#f1e4d4]">{endIndex}</span> de{" "}
        <span className="text-[#f1e4d4]">{totalItems}</span>
        <span className="ml-2 text-[#b39878]">
          (sí, aquí es donde tu inventario te mira y te juzga en silencio 😄)
        </span>
      </div>

      {/* Tabla principal */}
      <div className="overflow-auto border border-[#5a1b22] rounded-2xl bg-[#3a0d12]/80">
        <table className="min-w-full text-[11px]">
          <thead className="bg-[#3a0d12]/90 sticky top-0">
            <tr>
              <Th onClick={() => toggleSort("sku")} className="cursor-pointer">
                SKU {sortKey === "sku" ? (sortDir === "desc" ? "↓" : "↑") : ""}
              </Th>
              <Th onClick={() => toggleSort("nombre")} className="cursor-pointer">
                Nombre{" "}
                {sortKey === "nombre" ? (sortDir === "desc" ? "↓" : "↑") : ""}
              </Th>
              <Th className="text-right">Precio venta</Th>
              <Th className="text-right">Costo proveedor</Th>
              <Th className="text-right">Envío</Th>
              <Th className="text-right">Impuestos</Th>
              <Th className="text-right">Desaduanaje</Th>
              <Th onClick={() => toggleSort("valor")} className="text-right cursor-pointer">
                Costo total{" "}
                {sortKey === "valor" ? (sortDir === "desc" ? "↓" : "↑") : ""}
              </Th>
              <Th onClick={() => toggleSort("margen")} className="text-right cursor-pointer">
                Margen / unidad{" "}
                {sortKey === "margen" ? (sortDir === "desc" ? "↓" : "↑") : ""}
              </Th>
              <Th className="text-right">Margen %</Th>
              <Th onClick={() => toggleSort("stock")} className="text-right cursor-pointer">
                Stock total{" "}
                {sortKey === "stock" ? (sortDir === "desc" ? "↓" : "↑") : ""}
              </Th>
              <Th className="text-right">Valor inventario</Th>
              <Th className="text-center">Sucursales</Th>
            </tr>
          </thead>

          <tbody>
            {productosPaginados.length === 0 && (
              <tr>
                <td colSpan={13} className="py-6 text-center text-[#b39878]">
                  No hay resultados con los filtros actuales.
                </td>
              </tr>
            )}

            {productosPaginados.map((p: any) => {
              const precioVenta = toNumber(p.precio_venta);
              const stockTotal = Number(p.stockTotal ?? 0);
              const stockMin = Number(p.stockMinimoNum ?? 0);

              const lowStock = stockMin > 0 && stockTotal <= stockMin;
              const sucKeys = Object.keys(p.sucursales || {});
              const sucTitle = sucKeys
                .map((k) => `${k}: ${formatNum(Number(p.sucursales[k] ?? 0))}`)
                .join("\n");

              return (
                <tr
                  key={p.id}
                  className={`border-t border-[#5a1b22] hover:bg-[#3a0d12] ${
                    lowStock ? "bg-[#4b141a]/30" : ""
                  }`}
                >
                  <Td className="text-[#f1e4d4]">{p.sku}</Td>
                  <Td className="text-[#f8f1e6]">
                    <div className="flex flex-col">
                      <span>{p.nombre}</span>
                      {lowStock && (
                        <span className="text-[10px] text-red-300">
                          Stock bajo (min {stockMin})
                        </span>
                      )}
                    </div>
                  </Td>

                  <Td className="text-right text-[#e3c578]">
                    {formatNum(precioVenta)}
                  </Td>

                  <Td className="text-right">{formatNum(p.costoCompra)}</Td>
                  <Td className="text-right">{formatNum(p.costoEnvio)}</Td>
                  <Td className="text-right">{formatNum(p.costoImpuestos)}</Td>
                  <Td className="text-right">{formatNum(p.costoDesaduanaje)}</Td>

                  <Td className="text-right text-[#f1e4d4]">
                    {formatNum(p.costoTotalUnitario)}
                  </Td>

                  <Td
                    className={`text-right ${
                      p.margenUnitario < 0 ? "text-red-300" : "text-[#e3c578]"
                    }`}
                  >
                    {formatNum(p.margenUnitario)}
                  </Td>

                  <Td className="text-right text-[#c9b296]">
                    {formatNum(p.margenPorcentaje)}%
                  </Td>

                  <Td className="text-right text-[#f1e4d4]">{formatNum(stockTotal)}</Td>

                  <Td className="text-right text-[#f1e4d4]">
                    {formatNum(p.valorInventario)}
                  </Td>

                  <Td className="text-center">
                    <span
                      title={sucTitle || "Sin desglose"}
                      className="inline-flex items-center gap-1 rounded-full border border-[#7a2b33] bg-[#2b0a0b]/50 px-2 py-0.5 text-[10px] text-[#f1e4d4]"
                    >
                      {sucKeys.length || 0}
                      <span className="text-[#b39878]">ver</span>
                    </span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Nota pequeña */}
      <p className="text-[10px] text-[#b39878]">
        * Margen % = (precioVenta − costoUnitario) / costoUnitario. Si el costo es 0,
        el margen % queda 0 para evitar divisiones raras (y sustos innecesarios).
      </p>
    </div>
  );
};

// -------------------- Subcomponentes simples --------------------

function ResumenCard(props: {
  titulo: string;
  valor: number;
  formato: "currency" | "percentage";
}) {
  const { titulo, valor, formato } = props;

  const formateado =
    formato === "currency" ? formatGTQ(valor) : `${valor.toFixed(1)} %`;

  return (
    <div className="rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 p-3">
      <p className="text-[11px] text-[#c9b296]">{titulo}</p>
      <p className="mt-1 text-sm font-semibold text-[#f8f1e6]">{formateado}</p>
    </div>
  );
}

function Th({
  children,
  className,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <th
      onClick={onClick}
      className={
        "px-3 py-2 text-left text-[11px] font-semibold text-[#e3d2bd] select-none " +
        (className ?? "")
      }
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td
      className={
        "px-3 py-2 whitespace-nowrap text-[#f8f1e6] text-[11px] " +
        (className ?? "")
      }
    >
      {children}
    </td>
  );
}

export default InventoryCostDashboard;
