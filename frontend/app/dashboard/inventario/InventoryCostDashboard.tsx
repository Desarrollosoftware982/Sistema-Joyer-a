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

interface ProductsResponse {
  ok: boolean;
  data: {
    total: number;
    page: number;
    pageSize: number;
    items: Producto[];
  };
}

interface StockResponse {
  ok: boolean;
  existencias: InventarioExistencia[];
}

// -------------------- Helpers --------------------

// Usa el mismo nombre de variable que en el resto del front
const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:4000";

function toNumber(value: NumericLike | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  const n = parseFloat(value);
  return Number.isNaN(n) ? 0 : n;
}

function getAuthHeaders(): HeadersInit {
  if (typeof window === "undefined") return {};
  // Usa el mismo token que ya usas en el resto de páginas
  const token = localStorage.getItem("joyeria_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// -------------------- Componente principal --------------------

const InventoryCostDashboard: React.FC = () => {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [stock, setStock] = useState<InventarioExistencia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      try {
        setLoading(true);
        setError(null);

        const headers: HeadersInit = {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        };

        // 1) Productos con costos
        const prodRes = await fetch(
          `${API_URL}/api/catalog/products?page=1&pageSize=200`,
          { headers }
        );
        if (!prodRes.ok) throw new Error("Error cargando productos");
        const prodJson: ProductsResponse = await prodRes.json();
        if (!prodJson.ok) throw new Error("Respuesta inválida de productos");

        // 2) Existencias (stock)
        const stockRes = await fetch(`${API_URL}/api/inventory/stock`, {
          headers,
        });
        if (!stockRes.ok) throw new Error("Error cargando existencias");
        const stockJson: StockResponse = await stockRes.json();
        if (!stockJson.ok) throw new Error("Respuesta inválida de existencias");

        if (!isMounted) return;
        setProductos(prodJson.data.items);
        setStock(stockJson.existencias);
      } catch (err: any) {
        console.error(err);
        if (!isMounted) return;
        setError(err.message ?? "Error cargando datos");
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, []);

  // Stock total por producto (sumando todas las sucursales)
  const stockPorProducto = useMemo(() => {
    const map = new Map<
      string,
      { stockTotal: number; sucursales: Record<string, number> }
    >();

    for (const ex of stock) {
      const pid = ex.producto_id;
      const qty = toNumber(ex.stock);
      const sucursalNombre = ex.ubicaciones.sucursales.nombre;

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
    return productos.map((p) => {
      const costoCompra = toNumber(p.costo_compra);
      const costoEnvio = toNumber(p.costo_envio);
      const costoImpuestos = toNumber(p.costo_impuestos);
      const costoDesaduanaje = toNumber(p.costo_desaduanaje);

      const costoTotalUnitario =
        costoCompra + costoEnvio + costoImpuestos + costoDesaduanaje;

      const precioVenta = toNumber(p.precio_venta);
      const margenUnitario = precioVenta - costoTotalUnitario;
      const margenPorcentaje =
        costoTotalUnitario > 0
          ? (margenUnitario / costoTotalUnitario) * 100
          : 0;

      const stockInfo = stockPorProducto.get(p.id);
      const stockTotal = stockInfo?.stockTotal ?? 0;
      const valorInventario = stockTotal * costoTotalUnitario;

      return {
        ...p,
        costoTotalUnitario,
        margenUnitario,
        margenPorcentaje,
        stockTotal,
        valorInventario,
        sucursales: stockInfo?.sucursales ?? {},
      };
    });
  }, [productos, stockPorProducto]);

  // Resumen global
  const resumenGlobal = useMemo(() => {
    let valorInventarioTotal = 0;
    let margenTotal = 0;
    let ventasPotenciales = 0;

    for (const p of productosConMetricas) {
      valorInventarioTotal += p.valorInventario;
      margenTotal += p.margenUnitario * p.stockTotal;
      ventasPotenciales += toNumber(p.precio_venta) * p.stockTotal;
    }

    const margenPromedio =
      valorInventarioTotal > 0
        ? (margenTotal / valorInventarioTotal) * 100
        : 0;

    return {
      valorInventarioTotal,
      margenTotal,
      margenPromedio,
      ventasPotenciales,
    };
  }, [productosConMetricas]);

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

  return (
    <div className="space-y-4">
      {/* Resumen global */}
      <div className="grid gap-4 md:grid-cols-4">
        <ResumenCard
          titulo="Valor total de inventario (costo)"
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

      {/* Tabla principal */}
      <div className="overflow-auto border border-[#5a1b22] rounded-2xl bg-[#3a0d12]/80">
        <table className="min-w-full text-[11px]">
          <thead className="bg-[#3a0d12]/90">
            <tr>
              <Th>SKU</Th>
              <Th>Nombre</Th>
              <Th>Precio venta</Th>
              <Th>Costo proveedor</Th>
              <Th>Envío</Th>
              <Th>Impuestos</Th>
              <Th>Desaduanaje</Th>
              <Th>Costo total</Th>
              <Th>Margen / unidad</Th>
              <Th>Margen %</Th>
              <Th>Stock total</Th>
              <Th>Valor inventario</Th>
            </tr>
          </thead>
          <tbody>
            {productosConMetricas.map((p) => (
              <tr
                key={p.id}
                className="border-t border-[#5a1b22] hover:bg-[#3a0d12]"
              >
                <Td>{p.sku}</Td>
                <Td>{p.nombre}</Td>
                <Td className="text-right">
                  {toNumber(p.precio_venta).toFixed(2)}
                </Td>
                <Td className="text-right">
                  {toNumber(p.costo_compra).toFixed(2)}
                </Td>
                <Td className="text-right">
                  {toNumber(p.costo_envio).toFixed(2)}
                </Td>
                <Td className="text-right">
                  {toNumber(p.costo_impuestos).toFixed(2)}
                </Td>
                <Td className="text-right">
                  {toNumber(p.costo_desaduanaje).toFixed(2)}
                </Td>
                <Td className="text-right">
                  {p.costoTotalUnitario.toFixed(2)}
                </Td>
                <Td
                  className={`text-right ${
                    p.margenUnitario < 0 ? "text-red-300" : "text-[#e3c578]"
                  }`}
                >
                  {p.margenUnitario.toFixed(2)}
                </Td>
                <Td className="text-right">
                  {p.margenPorcentaje.toFixed(1)}%
                </Td>
                <Td className="text-right">{p.stockTotal}</Td>
                <Td className="text-right">
                  {p.valorInventario.toFixed(2)}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
    formato === "currency"
      ? valor.toLocaleString("es-GT", {
          style: "currency",
          currency: "GTQ",
          maximumFractionDigits: 2,
        })
      : `${valor.toFixed(1)} %`;

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
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={
        "px-3 py-2 text-left text-[11px] font-semibold text-[#e3d2bd] " +
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
