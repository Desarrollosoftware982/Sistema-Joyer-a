// frontend/app/caja/resumen/page.tsx  (o donde realmente tengas esta ruta)
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AdminSidebar from "../../_components/AdminSidebar";

const API_URL =
  (process.env.NEXT_PUBLIC_API_URL &&
    process.env.NEXT_PUBLIC_API_URL.trim().replace(/\/$/, "")) ||
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:4000");

type SummaryResponse = {
  ok: boolean;
  message?: string;
  data?: any;
};

function getToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("joyeria_token"); // ✅ tu llave real
}

function fmtQ(n: any) {
  const num = Number(n ?? 0);
  const safe = Number.isFinite(num) ? num : 0;
  return new Intl.NumberFormat("es-GT", {
    style: "currency",
    currency: "GTQ",
    maximumFractionDigits: 2,
  }).format(safe);
}

function fmtInt(n: any) {
  const num = Number(n ?? 0);
  const safe = Number.isFinite(num) ? num : 0;
  return new Intl.NumberFormat("es-GT", { maximumFractionDigits: 0 }).format(safe);
}

function safeText(v: any, fallback = "-") {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
}

function ymdLocal(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function CajaResumenPage() {
  const router = useRouter();

  const [status, setStatus] = useState<"CARGANDO" | "OK" | "ERROR">("CARGANDO");
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<any>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(() => ymdLocal(new Date()));
  const scope = "USER";

  // ✅ Si tu AdminSidebar ya tiene el “paracaídas B”, esto no estorba.
  // Si NO lo tiene, entonces pasa props o aplica el paracaídas B primero.
  const Sidebar = AdminSidebar as unknown as React.ComponentType<any>;

  async function fetchSummary(signal?: AbortSignal, dateStr?: string) {
    const token = getToken();

    if (!token) {
      throw new Error("No hay token (joyeria_token) en localStorage. Inicia sesion.");
    }

    const url = new URL(`${API_URL}/api/sales/summary/today`);
    if (dateStr) url.searchParams.set("date", dateStr);
    if (scope) url.searchParams.set("scope", scope);

    const res = await fetch(url.toString(), {
      method: "GET",
      credentials: "omit", // ? NO cookies
      headers: {
        Authorization: `Bearer ${token}`, // ? BEARER
        // ? NO Content-Type en GET (evita preflight extra)
      },
      signal,
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error("Sesion expirada o sin permisos. Vuelve a iniciar sesion.");
    }

    const json = (await res.json().catch(() => null)) as SummaryResponse | null;
    if (!json || json.ok !== true) {
      throw new Error(json?.message || "No se pudo cargar el resumen.");
    }

    setSummary(json.data ?? null);
    setLastUpdated(new Date());
    setStatus("OK");
    setError(null);
  }

  async function refresh() {
    try {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      await fetchSummary(abortRef.current.signal, selectedDate);
    } catch (e: any) {
      if (String(e?.name) === "AbortError") return;
      setStatus("ERROR");
      setError(e?.message || "Error cargando resumen.");
    }
  }

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setStatus("ERROR");
      setError("No hay token (joyeria_token) en localStorage. Inicia sesion.");
      return;
    }

    const url = new URL(`${API_URL}/api/sales/summary/stream`);
    url.searchParams.set("token", token);
    url.searchParams.set("scope", scope);
    if (selectedDate) url.searchParams.set("date", selectedDate);

    setStatus("CARGANDO");
    setError(null);

    const es = new EventSource(url.toString());
    sseRef.current = es;

    const onSummary = (evt: MessageEvent) => {
      try {
        const payload = JSON.parse(evt.data || "{}");
        if (!payload || payload.ok !== true) {
          setStatus("ERROR");
          setError(payload?.message || "Error en resumen SSE.");
          return;
        }
        setSummary(payload.data ?? null);
        setLastUpdated(new Date());
        setStatus("OK");
        setError(null);
      } catch (err: any) {
        setStatus("ERROR");
        setError(err?.message || "Error procesando resumen SSE.");
      }
    };

    es.addEventListener("summary", onSummary as EventListener);
    es.addEventListener("error", () => {
      setStatus("ERROR");
      setError("Error de conexion SSE. Usa Actualizar para reintentar.");
    });

    return () => {
      es.removeEventListener("summary", onSummary as EventListener);
      es.close();
      sseRef.current = null;
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  const normalized = useMemo(() => {
    const d = summary || {};
    const tot = d.totals || d.totales || {};
    const topP = d?.top?.producto || d.top_producto || d.topProducto || null;
    const topC = d?.top?.categoria || d.top_categoria || d.topCategoria || null;

    return {
      fecha: d.date || d.fecha || null,
      timezone: d.timezone || null,
      scope: d.scope || null,

      ventasCount: tot.num_ventas ?? tot.ventas_count ?? tot.ventasCount ?? 0,
      efectivo: tot.efectivo ?? 0,
      transferencia: tot.transferencia ?? 0,
      tarjeta: tot.tarjeta ?? 0,
      totalGeneral: tot.total_general ?? tot.total ?? 0,

      topProducto: topP
        ? {
            nombre: topP.nombre,
            sku: topP.sku,
            cantidad: topP.qty ?? topP.cantidad ?? topP.unidades ?? 0,
            total: topP.total ?? topP.monto ?? 0,
          }
        : null,

      topCategoria: topC
        ? {
            nombre: topC.categoria ?? topC.nombre ?? "Sin categoría",
            cantidad: topC.qty ?? topC.cantidad ?? topC.unidades ?? 0,
            total: topC.total ?? topC.monto ?? 0,
          }
        : null,

      cutoffApplied: Boolean(d?.range?.cutoff_applied),
    };
  }, [summary]);

  return (
    <div className="min-h-screen bg-[#2b0a0b] text-[#f8f1e6]">
      <div className="flex min-h-screen">
        <Sidebar />

        <main className="flex-1">
          <div className="p-4 md:p-8">
            <div className="max-w-6xl mx-auto">
              <div className="rounded-2xl border border-[#5a1b22] bg-[#3a0d12]/80 p-5 md:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.35em] text-[#d6b25f]/80">
                      Joyeria
                    </div>
                    <h1 className="text-2xl font-semibold tracking-tight mt-1">
                      Resumen (Caja)
                    </h1>
                    <p className="text-sm text-[#c9b296]">
                      Vista por cajero
                    </p>
                  </div>
                  <button
                    onClick={refresh}
                    className="rounded-full border border-[#7a2b33] px-4 py-2 text-sm text-[#f1e4d4] hover:bg-[#4b141a]/80 active:scale-[0.99] transition"
                  >
                    Actualizar
                  </button>
                </div>
              </div>
            {status === "CARGANDO" && (
              <div className="mt-6 rounded-2xl border border-[#5a1b22] bg-[#3a0d12]/80 p-4">
                <p className="text-[#c9b296]">Cargando resumen…</p>
              </div>
            )}

            {status === "ERROR" && (
              <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-4">
                <p className="font-medium">No se pudo cargar el resumen</p>
                <p className="text-sm text-[#f1e4d4]/80 mt-1">{error}</p>

                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => router.push("/login")}
                    className="rounded-full border border-[#7a2b33] px-4 py-2 text-sm text-[#f1e4d4] hover:bg-[#4b141a]/80 transition"
                  >
                    Ir a login
                  </button>
                  <button
                    onClick={refresh}
                    className="rounded-full border border-[#7a2b33] px-4 py-2 text-sm text-[#f1e4d4] hover:bg-[#4b141a]/80 transition"
                  >
                    Reintentar
                  </button>
                </div>
              </div>
            )}

            {status === "OK" && (
              <>
                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[#c9b296]">
                  <span className="rounded-full border border-[#7a2b33] bg-[#3a0d12]/80 px-3 py-1">
                    Fecha: {safeText(normalized.fecha, "HOY")}
                  </span>
                  <label className="rounded-full border border-[#7a2b33] bg-[#3a0d12]/80 px-3 py-1 inline-flex items-center gap-2">
                    <span className="text-[10px] text-[#c9b296]">Filtrar</span>
                    <input
                      type="date"
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                      className="bg-transparent text-xs text-[#f8f1e6] focus:outline-none"
                    />
                  </label>
                  <span className="rounded-full border border-[#7a2b33] bg-[#3a0d12]/80 px-3 py-1">
                    Ventas: {fmtInt(normalized.ventasCount)}
                  </span>
                  <span className="rounded-full border border-[#7a2b33] bg-[#3a0d12]/80 px-3 py-1">
                    Scope: {safeText(normalized.scope, "USER")}
                  </span>
                  <span className="rounded-full border border-[#7a2b33] bg-[#3a0d12]/80 px-3 py-1">
                    Ultima actualizacion:{" "}
                    {lastUpdated ? lastUpdated.toLocaleTimeString("es-GT") : "-"}
                  </span>

                  {normalized.cutoffApplied && (
                    <span className="rounded-full border border-[#d6b25f]/40 bg-[#d6b25f]/10 px-3 py-1 text-[#e3c578]">
                      Corte aplicado (23:50 GT)
                    </span>
                  )}
                </div>

                <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <StatCard label="Total vendido" value={fmtQ(normalized.totalGeneral)} accent />
                  <StatCard label="Ventas" value={fmtInt(normalized.ventasCount)} />
                  <StatCard
                    label="Ultima actualizacion"
                    value={lastUpdated ? lastUpdated.toLocaleTimeString("es-GT") : "-"}
                  />
                </div>

                <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-[#5a1b22] bg-[#3a0d12]/80 p-4">
                    <div className="flex items-center justify-between">
                      <h2 className="font-semibold">Metodos de pago</h2>
                      <span className="text-xs text-[#c9b296]/70">Hoy</span>
                    </div>

                    <div className="mt-3 space-y-2">
                      <Row label="Efectivo" value={fmtQ(normalized.efectivo)} />
                      <Row label="Transferencia" value={fmtQ(normalized.transferencia)} />
                      <Row label="Tarjeta" value={fmtQ(normalized.tarjeta)} />
                      <div className="my-2 h-px bg-[#5a1b22]" />
                      <Row label="Total vendido" value={fmtQ(normalized.totalGeneral)} strong />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[#5a1b22] bg-[#3a0d12]/80 p-4">
                    <div className="flex items-center justify-between">
                      <h2 className="font-semibold">Producto mas vendido</h2>
                      <span className="text-xs text-[#c9b296]/70">Hoy</span>
                    </div>

                    {!normalized.topProducto ? (
                      <p className="mt-3 text-sm text-[#c9b296]">
                        Aun no hay ventas confirmadas para calcular el top.
                      </p>
                    ) : (
                      <div className="mt-3">
                        <p className="text-lg font-semibold">
                          {safeText(normalized.topProducto.nombre)}
                        </p>
                        <p className="text-xs text-[#c9b296]/70 mt-1">
                          SKU: {safeText(normalized.topProducto.sku)}
                        </p>

                        <div className="mt-3 space-y-2">
                          <Row label="Cantidad" value={fmtInt(normalized.topProducto.cantidad)} />
                          <Row label="Total" value={fmtQ(normalized.topProducto.total)} strong />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-[#5a1b22] bg-[#3a0d12]/80 p-4 md:col-span-2">
                    <div className="flex items-center justify-between">
                      <h2 className="font-semibold">Categoria mas vendida</h2>
                      <span className="text-xs text-[#c9b296]/70">Hoy</span>
                    </div>

                    {!normalized.topCategoria ? (
                      <p className="mt-3 text-sm text-[#c9b296]">
                        Aun no hay ventas confirmadas para calcular la categoria top.
                      </p>
                    ) : (
                      <div className="mt-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                        <div>
                          <p className="text-lg font-semibold">
                            {safeText(normalized.topCategoria.nombre)}
                          </p>
                          <p className="text-xs text-[#c9b296]/70 mt-1">
                            Top por cantidad (si lo quieres por monto, se ajusta en SQL).
                          </p>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                          <MiniStat label="Cantidad" value={fmtInt(normalized.topCategoria.cantidad)} />
                          <MiniStat label="Total" value={fmtQ(normalized.topCategoria.total)} />
                          <MiniStat label="Ventas" value={fmtInt(normalized.ventasCount)} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

               
              </>
            )}
          </div>
        </div>
        </main>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-[#c9b296]">{label}</span>
      <span
        className={strong ? "text-sm font-semibold text-[#e3c578]" : "text-sm"}
      >
        {value}
      </span>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#5a1b22] bg-[#3a0d12]/80 px-3 py-2">
      <div className="text-[11px] text-[#c9b296]/80">{label}</div>
      <div className="text-sm font-semibold mt-1 text-[#e3c578]">{value}</div>
    </div>
  );
}
function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[#5a1b22] bg-[#3a0d12]/80 px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.25em] text-[#c9b296]/80">
        {label}
      </div>
      <div
        className={[
          "mt-2 text-xl font-semibold",
          accent ? "text-[#e3c578]" : "text-[#f8f1e6]",
        ].join(" ")}
      >
        {value}
      </div>
    </div>
  );
}

