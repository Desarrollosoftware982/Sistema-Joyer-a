"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminSidebar from "../_components/AdminSidebar";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface User {
  id: string;
  nombre: string;
  email: string;
  rol: string;
}

interface MetodoPagoResumen {
  metodo: string;
  monto: number;
}

interface DashboardSummary {
  totalVentasDia: number;
  totalTicketsDia: number;
  ticketPromedio: number;
  utilidadBrutaDia: number;
  porMetodo: MetodoPagoResumen[];
}

interface TopProducto {
  id: string;
  sku: string;
  nombre: string;
  unidades: number;
  facturacion: number;
}

interface LowStockItem {
  producto_id: string;
  sku: string;
  nombre: string;
  stock_total: number;
  stock_minimo: number;
}

interface LastSale {
  id: string;
  fecha: string;
  cliente: string;
  total: number;
  metodo: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [topProductos, setTopProductos] = useState<TopProducto[]>([]);
  const [lowStock, setLowStock] = useState<LowStockItem[]>([]);
  const [lastSales, setLastSales] = useState<LastSale[]>([]);
  const [loading, setLoading] = useState(true);

  const today = new Date().toLocaleDateString("es-GT", {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  // 1) Verificar sesión
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

  // 2) Cargar datos dashboard
  useEffect(() => {
    if (!token) return;

    const fetchData = async () => {
      try {
        setLoading(true);

        const [resSummary, resTop, resLow, resLast] = await Promise.all([
          fetch(`${API_URL}/api/dashboard/summary`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${API_URL}/api/dashboard/top-products`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${API_URL}/api/dashboard/low-stock`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${API_URL}/api/dashboard/last-sales`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);

        if (resSummary.ok) {
          const data = await resSummary.json();
          setSummary(data.data || data);
        }

        if (resTop.ok) {
          const data = await resTop.json();
          setTopProductos(data.items || data.data || data);
        }

        if (resLow.ok) {
          const data = await resLow.json();
          setLowStock(data.items || data.data || data);
        }

        if (resLast.ok) {
          const data = await resLast.json();
          setLastSales(data.items || data.data || data);
        }
      } catch (err) {
        console.error("Error cargando dashboard", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [token]);

  const handleLogout = () => {
    localStorage.removeItem("joyeria_token");
    localStorage.removeItem("joyeria_user");
    router.push("/login");
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#2b0a0b] text-[#f1e4d4]">
        Cargando sesión...
      </div>
    );
  }

  const resumen = summary || {
    totalVentasDia: 0,
    totalTicketsDia: 0,
    ticketPromedio: 0,
    utilidadBrutaDia: 0,
    porMetodo: [
      { metodo: "EFECTIVO", monto: 0 },
      { metodo: "TRANSFERENCIA", monto: 0 },
      { metodo: "TARJETA", monto: 0 },
    ],
  };

  return (
    <div className="min-h-screen bg-[#2b0a0b] text-[#f8f1e6] flex">
      {/* Sidebar reutilizable con el menú hamburguesa */}
      <AdminSidebar user={user} onLogout={handleLogout} />

      {/* Main content */}
      <div className="flex-1 flex flex-col">
        {/* Top bar */}
        <header className="border-b border-[#5a1b22] bg-[#2b0a0b]/80 backdrop-blur flex items-center justify-between px-4 md:px-8 py-4 sticky top-0 z-10">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold">
              Resumen del día
            </h1>
            <p className="text-xs md:text-sm text-[#c9b296] capitalize">
              {today}
            </p>
          </div>

          <div className="flex items-center gap-3 text-xs md:text-sm">
            <span className="hidden md:inline text-[#c9b296]">
              Joyería — Panel interno
            </span>
          </div>
        </header>

        {/* Content (igual que ya tenías) */}
        <main className="flex-1 px-4 md:px-8 py-6 space-y-6">
          {/* Métricas principales */}
          <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <MetricCard
              title="Ventas del día"
              value={`Q ${resumen.totalVentasDia.toLocaleString("es-GT", {
                minimumFractionDigits: 2,
              })}`}
              subtitle="Total facturado hoy"
              accent="emerald"
            />
            <MetricCard
              title="Tickets"
              value={resumen.totalTicketsDia.toString()}
              subtitle="Ventas registradas"
              accent="sky"
            />
            <MetricCard
              title="Ticket promedio"
              value={`Q ${resumen.ticketPromedio.toLocaleString("es-GT", {
                minimumFractionDigits: 2,
              })}`}
              subtitle="Promedio por venta"
              accent="violet"
            />
            <MetricCard
              title="Utilidad bruta"
              value={`Q ${resumen.utilidadBrutaDia.toLocaleString("es-GT", {
                minimumFractionDigits: 2,
              })}`}
              subtitle="Antes de gastos generales"
              accent="amber"
            />
          </section>

          {/* Ventas por método de pago + Top productos */}
          <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="xl:col-span-1 bg-[#3a0d12]/70 border border-[#5a1b22] rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">
                  Ventas por método de pago
                </h2>
                <span className="text-[11px] text-[#c9b296]">
                  Efectivo • Transferencia • Tarjeta
                </span>
              </div>

              <div className="space-y-3 mt-2">
                {resumen.porMetodo.map((m) => {
                  const total = resumen.totalVentasDia || 1;
                  const pct = Math.round((m.monto / total) * 100);

                  return (
                    <div key={m.metodo} className="space-y-1">
                      <div className="flex justify-between text-xs text-[#e3d2bd]">
                        <span>{m.metodo}</span>
                        <span>
                          Q{" "}
                          {m.monto.toLocaleString("es-GT", {
                            minimumFractionDigits: 2,
                          })}{" "}
                          · {isNaN(pct) ? 0 : pct}%
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-[#4b141a] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#d6b25f] via-[#e3c578] to-[#f0d99a]"
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {loading && (
                <p className="mt-4 text-[11px] text-[#b39878]">
                  Cargando movimientos del día...
                </p>
              )}
            </div>

            <div className="xl:col-span-2 bg-[#3a0d12]/70 border border-[#5a1b22] rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">Top productos del día</h2>
                <span className="text-[11px] text-[#c9b296]">
                  Basado en unidades vendidas
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="text-[#c9b296] border-b border-[#5a1b22]">
                      <th className="text-left py-2 pr-4">Producto</th>
                      <th className="text-right py-2 pr-4">Unidades</th>
                      <th className="text-right py-2 pr-4">Facturación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topProductos.length === 0 && !loading && (
                      <tr>
                        <td
                          colSpan={3}
                          className="py-4 text-center text-[#b39878]"
                        >
                          Aún no hay ventas registradas hoy.
                        </td>
                      </tr>
                    )}
                    {topProductos.map((p) => (
                      <tr
                        key={p.id}
                        className="border-b border-[#3a0d12]/60 hover:bg-[#3a0d12]/60"
                      >
                        <td className="py-2 pr-4">
                          <div className="flex flex-col">
                            <span className="font-medium text-[#f8f1e6]">
                              {p.nombre}
                            </span>
                            <span className="text-[11px] text-[#b39878]">
                              SKU: {p.sku}
                            </span>
                          </div>
                        </td>
                        <td className="py-2 pr-4 text-right text-[#f8f1e6]">
                          {p.unidades}
                        </td>
                        <td className="py-2 pr-4 text-right text-[#e3c578]">
                          Q{" "}
                          {p.facturacion.toLocaleString("es-GT", {
                            minimumFractionDigits: 2,
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {loading && (
                <p className="mt-3 text-[11px] text-[#b39878]">
                  Cargando productos más vendidos...
                </p>
              )}
            </div>
          </section>

          {/* Stock bajo + últimas ventas */}
          <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="xl:col-span-1 bg-[#3a0d12]/70 border border-[#5a1b22] rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">Alertas de stock bajo</h2>
                <span className="text-[11px] text-[#c9b296]">
                  Productos por debajo del mínimo
                </span>
              </div>

              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {lowStock.length === 0 && !loading && (
                  <p className="text-[11px] text-[#b39878]">
                    Todo con buen nivel de inventario por ahora.
                  </p>
                )}
                {lowStock.map((item) => (
                  <div
                    key={item.producto_id}
                    className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2"
                  >
                    <div className="text-xs">
                      <div className="font-medium text-[#f8f1e6]">
                        {item.nombre}
                      </div>
                      <div className="text-[11px] text-[#c9b296]">
                        SKU: {item.sku}
                      </div>
                    </div>
                    <div className="text-right text-xs">
                      <div className="text-amber-400 font-semibold">
                        {item.stock_total} u
                      </div>
                      <div className="text-[11px] text-[#c9b296]">
                        Mín: {item.stock_minimo}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="xl:col-span-2 bg-[#3a0d12]/70 border border-[#5a1b22] rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">Últimas ventas</h2>
                <span className="text-[11px] text-[#c9b296]">
                  Las 10 operaciones más recientes
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="text-[#c9b296] border-b border-[#5a1b22]">
                      <th className="text-left py-2 pr-3">Fecha / Hora</th>
                      <th className="text-left py-2 pr-3">Cliente</th>
                      <th className="text-center py-2 pr-3">Método</th>
                      <th className="text-right py-2 pr-3">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lastSales.length === 0 && !loading && (
                      <tr>
                        <td
                          colSpan={4}
                          className="py-4 text-center text-[#b39878]"
                        >
                          Aún no hay ventas registradas.
                        </td>
                      </tr>
                    )}
                    {lastSales.map((v) => (
                      <tr
                        key={v.id}
                        className="border-b border-[#3a0d12]/60 hover:bg-[#3a0d12]/60"
                      >
                        <td className="py-2 pr-3">
                          <div className="flex flex-col">
                            <span className="text-[#f8f1e6]">
                              {new Date(v.fecha).toLocaleDateString("es-GT", {
                                day: "2-digit",
                                month: "2-digit",
                                year: "2-digit",
                              })}
                            </span>
                            <span className="text-[11px] text-[#b39878]">
                              {new Date(v.fecha).toLocaleTimeString("es-GT", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                        </td>
                        <td className="py-2 pr-3 text-[#f8f1e6]">
                          {v.cliente || "Consumidor final"}
                        </td>
                        <td className="py-2 pr-3 text-center">
                          <span className="px-2 py-1 rounded-full text-[11px] bg-[#4b141a] border border-[#6b232b] text-[#f1e4d4]">
                            {v.metodo}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-right text-[#e3c578]">
                          Q{" "}
                          {v.total.toLocaleString("es-GT", {
                            minimumFractionDigits: 2,
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {loading && (
                <p className="mt-3 text-[11px] text-[#b39878]">
                  Cargando últimas ventas...
                </p>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

/** Tarjeta reutilizable de métricas */
type AccentKey = "emerald" | "sky" | "violet" | "amber";

function MetricCard({
  title,
  value,
  subtitle,
  accent,
}: {
  title: string;
  value: string;
  subtitle: string;
  accent: AccentKey;
}) {
  const accentColors: Record<AccentKey, string> = {
    emerald: "from-[#d6b25f]/80 to-[#f0d99a]/40",
    sky: "from-[#c39a4c]/80 to-[#e3c578]/40",
    violet: "from-[#b88b34]/80 to-[#e7c979]/40",
    amber: "from-[#e1b864]/80 to-[#c39a4c]/40",
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[#5a1b22] bg-[#3a0d12]/70 px-4 py-4">
      <div
        className={`pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full bg-gradient-to-br ${accentColors[accent]} opacity-40 blur-2xl`}
      />
      <div className="flex flex-col gap-1 relative">
        <span className="text-xs text-[#c9b296]">{title}</span>
        <span className="text-xl font-semibold text-[#f8f1e6]">{value}</span>
        <span className="text-[11px] text-[#b39878]">{subtitle}</span>
      </div>
    </div>
  );
}
