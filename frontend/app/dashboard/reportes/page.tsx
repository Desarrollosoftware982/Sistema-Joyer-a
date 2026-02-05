"use client";

import { useEffect, useMemo, useState } from "react";
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

interface CashClosure {
  id: string;
  sucursal_id: string;
  fecha_inicio: string;
  fecha_fin: string | null;
  total_efectivo: number;
  total_transferencia: number;
  total_tarjeta: number;
  total_general: number;
}

// Para el historial: incluye usuario y sucursal si el backend los manda
interface CashClosureHistoryItem extends CashClosure {
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

export default function ReportesPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  // Cierre del día (resumen)
  const [cierre, setCierre] = useState<CashClosure | null>(null);
  const [estadoCaja, setEstadoCaja] = useState<"SIN_APERTURA" | "ABIERTO" | "CERRADO">(
    "SIN_APERTURA"
  );
  const [loadingCierre, setLoadingCierre] = useState(false);
  const [errorCierre, setErrorCierre] = useState<string | null>(null);

  // Historial
  const [history, setHistory] = useState<CashClosureHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [errorHistory, setErrorHistory] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const [historyUserId, setHistoryUserId] = useState("");
  const [historySucursalId, setHistorySucursalId] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const historyPageSize = 10;

  const today = new Date().toLocaleDateString("es-GT", {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  // ========= SESIÓN =========
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
      return;
    }
  }, [router]);

  // ========= HELPERS =========
  const formatQ = (n: number | null | undefined) =>
    `Q ${Number(n || 0).toLocaleString("es-GT", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const estadoCierre = () => {
    if (estadoCaja) return estadoCaja;
    if (!cierre) return "SIN_APERTURA";
    if (!cierre.fecha_fin) return "ABIERTO";
    return "CERRADO";
  };

  const historyUsers = useMemo(() => {
    const map = new Map<string, { id: string; nombre: string; email?: string }>();
    for (const h of history) {
      if (!h.usuario_id || map.has(h.usuario_id)) continue;
      map.set(h.usuario_id, {
        id: h.usuario_id,
        nombre: h.usuarios?.nombre || "Usuario",
        email: h.usuarios?.email || "",
      });
    }
    return Array.from(map.values());
  }, [history]);

  const historySucursales = useMemo(() => {
    const map = new Map<string, { id: string; nombre: string; codigo?: string }>();
    for (const h of history) {
      if (!h.sucursal_id || map.has(h.sucursal_id)) continue;
      map.set(h.sucursal_id, {
        id: h.sucursal_id,
        nombre: h.sucursales?.nombre || "Sucursal",
        codigo: h.sucursales?.codigo || "",
      });
    }
    return Array.from(map.values());
  }, [history]);

  const filteredHistory = useMemo(() => {
    const start = historyFrom ? new Date(`${historyFrom}T00:00:00`) : null;
    const end = historyTo ? new Date(`${historyTo}T23:59:59`) : null;

    return history.filter((h) => {
      if (historyUserId && h.usuario_id !== historyUserId) return false;
      if (historySucursalId && h.sucursal_id !== historySucursalId) return false;

      if (start || end) {
        const fecha = new Date(h.fecha_inicio);
        if (start && fecha < start) return false;
        if (end && fecha > end) return false;
      }
      return true;
    });
  }, [history, historyFrom, historyTo, historyUserId, historySucursalId]);

  useEffect(() => {
    setHistoryPage(1);
  }, [historyFrom, historyTo, historyUserId, historySucursalId]);

  // ========= CARGAR CIERRE DEL DÍA =========
  useEffect(() => {
    if (!token) return;

    const load = async () => {
      try {
        setLoadingCierre(true);
        setErrorCierre(null);

        // Backend: GET /api/cash-register/today
        const scopeParam =
          user?.rol?.toUpperCase?.() === "ADMIN" ? "?scope=SUCURSAL" : "";
        const res = await fetch(
          buildApiUrl(`/api/cash-register/today${scopeParam}`),
          {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          }
        );

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          console.error(
            "Error HTTP /api/cash-register/today:",
            res.status,
            text.slice(0, 200)
          );
          throw new Error("No se pudo cargar el cierre de caja.");
        }

        const json = await res.json();

        if (json.ok === false) {
          throw new Error(
            json.message || "No se pudo cargar el cierre de caja."
          );
        }

        // backend: { ok, data: { estado, cierreActual } }
        const payload = json.data || {};
        const cierreActual = payload.cierreActual || payload.cierre || null;
        const estadoApi = String(payload.estado || "").trim().toUpperCase();

        setCierre(cierreActual);
        if (estadoApi === "ABIERTO" || estadoApi === "CERRADO" || estadoApi === "SIN_APERTURA") {
          setEstadoCaja(estadoApi as "SIN_APERTURA" | "ABIERTO" | "CERRADO");
        } else {
          setEstadoCaja(cierreActual ? (cierreActual.fecha_fin ? "CERRADO" : "ABIERTO") : "SIN_APERTURA");
        }
      } catch (err: any) {
        console.error(err);
        setErrorCierre(err.message || "Error cargando cierre de caja.");
      } finally {
        setLoadingCierre(false);
      }
    };

    load();
  }, [token]);

  // ========= CARGAR HISTORIAL DE CIERRES =========
  const loadHistory = async () => {
    if (!token) return;
    try {
      setLoadingHistory(true);
      setErrorHistory(null);

      // Backend esperado: GET /api/cash-register/history
      const res = await fetch(buildApiUrl("/api/cash-register/history"), {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error(
          "Error HTTP /api/cash-register/history:",
          res.status,
          text.slice(0, 200)
        );
        throw new Error("No se pudo cargar el historial de cierres.");
      }

      const json = await res.json();

      if (json.ok === false) {
        throw new Error(
          json.message || "No se pudo cargar el historial de cierres."
        );
      }

      const data =
        (json.data && (json.data.items || json.data.cierres)) || [];

      setHistory(data);
    } catch (err: any) {
      console.error(err);
      setErrorHistory(
        err.message || "Error cargando historial de cierres."
      );
    } finally {
      setLoadingHistory(false);
    }
  };

  // ========= DESCARGAR EXCEL DEL CIERRE (SOLO LECTURA) =========
  const descargarExcelCierre = () => {
    if (!token || !cierre) return;
    // Suponiendo backend: GET /api/cash-register/:id/excel
    window.open(
      buildApiUrl(`/api/cash-register/${cierre.id}/excel?token=${token}`),
      "_blank"
    );
  };

  const estado = estadoCierre();

  // ========= RENDER =========
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#2b0a0b] text-[#f1e4d4]">
        Cargando sesión...
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
        {/* HEADER */}
        <header className="border-b border-[#5a1b22] bg-[#2b0a0b]/80 backdrop-blur flex items-center justify-between px-4 md:px-8 py-4 sticky top-0 z-10">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold">
              Reportes y cierre de caja
            </h1>
            <p className="text-xs md:text-sm text-[#c9b296] capitalize">
              {today}
            </p>
          </div>
        </header>

        {/* CONTENIDO */}
        <main className="flex-1 px-4 md:px-8 py-6 space-y-6">
          {/* CARD CIERRE DE CAJA (DÍA ACTUAL) */}
          <section className="bg-[#3a0d12]/80 border border-[#5a1b22] rounded-2xl p-4 md:p-5 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">
                  Cierre de caja del día
                </h2>
                <p className="text-xs text-[#c9b296]">
                  Resumen del estado de la caja del día actual.
                </p>
              </div>

              <div className="flex items-center gap-2 text-xs">
                <span className="text-[#c9b296]">Estado:</span>
                {estado === "SIN_APERTURA" && (
                  <span className="px-2 py-1 rounded-full bg-[#4b141a] text-[#f1e4d4]">
                    Sin apertura hoy
                  </span>
                )}
                {estado === "ABIERTO" && (
                  <span className="px-2 py-1 rounded-full bg-[#d6b25f]/10 text-[#e3c578] border border-[#d6b25f]/40">
                    Aperturada hoy
                  </span>
                )}
                {estado === "CERRADO" && (
                  <span className="px-2 py-1 rounded-full bg-[#c39a4c]/10 text-[#d9ba72] border border-[#c39a4c]/40">
                    Cerrada
                  </span>
                )}
              </div>
            </div>

            {loadingCierre && (
              <p className="text-xs text-[#c9b296]">
                Cargando información del cierre...
              </p>
            )}

            {errorCierre && (
              <p className="text-xs text-red-300 bg-red-900/40 border border-red-700/60 rounded-lg px-3 py-2">
                {errorCierre}
              </p>
            )}

            {!loadingCierre && !cierre && !errorCierre && (
              <p className="text-xs text-[#c9b296]">
                No hay cierre registrado para hoy. La apertura y cierre se
                realizan desde el módulo de Caja/POS.
              </p>
            )}

            {/* Resumen de totales */}
            {cierre && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs mt-2">
                <div className="bg-[#2b0a0b]/60 border border-[#5a1b22] rounded-xl px-3 py-2">
                  <div className="text-[#c9b296] text-[11px]">
                    Apertura
                  </div>
                  <div className="text-[#f8f1e6]">
                    {new Date(cierre.fecha_inicio).toLocaleString(
                      "es-GT"
                    )}
                  </div>
                </div>
                <div className="bg-[#2b0a0b]/60 border border-[#5a1b22] rounded-xl px-3 py-2">
                  <div className="text-[#c9b296] text-[11px]">
                    Cierre
                  </div>
                  <div className="text-[#f8f1e6]">
                    {cierre.fecha_fin
                      ? new Date(
                          cierre.fecha_fin
                        ).toLocaleString("es-GT")
                      : "-"}
                  </div>
                </div>
                <div className="bg-[#2b0a0b]/60 border border-[#5a1b22] rounded-xl px-3 py-2">
                  <div className="text-[#c9b296] text-[11px]">
                    Total general
                  </div>
                  <div className="text-[#d6b25f] font-semibold">
                    {formatQ(cierre.total_general)}
                  </div>
                </div>
                <div className="bg-[#2b0a0b]/60 border border-[#5a1b22] rounded-xl px-3 py-2">
                  <div className="text-[#c9b296] text-[11px]">
                    Métodos de pago
                  </div>
                  <div className="text-[#f1e4d4] space-x-2">
                    <span>E: {formatQ(cierre.total_efectivo)}</span>
                    <span>T: {formatQ(cierre.total_transferencia)}</span>
                    <span>Tar: {formatQ(cierre.total_tarjeta)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Acción solo de reporte (download) */}
            {cierre && estado === "CERRADO" && (
              <div className="flex flex-wrap gap-2 mt-3 text-xs">
                <button
                  type="button"
                  onClick={descargarExcelCierre}
                  className="px-3 py-1.5 rounded-full border border-[#7a2b33] hover:border-[#e3c578] hover:text-[#e3c578] transition-colors"
                >
                  Descargar cierre en Excel
                </button>
              </div>
            )}
          </section>

          {/* HISTORIAL DE CIERRES */}
          <section className="bg-[#3a0d12]/70 border border-[#5a1b22] rounded-2xl p-4 md:p-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">
                  Historial de cierres de caja
                </h2>
                <p className="text-xs text-[#c9b296]">
                  Consulta de cierres por fecha, usuario y sucursal para auditoria
                  interna.
                </p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  const next = !historyOpen;
                  setHistoryOpen(next);
                  if (next && history.length === 0) {
                    await loadHistory();
                  }
                }}
                className="text-xs px-3 py-1.5 rounded-full border border-[#6b232b] hover:border-[#e3c578] hover:text-[#e3c578] transition-colors"
              >
                {historyOpen ? "Ocultar" : "Mostrar"}
              </button>
            </div>

            {historyOpen && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-[#c9b296]">Desde</label>
                    <input
                      type="date"
                      value={historyFrom}
                      onChange={(e) => setHistoryFrom(e.target.value)}
                      className="mt-2 w-full rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 px-3 py-2 text-sm text-[#f8f1e6] outline-none focus:ring-2 focus:ring-[#d6b25f]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#c9b296]">Hasta</label>
                    <input
                      type="date"
                      value={historyTo}
                      onChange={(e) => setHistoryTo(e.target.value)}
                      className="mt-2 w-full rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 px-3 py-2 text-sm text-[#f8f1e6] outline-none focus:ring-2 focus:ring-[#d6b25f]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#c9b296]">Usuario</label>
                    <select
                      value={historyUserId}
                      onChange={(e) => setHistoryUserId(e.target.value)}
                      className="mt-2 w-full rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 px-3 py-2 text-sm text-[#f8f1e6] outline-none focus:ring-2 focus:ring-[#d6b25f]"
                    >
                      <option value="">Todos</option>
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
                      value={historySucursalId}
                      onChange={(e) => setHistorySucursalId(e.target.value)}
                      className="mt-2 w-full rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 px-3 py-2 text-sm text-[#f8f1e6] outline-none focus:ring-2 focus:ring-[#d6b25f]"
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
                </div>

                {loadingHistory && (
                  <p className="text-xs text-[#c9b296]">
                    Cargando historial de cierres...
                  </p>
                )}

                {errorHistory && (
                  <p className="text-xs text-red-300 bg-red-900/40 border border-red-700/60 rounded-lg px-3 py-2">
                    {errorHistory}
                  </p>
                )}

                {!loadingHistory && !errorHistory && filteredHistory.length === 0 && (
                  <p className="text-xs text-[#c9b296]">
                    Aun no hay cierres registrados con esos filtros.
                  </p>
                )}

                {filteredHistory.length > 0 && (
                  <div className="overflow-x-auto">
                    {(() => {
                      const total = filteredHistory.length;
                      const totalPages = Math.max(
                        1,
                        Math.ceil(total / historyPageSize)
                      );
                      const safePage = Math.min(historyPage, totalPages);
                      const startIdx = (safePage - 1) * historyPageSize;
                      const pageItems = filteredHistory.slice(
                        startIdx,
                        startIdx + historyPageSize
                      );

                      return (
                        <>
                          {/* Cards (sm/tablet) */}
                          <div className="md:hidden space-y-3">
                            {pageItems.map((c) => {
                              const estadoRow = c.fecha_fin ? "CERRADO" : "ABIERTO";
                              return (
                                <div
                                  key={c.id}
                                  className="rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 p-3 space-y-2"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="text-[11px] text-[#c9b296]">
                                      {new Date(c.fecha_inicio).toLocaleString("es-GT")}
                                    </div>
                                    {estadoRow === "CERRADO" ? (
                                      <span className="px-2 py-0.5 rounded-full bg-[#c39a4c]/10 text-[#d9ba72] border border-[#c39a4c]/40 text-[11px]">
                                        Cerrado
                                      </span>
                                    ) : (
                                      <span className="px-2 py-0.5 rounded-full bg-[#d6b25f]/10 text-[#e3c578] border border-[#d6b25f]/40 text-[11px]">
                                        Abierto
                                      </span>
                                    )}
                                  </div>

                                  <div className="text-sm font-semibold text-[#f8f1e6]">
                                    {c.usuarios?.nombre || "-"}
                                  </div>
                                  {c.usuarios?.email && (
                                    <div className="text-[11px] text-[#c9b296]">
                                      {c.usuarios.email}
                                    </div>
                                  )}

                                  <div className="text-[11px] text-[#c9b296]">
                                    Sucursal:{" "}
                                    <span className="text-[#f8f1e6]">
                                      {c.sucursales?.nombre || "-"}
                                    </span>
                                  </div>
                                  {c.sucursales?.codigo && (
                                    <div className="text-[11px] text-[#c9b296]">
                                      Codigo: {c.sucursales.codigo}
                                    </div>
                                  )}

                                  <div className="text-[11px] text-[#c9b296]">
                                    Total:{" "}
                                    <span className="text-[#d6b25f] font-semibold">
                                      {formatQ(c.total_general)}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {/* Tabla (md+) */}
                          <div className="hidden md:block overflow-x-auto">
                            <table className="min-w-full text-xs border border-[#5a1b22] rounded-xl overflow-hidden">
                              <thead className="bg-[#3a0d12]/90">
                                <tr>
                                  <th className="px-3 py-2 text-left font-semibold border-b border-[#5a1b22]">
                                    Fecha
                                  </th>
                                  <th className="px-3 py-2 text-left font-semibold border-b border-[#5a1b22]">
                                    Usuario
                                  </th>
                                  <th className="px-3 py-2 text-left font-semibold border-b border-[#5a1b22]">
                                    Sucursal
                                  </th>
                                  <th className="px-3 py-2 text-right font-semibold border-b border-[#5a1b22]">
                                    Total general
                                  </th>
                                  <th className="px-3 py-2 text-center font-semibold border-b border-[#5a1b22]">
                                    Estado
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {pageItems.map((c) => {
                                  const estadoRow = c.fecha_fin ? "CERRADO" : "ABIERTO";
                                  return (
                                    <tr
                                      key={c.id}
                                      className="hover:bg-[#3a0d12]/70 transition-colors"
                                    >
                                      <td className="px-3 py-2 border-b border-[#5a1b22]">
                                        {new Date(c.fecha_inicio).toLocaleString(
                                          "es-GT"
                                        )}
                                      </td>
                                      <td className="px-3 py-2 border-b border-[#5a1b22]">
                                        {c.usuarios?.nombre || "-"}
                                        {c.usuarios?.email && (
                                          <span className="block text-[11px] text-[#c9b296]">
                                            {c.usuarios.email}
                                          </span>
                                        )}
                                      </td>
                                      <td className="px-3 py-2 border-b border-[#5a1b22]">
                                        {c.sucursales?.nombre || "-"}
                                        {c.sucursales?.codigo && (
                                          <span className="block text-[11px] text-[#c9b296]">
                                            Codigo: {c.sucursales.codigo}
                                          </span>
                                        )}
                                      </td>
                                      <td className="px-3 py-2 border-b border-[#5a1b22] text-right">
                                        {formatQ(c.total_general)}
                                      </td>
                                      <td className="px-3 py-2 border-b border-[#5a1b22] text-center">
                                        {estadoRow === "CERRADO" ? (
                                          <span className="px-2 py-0.5 rounded-full bg-[#c39a4c]/10 text-[#d9ba72] border border-[#c39a4c]/40">
                                            Cerrado
                                          </span>
                                        ) : (
                                          <span className="px-2 py-0.5 rounded-full bg-[#d6b25f]/10 text-[#e3c578] border border-[#d6b25f]/40">
                                            Abierto
                                          </span>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>

                          <div className="mt-3 flex items-center justify-between text-xs text-[#c9b296]">
                            <span>
                              Pagina {safePage} de {totalPages}
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setHistoryPage((p) => Math.max(1, p - 1))
                                }
                                disabled={safePage <= 1}
                                className="px-3 py-1 rounded-full border border-[#6b232b] disabled:opacity-40"
                              >
                                Anterior
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setHistoryPage((p) => p + 1)
                                }
                                disabled={safePage >= totalPages}
                                className="px-3 py-1 rounded-full border border-[#6b232b] disabled:opacity-40"
                              >
                                Siguiente
                              </button>
                            </div>
                          </div>
                        </>
                      );
                    })()}

                  </div>
                )}
              </>
            )}
          </section>

          <div className="flex items-center">
            <button
              type="button"
              onClick={() => router.push("/dashboard/reportes/ventas")}
              className="w-full rounded-2xl border border-[#5a1b22] bg-[#3a0d12]/80 px-5 py-3 text-left hover:bg-[#4b141a]/80"
            >
              <div className="text-sm font-semibold text-[#f8f1e6]">
                Reportes de ventas
              </div>
              <div className="text-xs text-[#c9b296]">
                Consulta las ventas por fecha, sucursal y usuario.
              </div>
            </button>
          </div>

          <div className="flex items-center">
            <button
              type="button"
              onClick={() => router.push("/dashboard/reportes/inventario")}
              className="w-full rounded-2xl border border-[#5a1b22] bg-[#3a0d12]/80 px-5 py-3 text-left hover:bg-[#4b141a]/80"
            >
              <div className="text-sm font-semibold text-[#f8f1e6]">
                Reporte de inventario interno
              </div>
              <div className="text-xs text-[#c9b296]">
                Consulta el inventario por periodo y exporta a Excel.
              </div>
            </button>
          </div>

          <div className="flex items-center">
            <button
              type="button"
              onClick={() => router.push("/dashboard/reportes/caja-chica")}
              className="w-full rounded-2xl border border-[#5a1b22] bg-[#3a0d12]/80 px-5 py-3 text-left hover:bg-[#4b141a]/80"
            >
              <div className="text-sm font-semibold text-[#f8f1e6]">
                Reportes de caja chica
              </div>
              <div className="text-xs text-[#c9b296]">
                Dia / Semana / Mes / Ano + Excel de caja chica.
              </div>
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
