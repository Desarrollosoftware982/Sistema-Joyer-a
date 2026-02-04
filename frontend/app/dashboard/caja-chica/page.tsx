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

function nowLocalInput() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

export default function CajaChicaAdminPage() {
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

  const [entregaForm, setEntregaForm] = useState({
    fecha: nowLocalInput(),
    cajera_id: "",
    sucursal_id: "",
    monto: "",
    motivo: "",
  });

  const todayLabel = new Date().toLocaleDateString("es-GT", {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
  });

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

      const users = Array.from(usrMap.values());
      const sucs = Array.from(sucMap.values());
      setHistoryUsers(users);
      setHistorySucursales(sucs);

      setEntregaForm((prev) => ({
        ...prev,
        cajera_id: prev.cajera_id || (users[0]?.id || ""),
        sucursal_id: prev.sucursal_id || (sucs[0]?.id || ""),
      }));
    };

    loadOptions();
  }, [token]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (cajeraId) params.set("cajera_id", cajeraId);
    if (sucursalId) params.set("sucursal_id", sucursalId);
    return params.toString();
  }, [from, to, cajeraId, sucursalId]);

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

  const loadData = async () => {
    if (!token) return;
    try {
      setLoading(true);
      const [resE, resC] = await Promise.all([
        fetch(`${API_URL}/api/caja-chica/entregas?${queryString}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_URL}/api/caja-chica/cambios?${queryString}`, {
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

  const submitEntrega = async () => {
    if (!token) return;
    const res = await fetch(`${API_URL}/api/caja-chica/entregas`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        fecha: entregaForm.fecha,
        cajera_id: entregaForm.cajera_id,
        sucursal_id: entregaForm.sucursal_id,
        monto: entregaForm.monto,
        motivo: entregaForm.motivo,
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      alert(`No se pudo registrar la entrega. ${txt}`.trim());
      return;
    }

    setEntregaForm((prev) => ({ ...prev, monto: "", motivo: "" }));
    loadResumen();
    loadData();
  };

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
          </div>
          <div />
        </header>

        <main className="flex-1 px-4 md:px-8 py-6 space-y-6">
          <section className="rounded-2xl border border-[#5a1b22] bg-[#3a0d12]/80 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs tracking-[0.35em] text-[#c9b296]">JOYERIA</p>
                <h2 className="text-xl font-semibold">Resumen del dia</h2>
                <p className="text-xs text-[#c9b296]">
                  Fondos entregados a cajeros y cambios generados.
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

          <section className="rounded-2xl border border-[#5a1b22] bg-[#3a0d12]/80 p-4 space-y-3">
            <h3 className="text-sm font-semibold">Nueva entrega a cajera</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[#c9b296]">Fecha / hora</label>
                <input
                  type="datetime-local"
                  value={entregaForm.fecha}
                  onChange={(e) =>
                    setEntregaForm((prev) => ({ ...prev, fecha: e.target.value }))
                  }
                  className="mt-2 w-full rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 px-3 py-2 text-sm text-[#f8f1e6] outline-none focus:ring-2 focus:ring-[#d6b25f]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#c9b296]">Cajera</label>
                <select
                  value={entregaForm.cajera_id}
                  onChange={(e) =>
                    setEntregaForm((prev) => ({ ...prev, cajera_id: e.target.value }))
                  }
                  className="mt-2 w-full rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 px-3 py-2 text-sm text-[#f8f1e6] outline-none focus:ring-2 focus:ring-[#d6b25f]"
                >
                  <option value="">Seleccionar</option>
                  {historyUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nombre}
                      {u.email ? ` - ${u.email}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[#c9b296]">Sucursal</label>
                <select
                  value={entregaForm.sucursal_id}
                  onChange={(e) =>
                    setEntregaForm((prev) => ({
                      ...prev,
                      sucursal_id: e.target.value,
                    }))
                  }
                  className="mt-2 w-full rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 px-3 py-2 text-sm text-[#f8f1e6] outline-none focus:ring-2 focus:ring-[#d6b25f]"
                >
                  <option value="">Seleccionar</option>
                  {historySucursales.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                      {s.codigo ? ` (${s.codigo})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[#c9b296]">Monto (Q)</label>
                <input
                  type="number"
                  value={entregaForm.monto}
                  onChange={(e) =>
                    setEntregaForm((prev) => ({ ...prev, monto: e.target.value }))
                  }
                  className="mt-2 w-full rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 px-3 py-2 text-sm text-[#f8f1e6] outline-none focus:ring-2 focus:ring-[#d6b25f]"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-[#c9b296]">Motivo / Nota</label>
              <input
                type="text"
                value={entregaForm.motivo}
                onChange={(e) =>
                  setEntregaForm((prev) => ({ ...prev, motivo: e.target.value }))
                }
                className="mt-2 w-full rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 px-3 py-2 text-sm text-[#f8f1e6] outline-none focus:ring-2 focus:ring-[#d6b25f]"
              />
            </div>
            <button
              type="button"
              onClick={submitEntrega}
              className="w-full rounded-xl border border-[#7a2b33] bg-[#2b0a0b]/60 px-4 py-2 text-sm hover:bg-[#4b141a]/80"
            >
              Registrar entrega
            </button>
          </section>

          <section className="rounded-2xl border border-[#5a1b22] bg-[#3a0d12]/80 p-4 space-y-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-xs text-[#c9b296]">Desde</label>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="mt-2 w-40 rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 px-3 py-2 text-sm text-[#f8f1e6] outline-none focus:ring-2 focus:ring-[#d6b25f]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#c9b296]">Hasta</label>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="mt-2 w-40 rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 px-3 py-2 text-sm text-[#f8f1e6] outline-none focus:ring-2 focus:ring-[#d6b25f]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#c9b296]">Cajera</label>
                <select
                  value={cajeraId}
                  onChange={(e) => setCajeraId(e.target.value)}
                  className="mt-2 w-56 rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 px-3 py-2 text-sm text-[#f8f1e6] outline-none focus:ring-2 focus:ring-[#d6b25f]"
                >
                  <option value="">Todas</option>
                  {historyUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nombre}
                      {u.email ? ` - ${u.email}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[#c9b296]">Sucursal</label>
                <select
                  value={sucursalId}
                  onChange={(e) => setSucursalId(e.target.value)}
                  className="mt-2 w-48 rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 px-3 py-2 text-sm text-[#f8f1e6] outline-none focus:ring-2 focus:ring-[#d6b25f]"
                >
                  <option value="">Todas</option>
                  {historySucursales.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                      {s.codigo ? ` (${s.codigo})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={loadData}
                className="rounded-xl border border-[#7a2b33] bg-[#2b0a0b]/60 px-4 py-2 text-sm hover:bg-[#4b141a]/80"
              >
                Aplicar filtros
              </button>
            </div>

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

