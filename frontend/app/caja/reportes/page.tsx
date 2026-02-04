"use client";

import { useMemo, useState } from "react";
import AdminSidebar from "../../_components/AdminSidebar";

const API_URL =
  (process.env.NEXT_PUBLIC_API_URL &&
    process.env.NEXT_PUBLIC_API_URL.trim().replace(/\/$/, "")) ||
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:4000");

type ReportScope = "DIA" | "SEMANA" | "MES" | "ANIO";
type MetodoPago = "TODAS" | "EFECTIVO" | "TRANSFERENCIA" | "TARJETA";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDaysISO(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function buildRange(
  scope: ReportScope,
  opts: {
    dia: string;
    semana_from: string;
    semana_to_inclusive: string;
    mes: string; // YYYY-MM
    anio: string; // YYYY
  }
) {
  if (scope === "DIA") {
    const from = opts.dia;
    const to = addDaysISO(from, 1);
    return { from, to };
  }

  if (scope === "SEMANA") {
    const from = opts.semana_from;
    const to = addDaysISO(opts.semana_to_inclusive, 1);
    return { from, to };
  }

  if (scope === "MES") {
    const [y, m] = opts.mes.split("-").map(Number);
    const from = `${y}-${pad2(m)}-01`;
    const d = new Date(`${from}T00:00:00`);
    d.setMonth(d.getMonth() + 1);
    const to = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`;
    return { from, to };
  }

  const y = Number(opts.anio);
  const from = `${y}-01-01`;
  const to = `${y + 1}-01-01`;
  return { from, to };
}

export default function ReporteVentasPage() {
  const [scope, setScope] = useState<ReportScope>("DIA");
  const [metodo, setMetodo] = useState<MetodoPago>("TODAS");

  const [dia, setDia] = useState(todayISO());
  const [semanaFrom, setSemanaFrom] = useState(todayISO());
  const [semanaTo, setSemanaTo] = useState(todayISO());

  const [mes, setMes] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  });

  const [anio, setAnio] = useState(() => String(new Date().getFullYear()));

  const range = useMemo(() => {
    return buildRange(scope, {
      dia,
      semana_from: semanaFrom,
      semana_to_inclusive: semanaTo,
      mes,
      anio,
    });
  }, [scope, dia, semanaFrom, semanaTo, mes, anio]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("from", range.from);
    params.set("to", range.to);
    if (metodo !== "TODAS") params.set("metodo", metodo);
    return params.toString();
  }, [range.from, range.to, metodo]);

  async function descargarExcel() {
    // CORREGIDO: /api/reportes/ventas/export
    const url = `${API_URL}/api/reportes/ventas/export?${queryString}`;
    const res = await fetch(url, { method: "GET", credentials: "include" });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      alert(`No se pudo generar el Excel. ${txt || ""}`.trim());
      return;
    }

    const blob = await res.blob();
    const downloadUrl = window.URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = downloadUrl;

    const fileName = `reporte-ventas_${scope}_${range.from}_a_${addDaysISO(range.to, -1)}_${metodo}.xlsx`;
    a.download = fileName;

    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(downloadUrl);
  }

  return (
    <div className="min-h-screen bg-[#2b0a0b] text-[#f8f1e6]">
      <div className="flex">
        <AdminSidebar />

        <main className="flex-1 p-4 md:p-8">
          <div className="max-w-6xl mx-auto">
            <div className="rounded-2xl border border-[#5a1b22] bg-[#3a0d12]/80 p-5 md:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs tracking-[0.35em] text-[#c9b296]">JOYERIA</p>
                  <h1 className="text-2xl font-semibold">Reporte de ventas</h1>
                  <p className="text-sm text-[#c9b296]">
                    Dia / Semana / Mes / Ano + filtro por metodo + Excel con detalle de productos.
                  </p>
                </div>

                <button
                  onClick={descargarExcel}
                  className="rounded-full border border-[#7a2b33] bg-[#2b0a0b]/60 px-4 py-2 text-sm text-[#f1e4d4] hover:bg-[#4b141a]/80"
                >
                  Descargar Excel
                </button>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <section className="space-y-4">
                <div className="rounded-2xl border border-[#5a1b22] bg-[#3a0d12]/80 p-4">
                  <p className="mb-2 text-xs text-[#c9b296]">Secciones</p>

                  {([
                    { k: "DIA", label: "Reportes del dia" },
                    { k: "SEMANA", label: "Reportes de la semana" },
                    { k: "MES", label: "Reportes mensuales" },
                    { k: "ANIO", label: "Reportes anuales" },
                  ] as const).map((x) => (
                    <button
                      key={x.k}
                      onClick={() => setScope(x.k)}
                      className={[
                        "mb-2 w-full rounded-xl px-3 py-2 text-left text-sm",
                        "border border-[#5a1b22]",
                        scope === x.k
                          ? "bg-[#4b141a]/80 text-[#f8f1e6]"
                          : "bg-[#2b0a0b]/40 hover:bg-[#4b141a]/60 text-[#f1e4d4]",
                      ].join(" ")}
                    >
                      {x.label}
                    </button>
                  ))}
                </div>

                <div className="rounded-2xl border border-[#5a1b22] bg-[#3a0d12]/80 p-4">
                  <label className="block text-xs text-[#c9b296]">Metodo de pago</label>
                  <select
                    value={metodo}
                    onChange={(e) => setMetodo(e.target.value as MetodoPago)}
                    className="mt-2 w-full rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 px-3 py-2 text-sm text-[#f8f1e6] outline-none focus:ring-2 focus:ring-[#d6b25f]"
                  >
                    <option value="TODAS">Todas</option>
                    <option value="EFECTIVO">Efectivo</option>
                    <option value="TRANSFERENCIA">Transferencia</option>
                    <option value="TARJETA">Tarjeta</option>
                  </select>

                  <div className="mt-3 text-xs text-[#c9b296]">
                    <div>Rango aplicado:</div>
                    <div className="font-mono">
                      {range.from} - {addDaysISO(range.to, -1)} (incl.)
                    </div>
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <div className="rounded-2xl border border-[#5a1b22] bg-[#3a0d12]/80 p-4">
                  <p className="text-sm font-medium">Filtros</p>

                  {scope === "DIA" && (
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div>
                        <label className="block text-xs text-[#c9b296]">Fecha</label>
                        <input
                          type="date"
                          value={dia}
                          onChange={(e) => setDia(e.target.value)}
                          className="mt-2 w-full rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 px-3 py-2 text-sm text-[#f8f1e6] outline-none focus:ring-2 focus:ring-[#d6b25f]"
                        />
                      </div>
                    </div>
                  )}

                  {scope === "SEMANA" && (
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div>
                        <label className="block text-xs text-[#c9b296]">Desde</label>
                        <input
                          type="date"
                          value={semanaFrom}
                          onChange={(e) => setSemanaFrom(e.target.value)}
                          className="mt-2 w-full rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 px-3 py-2 text-sm text-[#f8f1e6] outline-none focus:ring-2 focus:ring-[#d6b25f]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[#c9b296]">Hasta (incluye ese dia)</label>
                        <input
                          type="date"
                          value={semanaTo}
                          onChange={(e) => setSemanaTo(e.target.value)}
                          className="mt-2 w-full rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 px-3 py-2 text-sm text-[#f8f1e6] outline-none focus:ring-2 focus:ring-[#d6b25f]"
                        />
                      </div>
                    </div>
                  )}

                  {scope === "MES" && (
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div>
                        <label className="block text-xs text-[#c9b296]">Mes</label>
                        <input
                          type="month"
                          value={mes}
                          onChange={(e) => setMes(e.target.value)}
                          className="mt-2 w-full rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 px-3 py-2 text-sm text-[#f8f1e6] outline-none focus:ring-2 focus:ring-[#d6b25f]"
                        />
                      </div>
                    </div>
                  )}

                  {scope === "ANIO" && (
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div>
                        <label className="block text-xs text-[#c9b296]">Ano</label>
                        <input
                          type="number"
                          value={anio}
                          onChange={(e) => setAnio(e.target.value)}
                          className="mt-2 w-full rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 px-3 py-2 text-sm text-[#f8f1e6] outline-none focus:ring-2 focus:ring-[#d6b25f]"
                          min={2000}
                          max={2100}
                        />
                      </div>
                    </div>
                  )}

                  <div className="mt-4 rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 p-3 text-xs text-[#c9b296]">
                    El Excel se genera con el rango y metodo seleccionados.
                  </div>
                </div>

                <div className="rounded-2xl border border-[#5a1b22] bg-[#3a0d12]/80 p-4">
                  <p className="text-sm text-[#c9b296]">
                    El Excel trae: ventas + detalle de productos + resumen con totales y verificacion ("cuadrado").
                  </p>
                </div>
              </section>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

