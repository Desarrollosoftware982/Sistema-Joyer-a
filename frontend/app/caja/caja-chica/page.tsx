"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AdminSidebar from "../../_components/AdminSidebar";

const API_URL =
  (process.env.NEXT_PUBLIC_API_URL &&
    process.env.NEXT_PUBLIC_API_URL.trim().replace(/\/$/, "")) ||
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:4000");

interface User {
  id: string;
  nombre: string;
  email: string;
  rol: string;
}

interface HistoryUser {
  id: string;
  nombre: string;
  email?: string;
}

interface HistorySucursal {
  id: string;
  nombre: string;
  codigo?: string;
}

interface CashClosureHistoryItem {
  id: string;
  usuario_id: string;
  sucursal_id: string;
  usuarios?: {
    nombre: string;
    email: string;
  };
  sucursales?: {
    nombre: string;
    codigo: string;
  };
}

interface CajaChicaItem {
  id: string;
  fecha: string;
  sucursal_id: string;
  cajera_id: string;
  autorizado_por_id: string;
  monto: number;
  motivo?: string | null;
  cajera?: { nombre: string; email?: string };
  autorizado_por?: { nombre: string; email?: string };
  sucursales?: { nombre: string; codigo?: string };
}

function fmtQ(n: number) {
  return `Q ${Number(n || 0).toLocaleString("es-GT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function toDateInputValue(date: Date) {
  const tzOffset = date.getTimezoneOffset() * 60000;
  const local = new Date(date.getTime() - tzOffset);
  return local.toISOString().slice(0, 10);
}

export default function CajaChicaCajeroPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const [historyUsers, setHistoryUsers] = useState<HistoryUser[]>([]);
  const [historySucursales, setHistorySucursales] = useState<HistorySucursal[]>(
    []
  );

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [cajeraId, setCajeraId] = useState("");
  const [sucursalId, setSucursalId] = useState("");
  const [soloHoy, setSoloHoy] = useState(false);

  const [entregas, setEntregas] = useState<CajaChicaItem[]>([]);
  const [cambios, setCambios] = useState<CajaChicaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingResumen, setLoadingResumen] = useState(false);

  const [resumen, setResumen] = useState<{
    totalEntregadoHoy: number;
    totalCambiosHoy: number;
    totalEntregadoMes: number;
    totalCambiosMes: number;
    saldoMes: number;
    ultimaEntrega: { fecha: string; monto: number } | null;
    ultimoCambio: { fecha: string; monto: number } | null;
  } | null>(null);

  const todayLabel = new Date().toLocaleDateString("es-GT", {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const todayIso = useMemo(() => toDateInputValue(new Date()), []);

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

  useEffect(() => {
    if (soloHoy) {
      setFrom(todayIso);
      setTo(todayIso);
      if (token) {
        loadData({ from: todayIso, to: todayIso });
      }
    }
  }, [soloHoy, todayIso, token]);

  useEffect(() => {
    if (!token) return;

    const loadOptions = async () => {
      const res = await fetch(`${API_URL}/api/cash-register/history`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const json = await res.json();
      const items: CashClosureHistoryItem[] =
        (json?.data && (json.data.items || json.data.cierres)) || [];

      const usrMap = new Map<string, HistoryUser>();
      const sucMap = new Map<string, HistorySucursal>();

      for (const h of items) {
        if (h.usuario_id && !usrMap.has(h.usuario_id)) {
          usrMap.set(h.usuario_id, {
            id: h.usuario_id,
            nombre: h.usuarios?.nombre || "Usuario",
            email: h.usuarios?.email || "",
          });
        }
        if (h.sucursal_id && !sucMap.has(h.sucursal_id)) {
          sucMap.set(h.sucursal_id, {
            id: h.sucursal_id,
            nombre: h.sucursales?.nombre || "Sucursal",
            codigo: h.sucursales?.codigo || "",
          });
        }
      }

      setHistoryUsers(Array.from(usrMap.values()));
      setHistorySucursales(Array.from(sucMap.values()));
    };

    loadOptions();
  }, [token]);

  const getQueryString = (fromValue = from, toValue = to) => {
    const params = new URLSearchParams();
    if (fromValue) params.set("from", fromValue);
    if (toValue) params.set("to", toValue);
    if (cajeraId) params.set("cajera_id", cajeraId);
    if (sucursalId) params.set("sucursal_id", sucursalId);
    return params.toString();
  };

  const queryString = useMemo(
    () => getQueryString(),
    [from, to, cajeraId, sucursalId]
  );

  const loadResumen = async () => {
    if (!token) return;
    try {
      setLoadingResumen(true);
      const res = await fetch(`${API_URL}/api/caja-chica/resumen`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const json = await res.json();
      setResumen(json?.data || null);
    } finally {
      setLoadingResumen(false);
    }
  };

  const loadData = async (override?: { from?: string; to?: string }) => {
    if (!token) return;
    try {
      setLoading(true);
      const qs = override ? getQueryString(override.from, override.to) : queryString;
      const [resE, resC] = await Promise.all([
        fetch(`${API_URL}/api/caja-chica/entregas?${qs}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_URL}/api/caja-chica/cambios?${qs}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (resE.ok) {
        const jsonE = await resE.json();
        setEntregas(jsonE?.data?.items || []);
      }
      if (resC.ok) {
        const jsonC = await resC.json();
        setCambios(jsonC?.data?.items || []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    loadResumen();
    loadData();
  }, [token, queryString]);

  const exportExcel = async () => {
    if (!token) return;
    const url = `${API_URL}/api/caja-chica/export?${queryString}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      alert(`No se pudo generar el Excel. ${txt}`.trim());
      return;
    }
    const blob = await res.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = `caja-chica_${from || "todo"}_a_${to || "todo"}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(downloadUrl);
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#2b0a0b] text-[#f1e4d4]">
        Cargando sesion...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#2b0a0b] text-[#f8f1e6] flex">
      <AdminSidebar
        user={user}
        onLogout={() => {
          localStorage.removeItem("joyeria_token");
          localStorage.removeItem("joyeria_user");
          router.push("/login");
        }}
      />

      <div className="flex-1 flex flex-col">
        <header className="border-b border-[#5a1b22] bg-[#2b0a0b]/80 backdrop-blur flex items-center justify-between px-4 md:px-8 py-4 sticky top-0 z-10">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold">Caja chica</h1>
            <p className="text-xs md:text-sm text-[#c9b296] capitalize">
              {todayLabel}
            </p>
            <p className="text-[11px] md:text-xs text-[#c9b296]">
              Tu caja chica (solo tu informacion)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exportExcel}
              className="rounded-full border border-[#7a2b33] bg-[#2b0a0b]/60 px-4 py-1.5 text-xs text-[#f1e4d4] hover:bg-[#4b141a]/80"
            >
              Descargar Excel
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 md:px-8 py-6 space-y-6">
          <section className="rounded-2xl border border-[#5a1b22] bg-[#3a0d12]/80 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs tracking-[0.35em] text-[#c9b296]">JOYERIA</p>
                <h2 className="text-xl font-semibold">Resumen del dia</h2>
                <p className="text-xs text-[#c9b296]">
                  Control de entregas, cambios y saldo disponible.
                </p>
              </div>
              <div className="text-xs text-[#c9b296]">
                {loadingResumen ? "Actualizando..." : ""}
              </div>
            </div>

            {resumen && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                <div className="bg-[#2b0a0b]/60 border border-[#5a1b22] rounded-xl px-3 py-2">
                  <div className="text-[#c9b296] text-[11px]">Entregado hoy</div>
                  <div className="text-[#d6b25f] font-semibold">
                    {fmtQ(resumen.totalEntregadoHoy)}
                  </div>
                </div>
                <div className="bg-[#2b0a0b]/60 border border-[#5a1b22] rounded-xl px-3 py-2">
                  <div className="text-[#c9b296] text-[11px]">Cambios hoy</div>
                  <div className="text-[#f1e4d4]">{fmtQ(resumen.totalCambiosHoy)}</div>
                </div>
                <div className="bg-[#2b0a0b]/60 border border-[#5a1b22] rounded-xl px-3 py-2">
                  <div className="text-[#c9b296] text-[11px]">Total entregado mes</div>
                  <div className="text-[#f1e4d4]">
                    {fmtQ(resumen.totalEntregadoMes)}
                  </div>
                </div>
                <div className="bg-[#2b0a0b]/60 border border-[#5a1b22] rounded-xl px-3 py-2">
                  <div className="text-[#c9b296] text-[11px]">Saldo mes</div>
                  <div className="text-[#d6b25f] font-semibold">
                    {fmtQ(resumen.saldoMes)}
                  </div>
                </div>
              </div>
            )}

            {resumen && (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="bg-[#2b0a0b]/60 border border-[#5a1b22] rounded-xl px-3 py-2">
                  <div className="text-[#c9b296] text-[11px]">Ultima entrega</div>
                  <div className="text-[#f1e4d4]">
                    {resumen.ultimaEntrega
                      ? `${new Date(resumen.ultimaEntrega.fecha).toLocaleString(
                          "es-GT"
                        )} - ${fmtQ(resumen.ultimaEntrega.monto)}`
                      : "-"}
                  </div>
                </div>
                <div className="bg-[#2b0a0b]/60 border border-[#5a1b22] rounded-xl px-3 py-2">
                  <div className="text-[#c9b296] text-[11px]">Ultimo cambio</div>
                  <div className="text-[#f1e4d4]">
                    {resumen.ultimoCambio
                      ? `${new Date(resumen.ultimoCambio.fecha).toLocaleString(
                          "es-GT"
                        )} - ${fmtQ(resumen.ultimoCambio.monto)}`
                      : "-"}
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-[#5a1b22] bg-[#3a0d12]/80 p-4 space-y-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-xs text-[#c9b296]">Desde</label>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  disabled={soloHoy}
                  className="mt-2 w-40 rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 px-3 py-2 text-sm text-[#f8f1e6] outline-none focus:ring-2 focus:ring-[#d6b25f]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#c9b296]">Hasta</label>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  disabled={soloHoy}
                  className="mt-2 w-40 rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 px-3 py-2 text-sm text-[#f8f1e6] outline-none focus:ring-2 focus:ring-[#d6b25f]"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-[#c9b296] mt-6">
                <input
                  type="checkbox"
                  checked={soloHoy}
                  onChange={(e) => setSoloHoy(e.target.checked)}
                  className="h-4 w-4 rounded border-[#5a1b22] bg-[#2b0a0b]/60 text-[#d6b25f] focus:ring-[#d6b25f]"
                />
                Solo hoy
              </label>
              <button
                type="button"
                onClick={() => loadData()}
                className="rounded-xl border border-[#7a2b33] bg-[#2b0a0b]/60 px-4 py-2 text-sm hover:bg-[#4b141a]/80"
              >
                Aplicar filtros
              </button>
            </div>
            <div className="text-xs text-[#c9b296]">Ver tu caja chica.</div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 p-3">
                <div className="text-sm font-semibold mb-2">Entregas</div>
                {loading && entregas.length === 0 ? (
                  <div className="text-xs text-[#c9b296]">Cargando...</div>
                ) : entregas.length === 0 ? (
                  <div className="text-xs text-[#c9b296]">Sin entregas.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="text-left text-[#c9b296]">
                          <th className="py-2 pr-3">Fecha</th>
                          <th className="py-2 pr-3">Cajera</th>
                          <th className="py-2 pr-3">Sucursal</th>
                          <th className="py-2 pr-3">Detalle</th>
                          <th className="py-2 pr-3 text-right">Monto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entregas.map((e) => (
                          <tr key={e.id} className="border-t border-[#5a1b22]">
                            <td className="py-2 pr-3">
                              {new Date(e.fecha).toLocaleString("es-GT")}
                            </td>
                            <td className="py-2 pr-3">
                              {e.cajera?.nombre || "-"}
                            </td>
                            <td className="py-2 pr-3">
                              {e.sucursales?.nombre || "-"}
                            </td>
                            <td className="py-2 pr-3">
                              <div>{e.motivo || "-"}</div>
                              <div className="text-[11px] text-[#c9b296]">
                                Autoriza: {e.autorizado_por?.nombre || "-"}
                              </div>
                            </td>
                            <td className="py-2 pr-3 text-right">
                              {fmtQ(Number(e.monto))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 p-3">
                <div className="text-sm font-semibold mb-2">Cambios dados</div>
                {loading && cambios.length === 0 ? (
                  <div className="text-xs text-[#c9b296]">Cargando...</div>
                ) : cambios.length === 0 ? (
                  <div className="text-xs text-[#c9b296]">Sin cambios.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="text-left text-[#c9b296]">
                          <th className="py-2 pr-3">Fecha</th>
                          <th className="py-2 pr-3">Cajera</th>
                          <th className="py-2 pr-3">Sucursal</th>
                          <th className="py-2 pr-3">Detalle</th>
                          <th className="py-2 pr-3 text-right">Monto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cambios.map((g) => (
                          <tr key={g.id} className="border-t border-[#5a1b22]">
                            <td className="py-2 pr-3">
                              {new Date(g.fecha).toLocaleString("es-GT")}
                            </td>
                            <td className="py-2 pr-3">
                              {g.cajera?.nombre || "-"}
                            </td>
                            <td className="py-2 pr-3">
                              {g.sucursales?.nombre || "-"}
                            </td>
                            <td className="py-2 pr-3">
                              <div>{g.motivo || "-"}</div>
                              <div className="text-[11px] text-[#c9b296]">
                                Autoriza: {g.autorizado_por?.nombre || "-"}
                              </div>
                            </td>
                            <td className="py-2 pr-3 text-right">
                              {fmtQ(Number(g.monto))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

