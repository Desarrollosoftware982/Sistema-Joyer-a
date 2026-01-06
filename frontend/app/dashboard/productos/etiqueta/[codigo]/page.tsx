"use client";

import { useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import JsBarcode from "jsbarcode";

export default function EtiquetaProductoPage() {
  const router = useRouter();
  const params = useParams() as { codigo?: string };
  const rawCodigo = params.codigo ?? "";
  const codigo = decodeURIComponent(rawCodigo);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Generar el código de barras en el <svg>
  useEffect(() => {
    if (!codigo || !svgRef.current) return;

    try {
      JsBarcode(svgRef.current, codigo, {
        format: "CODE128",
        displayValue: true,
        fontSize: 14,
        width: 2,
        height: 60,
        margin: 0,
      });
    } catch (err) {
      console.error("Error generando código de barras", err);
    }
  }, [codigo]);

  // Lanzar impresión automática al abrir
  useEffect(() => {
    if (!codigo) return;
    const t = setTimeout(() => {
      if (typeof window !== "undefined") {
        window.print();
      }
    }, 800);
    return () => clearTimeout(t);
  }, [codigo]);

  const handlePrint = () => {
    if (typeof window !== "undefined") {
      window.print();
    }
  };

  if (!codigo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#2b0a0b] text-[#f8f1e6]">
        <div className="text-center space-y-3">
          <p className="text-sm">No se recibió ningún código de barras.</p>
          <button
            onClick={() => router.push("/dashboard/productos")}
            className="px-4 py-2 rounded-lg bg-[#d6b25f] text-[#2b0a0b] text-sm font-semibold"
          >
            Volver a productos
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#3a0d12] flex items-center justify-center print:bg-white">
      <div className="flex flex-col items-center gap-6">
        {/* Tarjeta / etiqueta (pensada para recortar en una hoja A4) */}
        <div className="bg-white text-slate-900 rounded-xl shadow-xl px-6 py-4 w-[80mm] h-[40mm] flex flex-col justify-between print:shadow-none print:border print:border-slate-300">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="font-semibold tracking-wide">Joyería</span>
            <span className="font-mono text-[10px]">{codigo}</span>
          </div>

          <div className="flex-1 flex items-center justify-center">
            <svg ref={svgRef} className="w-full h-[60px]" />
          </div>

          <div className="text-[10px] text-right pt-1">
            {/* Dejas espacio para escribir el precio a mano, si quieres */}
            <span>Precio: ______</span>
          </div>
        </div>

        {/* Controles que no se imprimen */}
        <div className="flex gap-3 text-xs text-[#f8f1e6] print:hidden">
          <button
            onClick={handlePrint}
            className="px-4 py-2 rounded-lg bg-[#d6b25f] text-[#2b0a0b] font-semibold"
          >
            Imprimir etiqueta
          </button>
          <button
            onClick={() => router.push("/dashboard/productos")}
            className="px-4 py-2 rounded-lg border border-slate-500 text-[#f1e4d4]"
          >
            Volver a productos
          </button>
        </div>

        <p className="text-[11px] text-[#c9b296] print:hidden">
          La etiqueta está centrada en la hoja (A4). Imprime, recorta y pégala
          en la pieza de joyería.
        </p>
      </div>
    </div>
  );
}
