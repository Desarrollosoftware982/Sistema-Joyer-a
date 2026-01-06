"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminSidebar from "../../_components/AdminSidebar";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

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
  const [loadingCierre, setLoadingCierre] = useState(false);
  const [errorCierre, setErrorCierre] = useState<string | null>(null);

  // Historial
  const [history, setHistory] = useState<CashClosureHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [errorHistory, setErrorHistory] = useState<string | null>(null);

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
    if (!cierre) return "SIN_APERTURA";
    if (!cierre.fecha_fin) return "ABIERTO";
    return "CERRADO";
  };

  // ========= CARGAR CIERRE DEL DÍA =========
  useEffect(() => {
    if (!token) return;

    const load = async () => {
      try {
        setLoadingCierre(true);
        setErrorCierre(null);

        // Backend: GET /api/cash-register/today
        const res = await fetch(`${API_URL}/api/cash-register/today`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

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

        setCierre(cierreActual);
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
  useEffect(() => {
    if (!token) return;

    const loadHistory = async () => {
      try {
        setLoadingHistory(true);
        setErrorHistory(null);

        // Backend esperado: GET /api/cash-register/history
        const res = await fetch(`${API_URL}/api/cash-register/history`, {
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

    loadHistory();
  }, [token]);

  // ========= DESCARGAR EXCEL DEL CIERRE (SOLO LECTURA) =========
  const descargarExcelCierre = () => {
    if (!token || !cierre) return;
    // Suponiendo backend: GET /api/cash-register/:id/excel
    window.open(
      `${API_URL}/api/cash-register/${cierre.id}/excel?token=${token}`,
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
                  Resumen del estado de la caja del día actual para control
                  interno.
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
                    Caja abierta
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
                  Consulta de cierres por fecha y usuario para auditoría
                  interna.
                </p>
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

            {!loadingHistory && !errorHistory && history.length === 0 && (
              <p className="text-xs text-[#c9b296]">
                Aún no hay cierres registrados.
              </p>
            )}

            {history.length > 0 && (
              <div className="overflow-x-auto">
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
                    {history.map((c) => {
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
                            {c.usuarios?.nombre || "—"}
                            {c.usuarios?.email && (
                              <span className="block text-[11px] text-[#c9b296]">
                                {c.usuarios.email}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 border-b border-[#5a1b22]">
                            {c.sucursales?.nombre || "—"}
                            {c.sucursales?.codigo && (
                              <span className="block text-[11px] text-[#c9b296]">
                                Código: {c.sucursales.codigo}
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
            )}
          </section>

          {/* Placeholder para futuros reportes */}
          <section className="bg-[#3a0d12]/60 border border-[#5a1b22] rounded-2xl p-4 md:p-5">
            <h2 className="text-sm font-semibold mb-2">
              Próximos reportes
            </h2>
            <p className="text-xs text-[#c9b296]">
              Aquí más adelante agregaremos:
            </p>
            <ul className="text-xs text-[#e3d2bd] list-disc ml-5 mt-1 space-y-1">
              <li>Ventas del día por cajero.</li>
              <li>Ventas del mes y del año.</li>
              <li>
                Reporte interno de inventario (costo, desaduanaje, etc.).
              </li>
            </ul>
          </section>
        </main>
      </div>
    </div>
  );
}
