"use client";

import React, { useEffect, useState } from "react";
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

interface CashSummary {
  sucursalId: string;
  rango: {
    from: string;
    to: string;
  };
  totales: {
    efectivo: number;
    transferencia: number;
    tarjeta: number;
    general: number;
  };
}

function formatDateYmd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getDayRangeISO(dateYmd: string) {
  const from = new Date(`${dateYmd}T00:00:00`);
  const to = new Date(`${dateYmd}T23:59:59.999`);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

export default function PosCashPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const [selectedDate, setSelectedDate] = useState<string>(
    formatDateYmd(new Date())
  );
  const [summary, setSummary] = useState<CashSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // ====== Cargar sesión ======
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

  // ====== Cargar resumen de caja ======
  const fetchSummary = async (dateYmd: string, jwt: string) => {
    try {
      setLoading(true);
      setError(null);
      setSuccess(null);

      const { from, to } = getDayRangeISO(dateYmd);

      const params = new URLSearchParams();
      params.set("from", from);
      params.set("to", to);

      const res = await fetch(
        buildApiUrl(`/api/cash/summary?${params.toString()}`),
        {
          headers: {
            Authorization: `Bearer ${jwt}`,
          },
        }
      );

      // ✅ leer body UNA sola vez
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "No se pudo obtener el resumen.");
      }

      const data = (json?.data || null) as CashSummary | null;
      setSummary(data);
    } catch (err: any) {
      console.error(err);
      setSummary(null);
      setError(err.message || "Error cargando resumen de caja.");
    } finally {
      setLoading(false);
    }
  };

  // Cargar resumen cuando cambie el token o la fecha
  useEffect(() => {
    if (!token) return;
    fetchSummary(selectedDate, token);
  }, [token, selectedDate]);

  const handleLogout = () => {
    localStorage.removeItem("joyeria_token");
    localStorage.removeItem("joyeria_user");
    router.push("/login");
  };

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedDate(e.target.value);
  };

  const handleCloseCash = async () => {
    if (!token || !summary) return;

    if (
      summary.totales.general <= 0 &&
      !window.confirm(
        "El total general es 0. ¿Seguro que quieres registrar el cierre igualmente?"
      )
    ) {
      return;
    }

    try {
      setClosing(true);
      setError(null);
      setSuccess(null);

      const { from, to } = getDayRangeISO(selectedDate);

      const res = await fetch(buildApiUrl("/api/cash/close"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          from,
          to,
          // sucursalId: opcional, el backend toma la SP si no se envía
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.message || "No se pudo registrar el cierre.");
      }

      setSuccess("Cierre de caja registrado correctamente.");
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Error registrando cierre de caja.");
    } finally {
      setClosing(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#2b0a0b] text-[#f1e4d4]">
        Cargando sesión...
      </div>
    );
  }

  const todayLabel = new Date(selectedDate + "T00:00:00").toLocaleDateString(
    "es-GT",
    {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }
  );

  const efectivo = summary?.totales.efectivo || 0;
  const transferencia = summary?.totales.transferencia || 0;
  const tarjeta = summary?.totales.tarjeta || 0;
  const general = summary?.totales.general || 0;

  // ✅ Rol normalizado
  const rolNorm = String(user.rol ?? "").trim().toUpperCase();
  const isCajero = rolNorm === "CAJERO";

  return (
    <div className="min-h-screen bg-[#2b0a0b] text-[#f8f1e6] flex">
      <AdminSidebar user={user} onLogout={handleLogout} />

      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="border-b border-[#5a1b22] bg-[#2b0a0b]/80 backdrop-blur flex items-center justify-between px-4 md:px-8 py-4 sticky top-0 z-10">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold">
              POS — Cierre de caja
            </h1>
            <p className="text-xs md:text-sm text-[#c9b296]">
              Selecciona un día para ver el resumen de pagos y registrar el
              cierre de caja.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <label className="text-xs md:text-sm text-[#c9b296] flex flex-col items-end gap-1">
              <span className="uppercase tracking-wide text-[10px] md:text-[11px]">
                Día del cierre
              </span>
              <input
                type="date"
                value={selectedDate}
                onChange={handleDateChange}
                className="bg-[#3a0d12] border border-[#6b232b] rounded-lg px-2 py-1 text-xs md:text-sm text-[#f8f1e6] focus:outline-none focus:ring-1 focus:ring-[#d6b25f]"
              />
            </label>
          </div>
        </header>

        {/* Contenido */}
        <main className="flex-1 px-4 md:px-8 py-6 space-y-6">
          <section className="bg-[#3a0d12]/80 border border-[#5a1b22] rounded-2xl p-4 md:p-6 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <h2 className="text-sm md:text-base font-semibold">
                  Resumen de caja
                </h2>
                <p className="text-xs text-[#c9b296] capitalize">
                  {todayLabel}
                </p>
              </div>

              <div className="flex items-center gap-3">
                {loading && (
                  <span className="text-[11px] text-[#c9b296]">
                    Cargando resumen...
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => token && fetchSummary(selectedDate, token)}
                  disabled={loading}
                  className="px-3 py-1.5 rounded-full border border-[#6b232b] text-[11px] md:text-xs text-[#f1e4d4] hover:border-[#d6b25f] hover:text-[#d6b25f] transition-colors disabled:opacity-60"
                >
                  Actualizar
                </button>

                {/* ✅ SOLO CAJERO ve este botón */}
                {isCajero && (
                  <button
                    type="button"
                    onClick={handleCloseCash}
                    disabled={closing || !summary}
                    className="px-4 py-1.5 rounded-full bg-[#d6b25f] hover:bg-[#e3c578] text-[11px] md:text-xs font-semibold text-[#2b0a0b] disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {closing ? "Registrando..." : "Registrar cierre de caja"}
                  </button>
                )}
              </div>
            </div>

            {error && (
              <div className="text-xs text-red-200 bg-red-900/40 border border-red-700/60 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            {success && (
              <div className="text-xs text-[#f0d99a] bg-[#d6b25f]/10 border border-[#b98c3f]/60 rounded-lg px-3 py-2">
                {success}
              </div>
            )}

            {!summary && !loading && !error && (
              <p className="text-xs text-[#b39878]">
                No hay información de ventas para este día o aún no se han
                cargado datos.
              </p>
            )}

            {summary && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-2">
                <div className="rounded-2xl border border-[#5a1b22] bg-[#2b0a0b]/60 px-4 py-3">
                  <p className="text-[11px] text-[#c9b296]">Total en efectivo</p>
                  <p className="text-lg font-semibold">
                    Q{" "}
                    {efectivo.toLocaleString("es-GT", {
                      minimumFractionDigits: 2,
                    })}
                  </p>
                </div>

                <div className="rounded-2xl border border-[#5a1b22] bg-[#2b0a0b]/60 px-4 py-3">
                  <p className="text-[11px] text-[#c9b296]">
                    Total en transferencia
                  </p>
                  <p className="text-lg font-semibold">
                    Q{" "}
                    {transferencia.toLocaleString("es-GT", {
                      minimumFractionDigits: 2,
                    })}
                  </p>
                </div>

                <div className="rounded-2xl border border-[#5a1b22] bg-[#2b0a0b]/60 px-4 py-3">
                  <p className="text-[11px] text-[#c9b296]">Total en tarjeta</p>
                  <p className="text-lg font-semibold">
                    Q{" "}
                    {tarjeta.toLocaleString("es-GT", {
                      minimumFractionDigits: 2,
                    })}
                  </p>
                </div>

                <div className="rounded-2xl border border-[#b98c3f]/70 bg-[#2b0a0b]/40 px-4 py-3">
                  <p className="text-[11px] text-[#e3c578]">
                    Total general del día
                  </p>
                  <p className="text-lg font-semibold text-[#d6b25f]">
                    Q{" "}
                    {general.toLocaleString("es-GT", {
                      minimumFractionDigits: 2,
                    })}
                  </p>
                </div>
              </div>
            )}
          </section>

          {/* Aquí más adelante podemos agregar un listado de ventas del día */}
        </main>
      </div>
    </div>
  );
}
