"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import AdminSidebar from "../../_components/AdminSidebar";

import QuoteTemplate, { type QuoteItem } from "./QuoteTemplate";


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

interface Producto {
  id: string;
  nombre: string;
  sku?: string | null;
  codigo_barras?: string | null;
  precio_venta: number;
}

interface CartItem {
  producto: Producto;
  qty: number;
}

function fmtQ(n: number) {
  return `Q ${Number(n || 0).toLocaleString("es-GT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

async function loadLogoDataURL() {
  const res = await fetch("/logo-xuping-regina.png");
  if (!res.ok) return null;
  const blob = await res.blob();
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

// Espera 2 frames para que el DOM pinte bien antes de capturar
const nextPaint = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );

export default function CotizacionesCajeroPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(12);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [productos, setProductos] = useState<Producto[]>([]);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [clienteNombre, setClienteNombre] = useState("");

  // ✅ Para exportar
  const quoteRef = useRef<HTMLDivElement | null>(null);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [mobileQuoteOpen, setMobileQuoteOpen] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

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
    const controller = new AbortController();

    const load = async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("pageSize", String(pageSize));
        if (query.trim()) params.set("q", query.trim());

        const res = await fetch(`${API_URL}/api/catalog/products?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!res.ok) return;
        const json = await res.json();
        const data = json?.data || {};
        setProductos(data.items || []);
        setTotal(Number(data.total || 0));
      } finally {
        setLoading(false);
      }
    };

    load();
    return () => controller.abort();
  }, [token, page, pageSize, query]);

  const addToCart = (producto: Producto) => {
    setCart((prev) => {
      const idx = prev.findIndex((p) => p.producto.id === producto.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, { producto, qty: 1 }];
    });
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((p) => p.producto.id !== productId));
  };

  const updateQty = (productId: string, qty: number) => {
    setCart((prev) =>
      prev.map((p) =>
        p.producto.id === productId ? { ...p, qty: Math.max(1, qty) } : p
      )
    );
  };

  const totalCotizacion = useMemo(() => {
    return cart.reduce(
      (sum, it) => sum + Number(it.producto.precio_venta || 0) * it.qty,
      0
    );
  }, [cart]);

  const cartCount = useMemo(
    () => cart.reduce((sum, it) => sum + Number(it.qty || 0), 0),
    [cart]
  );

  // ✅ Items para la plantilla
  const quoteItems: QuoteItem[] = useMemo(() => {
    return cart.map((it) => {
      const precio = Number(it.producto.precio_venta || 0);
      const cantidad = Number(it.qty || 0);
      return {
        producto: it.producto.nombre || "Producto",
        cantidad,
        precio,
        total: precio * cantidad,
      };
    });
  }, [cart]);

  const downloadPdf = async () => {
    if (cart.length === 0) {
      alert("Agrega productos a la cotización.");
      return;
    }

    try {
      setGenerating(true);

      // Logo como DataURL (para que html2canvas lo pinte siempre)
      if (!logoDataUrl) {
        const data = await loadLogoDataURL();
        setLogoDataUrl(data);
      }

      // Espera render del template oculto
      await nextPaint();

      if (!quoteRef.current) {
        alert("No se encontró la plantilla para exportar.");
        return;
      }

      // Captura la plantilla (A4 300dpi ya es grande, igual subimos escala para nitidez)
      const canvas = await html2canvas(quoteRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: null,
      });

      const imgData = canvas.toDataURL("image/png");

      // PDF A4
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

      // Tamaño A4 en mm
      const pageW = doc.internal.pageSize.getWidth();  // 210
      const pageH = doc.internal.pageSize.getHeight(); // 297

      doc.addImage(imgData, "PNG", 0, 0, pageW, pageH, undefined, "FAST");

      doc.save(`cotizacion_${Date.now()}.pdf`);
    } catch (e) {
      console.error(e);
      alert("No se pudo generar el PDF. Revisa consola.");
    } finally {
      setGenerating(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#2b0a0b] text-[#f1e4d4]">
        Cargando sesión...
      </div>
    );
  }

  const fecha = new Date().toLocaleDateString("es-GT");
  const vendedor = user?.nombre || "Cajero";
  const cliente = clienteNombre.trim() || "Cliente";

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
        <header className="border-b border-[#5a1b22] bg-[#2b0a0b]/80 backdrop-blur px-4 md:px-8 py-4 sticky top-0 z-10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
            <h1 className="text-xl md:text-2xl font-semibold">Cotizaciones</h1>
            <p className="text-xs md:text-sm text-[#c9b296]">
              Crea cotizaciones sin afectar inventario.
            </p>
            </div>

            <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setMobileQuoteOpen(true)}
              className="md:hidden rounded-full border border-[#6b232b] bg-[#2b0a0b]/60 px-3 py-1.5 text-xs text-[#f1e4d4] hover:bg-[#4b141a]/80"
            >
              Ver cotización{cartCount > 0 ? ` (${cartCount})` : ""}
            </button>
            <button
              type="button"
              onClick={downloadPdf}
              disabled={generating}
              className="rounded-full border border-[#7a2b33] bg-[#2b0a0b]/60 px-3 py-1.5 text-xs text-[#f1e4d4] hover:bg-[#4b141a]/80 disabled:opacity-50"
            >
              {generating ? "Generando..." : "Descargar PDF"}
            </button>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 md:px-8 py-6 grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-6">
          <section className="rounded-2xl border border-[#5a1b22] bg-[#3a0d12]/80 p-5 space-y-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[240px]">
                <label className="block text-xs text-[#c9b296]">
                  Buscar producto
                </label>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setPage(1);
                    setQuery(e.target.value);
                  }}
                  placeholder="Nombre, SKU o codigo de barras"
                  className="mt-2 w-full rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 px-3 py-2 text-sm text-[#f8f1e6] outline-none focus:ring-2 focus:ring-[#d6b25f]"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="rounded-xl border border-[#6b232b] px-3 py-2 text-xs disabled:opacity-40"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="rounded-xl border border-[#6b232b] px-3 py-2 text-xs disabled:opacity-40"
                >
                  Siguiente
                </button>
              </div>
            </div>

            <div className="text-xs text-[#c9b296]">
              Página {page} de {totalPages}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {loading ? (
                <div className="text-xs text-[#c9b296]">Cargando...</div>
              ) : productos.length === 0 ? (
                <div className="text-xs text-[#c9b296]">Sin productos.</div>
              ) : (
                productos.map((p) => (
                  <div
                    key={p.id}
                    className="rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                  >
                    <div>
                      <div className="text-sm font-semibold">{p.nombre}</div>
                      <div className="text-[11px] text-[#c9b296]">
                        {p.sku || p.codigo_barras || "-"}
                      </div>
                      <div className="text-xs text-[#d6b25f] mt-1">
                        {fmtQ(p.precio_venta)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => addToCart(p)}
                      className="self-end sm:self-auto rounded-full border border-[#7a2b33] px-3 py-1.5 text-xs hover:bg-[#4b141a]/80"
                    >
                      Agregar
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="hidden md:block rounded-2xl border border-[#5a1b22] bg-[#3a0d12]/80 p-5 space-y-4">
            <div>
              <p className="text-xs tracking-[0.35em] text-[#c9b296]">JOYERIA</p>
              <h2 className="text-lg font-semibold">Cotización actual</h2>
              <p className="text-xs text-[#c9b296]">
                Agrega artículos y genera el PDF.
              </p>
            </div>

            <div>
              <label className="block text-xs text-[#c9b296]">
                Nombre del cliente
              </label>
              <input
                type="text"
                value={clienteNombre}
                onChange={(e) => setClienteNombre(e.target.value)}
                placeholder="Nombre completo"
                className="mt-2 w-full rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 px-3 py-2 text-sm text-[#f8f1e6] outline-none focus:ring-2 focus:ring-[#d6b25f]"
              />
            </div>

            <div className="space-y-3">
              {cart.length === 0 ? (
                <div className="text-xs text-[#c9b296]">
                  Aún no hay artículos agregados.
                </div>
              ) : (
                cart.map((item) => (
                  <div
                    key={item.producto.id}
                    className="rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">
                          {item.producto.nombre}
                        </div>
                        <div className="text-[11px] text-[#c9b296]">
                          {item.producto.sku ||
                            item.producto.codigo_barras ||
                            "-"}
                        </div>
                        <div className="text-xs text-[#d6b25f] mt-1">
                          {fmtQ(item.producto.precio_venta)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFromCart(item.producto.id)}
                        className="text-xs text-[#e3d2bd] border border-[#6b232b] rounded-full px-3 py-1 hover:text-red-300 hover:border-red-400"
                      >
                        Quitar
                      </button>
                    </div>

                    <div className="mt-3 flex items-center gap-2 text-xs">
                      <span className="text-[#c9b296]">Cantidad</span>
                      <input
                        type="number"
                        min={1}
                        value={item.qty}
                        onChange={(e) =>
                          updateQty(item.producto.id, Number(e.target.value))
                        }
                        className="w-20 rounded-lg border border-[#5a1b22] bg-[#2b0a0b]/60 px-2 py-1 text-sm text-[#f8f1e6] outline-none focus:ring-2 focus:ring-[#d6b25f]"
                      />
                      <span className="ml-auto text-[#f1e4d4]">
                        {fmtQ(item.qty * Number(item.producto.precio_venta || 0))}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 p-3 flex items-center justify-between text-sm">
              <span className="text-[#c9b296]">Total cotización</span>
              <span className="text-[#d6b25f] font-semibold">
                {fmtQ(totalCotizacion)}
              </span>
            </div>
          </section>
        </main>
      </div>

      {mobileQuoteOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex items-end">
          <div
            className="absolute inset-0 bg-[#2b0a0b]/70 backdrop-blur-sm"
            onClick={() => setMobileQuoteOpen(false)}
          >
            <div className="absolute -top-28 -left-20 h-64 w-64 rounded-full bg-[#d6b25f]/10 blur-3xl" />
            <div className="absolute -bottom-28 -right-20 h-64 w-64 rounded-full bg-[#c39a4c]/10 blur-3xl" />
          </div>

          <section className="relative w-full max-h-[85vh] overflow-y-auto rounded-t-3xl border-t border-x border-[#5a1b22] bg-[#3a0d12]/95 p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs tracking-[0.35em] text-[#c9b296]">JOYERIA</p>
                <h2 className="text-lg font-semibold">Cotización actual</h2>
                <p className="text-xs text-[#c9b296]">Agrega artículos y genera el PDF.</p>
              </div>
              <button
                type="button"
                onClick={() => setMobileQuoteOpen(false)}
                className="text-xs text-[#e3d2bd] border border-[#6b232b] rounded-full px-3 py-1 hover:text-red-300 hover:border-red-400"
              >
                Cerrar
              </button>
            </div>

            <div>
              <label className="block text-xs text-[#c9b296]">Nombre del cliente</label>
              <input
                type="text"
                value={clienteNombre}
                onChange={(e) => setClienteNombre(e.target.value)}
                placeholder="Nombre completo"
                className="mt-2 w-full rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 px-3 py-2 text-sm text-[#f8f1e6] outline-none focus:ring-2 focus:ring-[#d6b25f]"
              />
            </div>

            <div className="space-y-3">
              {cart.length === 0 ? (
                <div className="text-xs text-[#c9b296]">Aún no hay artículos agregados.</div>
              ) : (
                cart.map((item) => (
                  <div
                    key={item.producto.id}
                    className="rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">{item.producto.nombre}</div>
                        <div className="text-[11px] text-[#c9b296]">
                          {item.producto.sku || item.producto.codigo_barras || "-"}
                        </div>
                        <div className="text-xs text-[#d6b25f] mt-1">
                          {fmtQ(item.producto.precio_venta)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFromCart(item.producto.id)}
                        className="text-xs text-[#e3d2bd] border border-[#6b232b] rounded-full px-3 py-1 hover:text-red-300 hover:border-red-400"
                      >
                        Quitar
                      </button>
                    </div>

                    <div className="mt-3 flex items-center gap-2 text-xs">
                      <span className="text-[#c9b296]">Cantidad</span>
                      <input
                        type="number"
                        min={1}
                        value={item.qty}
                        onChange={(e) =>
                          updateQty(item.producto.id, Number(e.target.value))
                        }
                        className="w-20 rounded-lg border border-[#5a1b22] bg-[#2b0a0b]/60 px-2 py-1 text-sm text-[#f8f1e6] outline-none focus:ring-2 focus:ring-[#d6b25f]"
                      />
                      <span className="ml-auto text-[#f1e4d4]">
                        {fmtQ(item.qty * Number(item.producto.precio_venta || 0))}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 p-3 flex items-center justify-between text-sm">
              <span className="text-[#c9b296]">Total cotización</span>
              <span className="text-[#d6b25f] font-semibold">{fmtQ(totalCotizacion)}</span>
            </div>
          </section>
        </div>
      )}

      {/* ✅ PLANTILLA OCULTA (se captura para PDF) */}
      <div
        style={{
          position: "fixed",
          left: "-99999px",
          top: 0,
          width: 2480,
          height: 3508,
          pointerEvents: "none",
          opacity: 1,
        }}
      >
        <div ref={quoteRef}>
          <QuoteTemplate
            // ⚠️ Para que salga el logo sí o sí, lo ideal es que QuoteTemplate acepte DataURL.
            // Si tu QuoteTemplate solo usa logoSrc, déjalo así:
            logoSrc="/logo-xuping-regina.png"
            // Si tú decides agregar soporte a logoDataUrl (recomendado), pásalo:
            // logoDataUrl={logoDataUrl || undefined}

            titulo={undefined}
            fecha={fecha}
            vendedor={vendedor}
            cliente={cliente}
            items={quoteItems}
            totalGeneral={totalCotizacion}
          />
        </div>
      </div>
    </div>
  );
}

