// frontend/app/dashboard/caja/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AdminSidebar from "../_components/AdminSidebar";

// ✅ IMPORTANTE (Render / 1 solo service):
// - En producción NO uses localhost:4000
// - Usamos same-origin: window.location.origin o un NEXT_PUBLIC_API_URL si lo defines
const API_URL =
  (process.env.NEXT_PUBLIC_API_URL &&
    process.env.NEXT_PUBLIC_API_URL.trim().replace(/\/$/, "")) ||
  (typeof window !== "undefined" ? window.location.origin : "");

interface User {
  id: string;
  nombre: string;
  email: string;
  rol: string;
}

interface ProductoPublico {
  id: string;
  sku: string;
  nombre: string;
  precio_venta: number;
  codigo_barras: string | null;
  categoria?: string | null;
  disponible?: boolean;
}

type MetodoPago = "EFECTIVO" | "TARJETA" | "TRANSFERENCIA";

type CajaEstado = "CARGANDO" | "SIN_APERTURA" | "ABIERTA" | "CERRADA";

interface CierreCaja {
  id: string;
  sucursal_id: string;
  usuario_id: string;
  fecha_inicio: string;
  fecha_fin: string | null;

  // Nuevos campos
  monto_apertura?: number | null;
  monto_cierre_reportado?: number | null;
  diferencia?: number | null;

  // Totales
  total_efectivo: number;
  total_transferencia: number;
  total_tarjeta: number;
  total_general: number;
}

type ScanUiMode = "idle" | "ok" | "error";

export default function CajaPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  // Caja (apertura)
  const [cajaEstado, setCajaEstado] = useState<CajaEstado>("CARGANDO");
  const [cierreActual, setCierreActual] = useState<CierreCaja | null>(null);
  const [montoApertura, setMontoApertura] = useState<string>("");

  // ✅ cierre de caja (opcional)
  const [showCerrarCaja, setShowCerrarCaja] = useState(false);
  const [montoCierreReportado, setMontoCierreReportado] = useState<string>("");

  const [search, setSearch] = useState("");
  const [barcodeInput, setBarcodeInput] = useState("");

  const [loading, setLoading] = useState(false);
  const [loadingCaja, setLoadingCaja] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [productos, setProductos] = useState<ProductoPublico[]>([]);

  const [cart, setCart] = useState<
    Array<{
      producto_id: string;
      nombre: string;
      sku: string;
      codigo_barras: string | null;
      precio_unitario: number;
      qty: number;
    }>
  >([]);

  const [metodoPago, setMetodoPago] = useState<MetodoPago>("EFECTIVO");
  const [efectivoRecibido, setEfectivoRecibido] = useState<string>("");

  // ==========================
  // ✅ Carrito móvil (botón flotante + drawer)
  // ==========================
  const [showCartMobile, setShowCartMobile] = useState(false);

  const cartCount = useMemo(
    () => cart.reduce((acc, it) => acc + (Number(it.qty) || 0), 0),
    [cart]
  );

  // ✅ evita scroll del fondo cuando el drawer está abierto
  useEffect(() => {
    if (!showCartMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [showCartMobile]);

  const today = new Date().toLocaleDateString("es-GT", {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const fmtQ = (n: any) => `Q ${Number(n || 0).toFixed(2)}`;

  const estadoBadge = (estado: CajaEstado) => {
    const base =
      "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold";
    if (estado === "ABIERTA")
      return `${base} border-emerald-400/30 bg-emerald-400/10 text-emerald-100`;
    if (estado === "CERRADA")
      return `${base} border-amber-400/30 bg-amber-400/10 text-amber-100`;
    if (estado === "SIN_APERTURA")
      return `${base} border-[#7a2b33] bg-[#3a0d12]/50 text-[#f1e4d4]`;
    return `${base} border-[#7a2b33] bg-[#3a0d12]/50 text-[#c9b296]`;
  };

  // ==========================
  // ✅ ref + focus para escaneo
  // ==========================
  const barcodeRef = useRef<HTMLInputElement | null>(null);

  const focusBarcode = () => {
    try {
      barcodeRef.current?.focus();
      barcodeRef.current?.select?.();
    } catch {}
  };

  // ==========================
  // ✅ UI Pro: estado del escaneo (solo visual)
  // ==========================
  const [scanUi, setScanUi] = useState<{ mode: ScanUiMode; text: string }>({
    mode: "idle",
    text: "Listo para escanear",
  });
  const scanUiTimerRef = useRef<any>(null);

  const flashScanUi = (mode: ScanUiMode, text: string, ms = 900) => {
    try {
      if (scanUiTimerRef.current) clearTimeout(scanUiTimerRef.current);
    } catch {}
    setScanUi({ mode, text });
    scanUiTimerRef.current = setTimeout(() => {
      setScanUi({ mode: "idle", text: "Listo para escanear" });
      scanUiTimerRef.current = null;
    }, ms);
  };

  useEffect(() => {
    return () => {
      try {
        if (scanUiTimerRef.current) clearTimeout(scanUiTimerRef.current);
      } catch {}
      scanUiTimerRef.current = null;
    };
  }, []);

  const scanTone =
    scanUi.mode === "ok"
      ? {
          ring: "focus:ring-emerald-300",
          border: "border-emerald-400/50",
          icon: "text-emerald-200",
          pill: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
        }
      : scanUi.mode === "error"
      ? {
          ring: "focus:ring-red-300",
          border: "border-red-400/40",
          icon: "text-red-200",
          pill: "border-red-400/30 bg-red-400/10 text-red-200",
        }
      : {
          ring: "focus:ring-[#d6b25f]",
          border: "border-[#6b232b]",
          icon: "text-[#c9b296]",
          pill: "border-[#7a2b33] bg-[#2b0a0b]/40 text-[#c9b296]",
        };

  // ==========================
  // 1) Sesión + rol
  // ==========================
  useEffect(() => {
    const t = localStorage.getItem("joyeria_token");
    const uStr = localStorage.getItem("joyeria_user");

    if (!t || !uStr) {
      router.push("/login");
      return;
    }

    try {
      const u: User = JSON.parse(uStr);

      // ✅ Solo ADMIN o CAJERO
      if (u.rol !== "ADMIN" && u.rol !== "CAJERO") {
        router.push("/login");
        return;
      }

      setUser(u);
      setToken(t);
    } catch {
      router.push("/login");
    }
  }, [router]);

  // ==========================
  // 2) Estado de caja del día
  // ==========================
  const verificarCajaHoy = async () => {
    if (!token) return;

    try {
      setLoadingCaja(true);
      setError(null);

      const res = await fetch(`${API_URL}/api/cash-register/today`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json();
      if (!res.ok)
        throw new Error(data?.message || "Error verificando caja del día");

      const estado = (data?.data?.estado || "SIN_APERTURA") as CajaEstado;
      const cierre = (data?.data?.cierreActual || null) as CierreCaja | null;

      setCajaEstado(estado);
      setCierreActual(cierre);

      // Si está abierta y en BD hay monto_apertura, lo dejamos como referencia visual
      if (estado === "ABIERTA" && cierre?.monto_apertura != null) {
        setMontoApertura(String(Number(cierre.monto_apertura || 0).toFixed(2)));
      }
    } catch (e: any) {
      console.error(e);
      setCajaEstado("SIN_APERTURA");
      setCierreActual(null);
      setError(e?.message ?? "Error verificando caja del día");
    } finally {
      setLoadingCaja(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    verificarCajaHoy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ==========================
  // 3) Abrir caja (monto_apertura)
  // ==========================
  const aperturarCaja = async () => {
    if (!token) return;

    // Normaliza: "1,000.50" -> "1000.50"
    const raw = String(montoApertura ?? "").trim().replaceAll(",", "");
    const n = raw === "" ? 0 : Number(raw);

    if (!Number.isFinite(n) || n < 0) {
      setError("Monto de apertura inválido (debe ser un número ≥ 0).");
      return;
    }

    try {
      setLoadingCaja(true);
      setError(null);

      const res = await fetch(`${API_URL}/api/cash-register/open`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ monto_apertura: Number(n.toFixed(2)) }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Error al aperturar caja");

      const cierre = (data?.data?.cierre || null) as CierreCaja | null;

      setCierreActual(cierre);
      setMontoApertura(String(Number(cierre?.monto_apertura ?? n).toFixed(2)));

      await verificarCajaHoy();
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? "Error al aperturar caja");
    } finally {
      setLoadingCaja(false);
    }
  };

  // ==========================
  // ✅ Cerrar caja (monto_cierre_reportado opcional)
  // ==========================
  const cerrarCaja = async () => {
    if (!token) return;

    if (cajaEstado !== "ABIERTA") {
      setError("La caja no está abierta.");
      return;
    }

    // Evita cerrar con carrito con cosas (cierre limpio)
    if (cart.length > 0) {
      setError(
        "Tienes productos en el carrito. Confirma o vacía antes de cerrar caja."
      );
      return;
    }

    // Confirmación simple
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        "¿Cerrar caja ahora? Asegúrate de no tener ventas pendientes."
      );
      if (!ok) return;
    }

    let payload: any = {};

    const raw = String(montoCierreReportado ?? "").trim().replaceAll(",", "");
    if (raw !== "") {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        setError("Efectivo contado inválido (debe ser un número ≥ 0 o vacío).");
        return;
      }
      payload.monto_cierre_reportado = Number(n.toFixed(2));
    }

    try {
      setLoadingCaja(true);
      setError(null);

      const res = await fetch(`${API_URL}/api/cash-register/close`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Error al cerrar caja");

      const cierre = (data?.data?.cierre || null) as CierreCaja | null;
      setCierreActual(cierre);

      // Limpia UI de cierre
      setMontoCierreReportado("");
      setShowCerrarCaja(false);

      // Refresca estado real
      await verificarCajaHoy();
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? "Error al cerrar caja");
    } finally {
      setLoadingCaja(false);
    }
  };

  // ==========================
  // 4) Cargar inventario público (solo cuando ABIERTA)
  // ==========================
  const cargarPublico = async () => {
    if (!token) return;
    try {
      setLoading(true);
      setError(null);

      const res = await fetch(`${API_URL}/api/inventory/stock?vista=publico`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Error al cargar inventario público");

      const data = await res.json();
      const items = (data.productos || data.existencias || []) as any[];

      const normalized: ProductoPublico[] = items.map((r) => ({
        id: String(r.id || r.producto_id),
        sku: String(r.sku ?? ""),
        nombre: String(r.nombre ?? ""),
        codigo_barras: r.codigo_barras ?? null,
        precio_venta: Number(r.precio_venta ?? 0),
        categoria: r.categoria ?? null,
        disponible: typeof r.disponible === "boolean" ? r.disponible : true,
      }));

      setProductos(normalized);
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? "Error al cargar inventario público");
      setProductos([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    if (cajaEstado !== "ABIERTA") return;

    cargarPublico();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, cajaEstado]);

  // ==========================
  // 5) Filtros / búsqueda
  // ==========================
  const q = search.trim().toLowerCase();

  const productosFiltrados = useMemo(() => {
    return (productos || []).filter((p) => {
      if (p.disponible === false) return false;
      if (!q) return true;
      return (
        (p.nombre ?? "").toLowerCase().includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q) ||
        (p.codigo_barras ?? "").toLowerCase().includes(q) ||
        (p.categoria ?? "").toLowerCase().includes(q)
      );
    });
  }, [productos, q]);

  // ==========================
  // 6) Carrito
  // ==========================
  const total = useMemo(() => {
    return cart.reduce((acc, it) => acc + it.qty * it.precio_unitario, 0);
  }, [cart]);

  const cambio = useMemo(() => {
    if (metodoPago !== "EFECTIVO") return 0;
    const rec = Number(efectivoRecibido || 0);
    return Math.max(0, rec - total);
  }, [metodoPago, efectivoRecibido, total]);

  const addToCart = (p: ProductoPublico) => {
    if (!p || !p.id) return;

    const precio = Number(p.precio_venta || 0);
    if (precio <= 0) {
      setError("Este producto no tiene precio de venta.");
      return;
    }

    setCart((prev) => {
      const idx = prev.findIndex((x) => x.producto_id === p.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], qty: copy[idx].qty + 1 };
        return copy;
      }
      return [
        ...prev,
        {
          producto_id: p.id,
          nombre: p.nombre,
          sku: p.sku,
          codigo_barras: p.codigo_barras ?? null,
          precio_unitario: precio,
          qty: 1,
        },
      ];
    });
  };

  const setQty = (producto_id: string, qty: number) => {
    setCart((prev) =>
      prev
        .map((x) =>
          x.producto_id === producto_id ? { ...x, qty: Math.max(1, qty) } : x
        )
        .filter(Boolean)
    );
  };

  const removeItem = (producto_id: string) => {
    setCart((prev) => prev.filter((x) => x.producto_id !== producto_id));
  };

  const clearCart = () => {
    setCart([]);
    setEfectivoRecibido("");
    setError(null);
  };

  // ==========================
  // ✅ Normalizadores robustos (HID / impresiones / ceros / controles invisibles)
  // ==========================
  const normScan = (v: any) =>
    String(v ?? "")
      .trim()
      // quita controles invisibles (TAB, CR, LF, etc.)
      .replace(/[\u0000-\u001F\u007F]/g, "")
      // quita espacios internos
      .replace(/\s+/g, "")
      .toUpperCase();

  const onlyDigits = (v: any) => normScan(v).replace(/\D+/g, "");
  const stripLeadingZeros = (v: string) => v.replace(/^0+/, "");

  // ==========================
  // ✅ Agregar por código directo (HID / global)
  // ==========================
  const agregarPorCodigo = (codeRaw: string) => {
    const code = normScan(codeRaw);
    if (!code) return;

    const codeDigits = onlyDigits(code);
    const codeNoZeros = stripLeadingZeros(codeDigits || "");

    const match = (p: ProductoPublico, needle: string) => {
      if (!needle) return false;

      const cb = normScan(p.codigo_barras);
      const sku = normScan(p.sku);

      // 1) exacto normalizado
      if (cb && cb === needle) return true;
      if (sku && sku === needle) return true;

      // 2) comparación por dígitos (si el lector manda solo números)
      const cbDigits = onlyDigits(cb);
      const skuDigits = onlyDigits(sku);

      if (cbDigits && cbDigits === needle) return true;
      if (skuDigits && skuDigits === needle) return true;

      // 3) tolerancia con ceros a la izquierda (EAN/UPC)
      if (cbDigits && stripLeadingZeros(cbDigits) === needle) return true;
      if (skuDigits && stripLeadingZeros(skuDigits) === needle) return true;

      return false;
    };

    // prioridad: exacto / dígitos / sin ceros
    let p =
      productos.find((x) => match(x, code)) ||
      (codeDigits ? productos.find((x) => match(x, codeDigits)) : undefined) ||
      (codeNoZeros ? productos.find((x) => match(x, codeNoZeros)) : undefined);

    // fallback: endsWith SOLO si es único (evita colisiones)
    if (!p && codeDigits) {
      const cand = productos.filter((x) => {
        const cbDigits = onlyDigits(x.codigo_barras);
        const skuDigits = onlyDigits(x.sku);
        return (
          (cbDigits && cbDigits.endsWith(codeDigits)) ||
          (skuDigits && skuDigits.endsWith(codeDigits))
        );
      });
      if (cand.length === 1) p = cand[0];
    }

    if (!p) {
      setError(`Código no encontrado: ${codeDigits || code}`);
      flashScanUi("error", "No encontrado");
      focusBarcode();
      return;
    }

    addToCart(p);

    setBarcodeInput("");
    setError(null);
    flashScanUi("ok", "Añadido");
    focusBarcode();
  };

  // ==========================
  // 7) Scan / Enter por código (manual)
  // ✅ IMPORTANTE: leer el valor directo del input (evita “valor cortado” por setState)
  // ==========================
  const buscarYAgregarPorCodigo = (raw?: string) => {
    const v = raw ?? barcodeRef.current?.value ?? barcodeInput;
    agregarPorCodigo(v);
  };

  // ==========================
  // ✅ Escaneo global para lectores tipo teclado (HID)
  // ==========================
  const scanBufferRef = useRef("");
  const scanLastTimeRef = useRef<number>(0);
  const scanTimerRef = useRef<any>(null);
  const scanActiveRef = useRef(false);

  useEffect(() => {
    if (cajaEstado !== "ABIERTA") return;
    if (showCerrarCaja) return; // si estás cerrando caja, no secuestramos teclado
    if (showCartMobile) return; // ✅ si el carrito móvil está abierto, no secuestramos teclado

    const MIN_LEN = 3;
    const FAST_MS = 60; // un poco más tolerante para inalámbricos
    const IDLE_MS = 220; // evita cortar por micro-lags

    const finishScan = () => {
      const code = scanBufferRef.current.trim();
      scanBufferRef.current = "";
      scanActiveRef.current = false;

      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;

      if (code.length >= MIN_LEN) {
        agregarPorCodigo(code);
      } else {
        focusBarcode();
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // ✅ si el input de escaneo ya está enfocado, dejamos que el input maneje todo
      if (barcodeRef.current && document.activeElement === barcodeRef.current) {
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key;
      const now = Date.now();
      const delta = now - (scanLastTimeRef.current || 0);
      scanLastTimeRef.current = now;

      const isTerminator = key === "Enter" || key === "Tab";
      const isChar = key.length === 1;

      const looksLikeScan =
        scanActiveRef.current || (isChar && delta > 0 && delta <= FAST_MS);

      if (isTerminator) {
        if (scanBufferRef.current.length >= MIN_LEN) {
          e.preventDefault();
          e.stopPropagation();
          finishScan();
        }
        return;
      }

      if (!isChar) return;

      if (!looksLikeScan) {
        return;
      }

      scanActiveRef.current = true;
      scanBufferRef.current += key;

      e.preventDefault();
      e.stopPropagation();

      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
      scanTimerRef.current = setTimeout(() => {
        if (scanActiveRef.current) finishScan();
      }, IDLE_MS);
    };

    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
      scanBufferRef.current = "";
      scanActiveRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cajaEstado, showCerrarCaja, showCartMobile, productos]);

  // ✅ Bonus: cuando se abre la caja, enfoca el input de escaneo
  useEffect(() => {
    if (cajaEstado === "ABIERTA") {
      setTimeout(() => focusBarcode(), 80);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cajaEstado]);

  // ==========================
  // 8) Confirmar venta (POST /api/sales/pos)
  // ==========================
  const confirmarVenta = async () => {
    if (!token) return;

    if (cajaEstado !== "ABIERTA") {
      setError("Debes aperturar la caja antes de vender.");
      return;
    }

    if (cart.length === 0) {
      setError("El carrito está vacío.");
      return;
    }

    if (metodoPago === "EFECTIVO") {
      const rec = Number(efectivoRecibido || 0);
      if (rec < total) {
        setError("Efectivo insuficiente.");
        return;
      }
    }

    try {
      setLoading(true);
      setError(null);

      const body = {
        items: cart.map((x) => ({
          producto_id: x.producto_id,
          qty: x.qty,
          precio_unitario: x.precio_unitario,
        })),
        metodo_pago: metodoPago,
        efectivo_recibido:
          metodoPago === "EFECTIVO" ? Number(efectivoRecibido || 0) : null,
      };

      const res = await fetch(`${API_URL}/api/sales/pos`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Error al registrar venta");

      imprimirTicket(data?.venta_id, total, cambio);

      clearCart();
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? "Error al registrar venta");
    } finally {
      setLoading(false);
    }
  };

  const imprimirTicket = (
    ventaId: string,
    totalVenta: number,
    cambioLocal: number
  ) => {
    if (typeof window === "undefined") return;

    const w = window.open("", "_blank");
    if (!w) return;

    const rows = cart
      .map(
        (it) => `
        <tr>
          <td style="padding:4px 0;">${escapeHtml(it.nombre)}</td>
          <td style="padding:4px 0; text-align:right;">x${it.qty}</td>
          <td style="padding:4px 0; text-align:right;">Q ${it.precio_unitario.toFixed(
            2
          )}</td>
        </tr>
      `
      )
      .join("");

    w.document.open();
    w.document.write(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8"/>
          <title>Ticket</title>
          <style>
            body{font-family:Arial,sans-serif; padding:12px;}
            h2{margin:0 0 8px;}
            .muted{color:#666; font-size:12px;}
            table{width:100%; border-collapse:collapse; margin-top:8px;}
            hr{margin:10px 0;}
          </style>
        </head>
        <body>
          <h2>Ticket de venta</h2>
          <div class="muted">Venta: ${escapeHtml(ventaId || "")}</div>
          <div class="muted">${escapeHtml(new Date().toLocaleString("es-GT"))}</div>
          <table>${rows}</table>
          <hr/>
          <div style="display:flex; justify-content:space-between;">
            <b>Total</b><b>Q ${Number(totalVenta || 0).toFixed(2)}</b>
          </div>
          ${
            metodoPago === "EFECTIVO"
              ? `<div style="display:flex; justify-content:space-between; margin-top:6px;">
                   <span>Cambio</span><b>Q ${Number(cambioLocal || 0).toFixed(
                     2
                   )}</b>
                 </div>`
              : ""
          }
          <hr/>
          <div class="muted">Gracias. Vuelva pronto ✨</div>
          <script>setTimeout(()=>window.print(), 200);</script>
        </body>
      </html>
    `);
    w.document.close();
  };

  const escapeHtml = (s: any) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

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

  // ==========================
  // UI: Pantalla de apertura
  // ==========================
  const renderApertura = () => {
    const cerrado = cajaEstado === "CERRADA";

    return (
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 md:px-8 py-8">
        <section className="bg-[#3a0d12]/80 border border-[#5a1b22] rounded-2xl p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">Apertura de caja</h2>
                <span className={estadoBadge(cajaEstado)}>{cajaEstado}</span>
              </div>

              <p className="text-xs text-[#c9b296] mt-2">
                Antes de vender, ingresa el efectivo inicial con el que empieza
                la caja.
              </p>
            </div>

            <button
              type="button"
              onClick={verificarCajaHoy}
              className="rounded-full border border-[#7a2b33] px-3 py-1.5 text-[11px] text-[#f1e4d4] hover:bg-[#4b141a]/80 disabled:opacity-40"
              disabled={loadingCaja}
            >
              ⟳ Verificar
            </button>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="bg-[#2b0a0b]/50 border border-[#5a1b22] rounded-2xl p-4">
              <label className="text-[11px] text-[#c9b296] block mb-2">
                Monto de apertura (efectivo inicial)
              </label>

              <div className="flex items-center gap-2">
                <span className="text-[#e3c578] text-sm font-semibold">Q</span>
                <input
                  value={montoApertura}
                  onChange={(e) => setMontoApertura(e.target.value)}
                  placeholder="0.00"
                  inputMode="decimal"
                  className="flex-1 rounded-full border border-[#6b232b] bg-[#3a0d12]/80 px-4 py-2 text-sm text-[#f8f1e6] placeholder-[#b39878] focus:outline-none focus:ring-2 focus:ring-[#d6b25f]"
                  disabled={cerrado}
                />
              </div>

              <button
                type="button"
                onClick={aperturarCaja}
                disabled={loadingCaja || cerrado}
                className="w-full mt-4 rounded-2xl border border-[#d6b25f]/60 bg-[#d6b25f]/10 hover:bg-[#d6b25f]/20 transition-colors px-4 py-3 text-sm font-semibold disabled:opacity-40"
              >
                ✅ Aperturar caja
              </button>

              <p className="text-[11px] text-[#c9b296] mt-3">
                Si ya estaba abierta, el sistema no duplica registros: solo te
                deja entrar sin drama.
              </p>

              {cerrado && (
                <div className="mt-3 text-[11px] text-amber-200/90">
                  Hoy ya está <b>cerrada</b>. Si tu operación requiere reabrir el
                  mismo día, se habilita desde backend.
                </div>
              )}
            </div>

            <div className="bg-[#2b0a0b]/50 border border-[#5a1b22] rounded-2xl p-4">
              <div className="text-[11px] text-[#c9b296]">Estado actual</div>

              <div className="mt-2 text-sm">
                {loadingCaja ? (
                  <span className="text-[#c9b296]">Verificando…</span>
                ) : (
                  <span className="font-semibold text-[#f8f1e6]">
                    {cajaEstado === "SIN_APERTURA" && "SIN APERTURA"}
                    {cajaEstado === "ABIERTA" && "ABIERTA"}
                    {cajaEstado === "CERRADA" && "CERRADA"}
                    {cajaEstado === "CARGANDO" && "CARGANDO"}
                  </span>
                )}
              </div>

              {cierreActual && (
                <div className="mt-4 text-xs text-[#c9b296] space-y-1">
                  <div>
                    <b className="text-[#f1e4d4]">Inicio:</b>{" "}
                    {new Date(cierreActual.fecha_inicio).toLocaleString("es-GT")}
                  </div>
                  {cierreActual.fecha_fin && (
                    <div>
                      <b className="text-[#f1e4d4]">Fin:</b>{" "}
                      {new Date(cierreActual.fecha_fin).toLocaleString("es-GT")}
                    </div>
                  )}
                  <div>
                    <b className="text-[#f1e4d4]">Apertura:</b>{" "}
                    {fmtQ(cierreActual.monto_apertura)}
                  </div>

                  {cajaEstado === "CERRADA" && (
                    <div className="pt-2 mt-2 border-t border-[#5a1b22] space-y-1">
                      <div className="flex justify-between">
                        <span>Efectivo</span>
                        <b className="text-[#f1e4d4]">
                          {fmtQ(cierreActual.total_efectivo)}
                        </b>
                      </div>
                      <div className="flex justify-between">
                        <span>Transferencia</span>
                        <b className="text-[#f1e4d4]">
                          {fmtQ(cierreActual.total_transferencia)}
                        </b>
                      </div>
                      <div className="flex justify-between">
                        <span>Tarjeta</span>
                        <b className="text-[#f1e4d4]">
                          {fmtQ(cierreActual.total_tarjeta)}
                        </b>
                      </div>
                      <div className="flex justify-between">
                        <span>Total</span>
                        <b className="text-[#e3c578]">
                          {fmtQ(cierreActual.total_general)}
                        </b>
                      </div>

                      {cierreActual.monto_cierre_reportado != null && (
                        <div className="flex justify-between">
                          <span>Contado</span>
                          <b className="text-[#f1e4d4]">
                            {fmtQ(cierreActual.monto_cierre_reportado)}
                          </b>
                        </div>
                      )}

                      {cierreActual.diferencia != null && (
                        <div className="flex justify-between">
                          <span>Diferencia</span>
                          <b
                            className={
                              Number(cierreActual.diferencia) === 0
                                ? "text-emerald-200"
                                : "text-amber-200"
                            }
                          >
                            {fmtQ(cierreActual.diferencia)}
                          </b>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
    );
  };

  // ==========================
  // ✅ UI: Carrito (reutilizable) para Desktop y Drawer móvil
  // ==========================
  const renderCarritoUI = (opts?: { showClose?: boolean }) => {
    const showClose = !!opts?.showClose;

    return (
      <>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Carrito</h2>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={clearCart}
              className="text-[11px] rounded-full border border-[#7a2b33] px-3 py-1 hover:bg-[#4b141a]/80"
            >
              Vaciar
            </button>

            {showClose && (
              <button
                type="button"
                onClick={() => setShowCartMobile(false)}
                className="text-[11px] rounded-full border border-[#7a2b33] px-3 py-1 hover:bg-[#4b141a]/80"
              >
                Cerrar
              </button>
            )}
          </div>
        </div>

        {cart.length === 0 ? (
          <p className="text-xs text-[#c9b296]">
            Agrega productos para iniciar una venta.
          </p>
        ) : (
          <div className="space-y-2">
            {cart.map((it) => (
              <div
                key={it.producto_id}
                className="border border-[#5a1b22] rounded-xl p-3 bg-[#2b0a0b]/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold">{it.nombre}</div>
                    <div className="text-[11px] text-[#c9b296]">
                      {it.sku}{" "}
                      {it.codigo_barras ? `• ${it.codigo_barras}` : ""}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeItem(it.producto_id)}
                    className="text-[11px] rounded-full border border-[#7a2b33] px-2 py-0.5 hover:bg-[#4b141a]/80"
                  >
                    Quitar
                  </button>
                </div>

                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setQty(it.producto_id, it.qty - 1)}
                      className="rounded-full border border-[#7a2b33] px-3 py-1 text-[11px]"
                    >
                      −
                    </button>
                    <input
                      value={it.qty}
                      onChange={(e) =>
                        setQty(it.producto_id, Number(e.target.value || 1))
                      }
                      className="w-14 text-center rounded-full border border-[#6b232b] bg-[#3a0d12]/80 px-2 py-1 text-[11px]"
                    />
                    <button
                      type="button"
                      onClick={() => setQty(it.producto_id, it.qty + 1)}
                      className="rounded-full border border-[#7a2b33] px-3 py-1 text-[11px]"
                    >
                      +
                    </button>
                  </div>

                  <div className="text-[11px] text-[#e3c578]">
                    {fmtQ(it.qty * it.precio_unitario)}
                  </div>
                </div>
              </div>
            ))}

            <div className="border-t border-[#5a1b22] pt-3 mt-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-[#c9b296]">Método de pago</span>
                <select
                  value={metodoPago}
                  onChange={(e) => setMetodoPago(e.target.value as MetodoPago)}
                  className="rounded-full border border-[#6b232b] bg-[#3a0d12]/80 px-3 py-1 text-[11px]"
                >
                  <option value="EFECTIVO">EFECTIVO</option>
                  <option value="TARJETA">TARJETA</option>
                  <option value="TRANSFERENCIA">TRANSFERENCIA</option>
                </select>
              </div>

              {metodoPago === "EFECTIVO" && (
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[#c9b296]">
                    Efectivo recibido
                  </span>
                  <input
                    value={efectivoRecibido}
                    onChange={(e) => setEfectivoRecibido(e.target.value)}
                    placeholder="0.00"
                    className="w-32 text-right rounded-full border border-[#6b232b] bg-[#3a0d12]/80 px-3 py-1 text-[11px]"
                  />
                </div>
              )}

              <div className="flex items-center justify-between text-sm">
                <b>Total</b>
                <b className="text-[#e3c578]">{fmtQ(total)}</b>
              </div>

              {metodoPago === "EFECTIVO" && (
                <div className="flex items-center justify-between text-[11px] text-[#c9b296]">
                  <span>Cambio</span>
                  <span className="text-[#f1e4d4]">{fmtQ(cambio)}</span>
                </div>
              )}

              <button
                type="button"
                onClick={confirmarVenta}
                disabled={loading}
                className="w-full rounded-2xl border border-[#d6b25f]/60 bg-[#d6b25f]/10 hover:bg-[#d6b25f]/20 transition-colors px-4 py-3 text-sm font-semibold disabled:opacity-40"
              >
                ✅ Confirmar venta
              </button>
            </div>
          </div>
        )}
      </>
    );
  };

  // ==========================
  // UI: POS
  // ==========================
  const renderPOS = () => {
    return (
      <>
        {/* ✅ pb extra SOLO móvil para que el botón flotante no estorbe */}
        <main className="flex-1 w-full max-w-6xl mx-auto px-4 md:px-8 py-6 pb-24 md:pb-6 grid gap-4 md:grid-cols-2">
          {/* Productos */}
          <section className="bg-[#3a0d12]/80 border border-[#5a1b22] rounded-2xl p-4 min-w-0">
            {/* Header */}
            <div className="mb-3 min-w-0">
              <div className="flex items-center justify-between gap-3 min-w-0">
                <h2 className="text-sm font-semibold shrink-0">Productos</h2>
              </div>

              {/* ✅ Layout pedido:
                  1) Buscar (línea 1)
                  2) Escaneo (línea 2)
                  Siempre apilado para evitar cortar el buscador */}
              <div className="mt-3 flex flex-col gap-3 min-w-0">
                {/* Buscar (línea 1) */}
                <div className="flex items-center gap-2 w-full min-w-0">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar (nombre, SKU, categoría...)"
                    className="flex-1 min-w-0 rounded-full border border-[#6b232b] bg-[#2b0a0b]/60 px-3 py-2 text-[11px] text-[#f8f1e6] placeholder-[#b39878] focus:outline-none focus:ring-2 focus:ring-[#d6b25f]"
                  />

                  {search.trim() !== "" && (
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      className="shrink-0 rounded-full border border-[#7a2b33] px-3 py-2 text-[11px] text-[#f1e4d4] hover:bg-[#4b141a]/80"
                      title="Limpiar búsqueda"
                    >
                      Limpiar
                    </button>
                  )}
                </div>

                {/* Escaneo (línea 2) */}
                <div className="w-full min-w-0">
                  <div className="flex items-center justify-between px-1 mb-1 flex-wrap gap-2">
                    <span className="text-[10px] text-[#c9b296]">
                      Escaneo rápido (lector o teclado)
                    </span>

                    <span
                      className={`text-[10px] inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${scanTone.pill}`}
                      title="Estado de escaneo"
                    >
                      <span
                        className={
                          scanUi.mode === "ok"
                            ? "animate-pulse"
                            : scanUi.mode === "error"
                            ? "animate-pulse"
                            : ""
                        }
                      >
                        {scanUi.mode === "ok"
                          ? "✔"
                          : scanUi.mode === "error"
                          ? "⚠"
                          : "●"}
                      </span>
                      {scanUi.text}
                    </span>
                  </div>

                  <div className="relative">
                    {/* icono */}
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        className={`${scanTone.icon}`}
                        xmlns="http://www.w3.org/2000/svg"
                        aria-hidden="true"
                      >
                        <path
                          d="M4 7V5a2 2 0 0 1 2-2h2"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                        <path
                          d="M20 7V5a2 2 0 0 0-2-2h-2"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                        <path
                          d="M4 17v2a2 2 0 0 0 2 2h2"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                        <path
                          d="M20 17v2a2 2 0 0 1-2 2h-2"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                        <path
                          d="M8 8v8"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                        <path
                          d="M12 8v8"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                        <path
                          d="M16 8v8"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                    </div>

                    <input
                      ref={barcodeRef}
                      value={barcodeInput}
                      onChange={(e) => setBarcodeInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          buscarYAgregarPorCodigo(
                            (e.currentTarget as HTMLInputElement).value
                          );
                        }
                      }}
                      placeholder="Escanear / escribir código y Enter"
                      className={[
                        "w-full min-w-0 rounded-full bg-[#2b0a0b]/60",
                        "pl-9 pr-24 py-2",
                        "text-[12px] text-[#f8f1e6] placeholder-[#b39878]",
                        "border",
                        scanTone.border,
                        "focus:outline-none focus:ring-2",
                        scanTone.ring,
                        "transition-colors",
                      ].join(" ")}
                    />

                    <button
                      type="button"
                      onClick={() => buscarYAgregarPorCodigo()}
                      className={[
                        "absolute right-1 top-1/2 -translate-y-1/2",
                        "rounded-full border border-[#d6b25f]/60",
                        "bg-[#d6b25f]/10 hover:bg-[#d6b25f]/20",
                        "transition-colors px-3 py-1 text-[11px]",
                        "h-[30px] shrink-0",
                        "inline-flex items-center gap-1",
                      ].join(" ")}
                      title="Agregar por código"
                    >
                      <span className="opacity-90">↵</span> Agregar
                    </button>
                  </div>

                  <div className="mt-1 px-1 text-[10px] text-[#b39878]">
                    Tip: con lector HID solo escanea y listo
                  </div>
                </div>
              </div>
            </div>

            <div className="mb-2 text-[11px] text-[#c9b296] flex items-center justify-between">
              <span>
                Mostrando{" "}
                <b className="text-[#f1e4d4]">{productosFiltrados.length}</b> de{" "}
                <b className="text-[#f1e4d4]">{productos.length}</b>
              </span>
              <button
                type="button"
                onClick={focusBarcode}
                className="rounded-full border border-[#7a2b33] px-3 py-1 hover:bg-[#4b141a]/80"
                title="Enfocar escaneo"
              >
                🎯 Escanear
              </button>
            </div>

            {loading && <p className="text-xs text-[#c9b296]">Cargando…</p>}

            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="text-[#c9b296] border-b border-[#5a1b22]">
                    <th className="text-left py-2 px-2">Nombre</th>
                    <th className="text-right py-2 px-2">Precio</th>
                    <th className="text-center py-2 px-2">+</th>
                  </tr>
                </thead>
                <tbody>
                  {!loading && productosFiltrados.length === 0 && (
                    <tr>
                      <td
                        colSpan={3}
                        className="py-4 text-center text-[#b39878]"
                      >
                        No hay productos para mostrar.
                      </td>
                    </tr>
                  )}

                  {productosFiltrados.map((p) => (
                    <tr
                      key={p.id}
                      className="border-b border-[#3a0d12]/70 hover:bg-[#3a0d12]/70"
                    >
                      <td className="py-2 px-2 text-[#f8f1e6]">
                        <div className="font-medium">{p.nombre}</div>
                        <div className="text-[11px] text-[#c9b296]">
                          {p.sku} {p.codigo_barras ? `• ${p.codigo_barras}` : ""}
                          {p.categoria ? ` • ${p.categoria}` : ""}
                        </div>
                      </td>
                      <td className="py-2 px-2 text-right text-[#e3c578]">
                        {fmtQ(p.precio_venta)}
                      </td>
                      <td className="py-2 px-2 text-center">
                        <button
                          type="button"
                          onClick={() => addToCart(p)}
                          className="text-[11px] rounded-full border border-[#d6b25f]/60 bg-[#d6b25f]/10 px-3 py-1 hover:bg-[#d6b25f]/20"
                        >
                          Añadir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ✅ Carrito: SOLO md+ (desktop/tablet) */}
          <section className="hidden md:block bg-[#3a0d12]/80 border border-[#5a1b22] rounded-2xl p-4">
            {renderCarritoUI()}
          </section>
        </main>

        {/* ✅ Botón flotante: SOLO móvil (arriba del botón menú) */}
<button
  type="button"
  onClick={() => setShowCartMobile(true)}
  disabled={cartCount === 0}
  className={[
    "md:hidden fixed z-40",
    // ✅ MISMA alineación a la derecha que el menú
    "right-5",
    // ✅ SUBIDO arriba del botón menú + safe-area iPhone
    "bottom-[calc(1.25rem+env(safe-area-inset-bottom)+4.25rem)]",

    // ✅ MISMO tamaño “tipo botón menú”
    "h-12 w-12 rounded-full",

    "border border-[#d6b25f]/60 bg-[#2b0a0b]/85 backdrop-blur",
    "shadow-lg hover:bg-[#3a0d12]/90 transition-colors",
    "flex items-center justify-center",
    cartCount === 0 ? "opacity-40" : "opacity-100",
  ].join(" ")}
  title="Ver carrito"
>
  <span className="text-lg">🛒</span>

  {cartCount > 0 && (
    <span
      className={[
        "absolute -top-1 -right-1",
        "min-w-[20px] h-[20px] px-1",
        "rounded-full text-[10px] font-bold",
        "bg-[#d6b25f] text-[#2b0a0b]",
        "flex items-center justify-center",
      ].join(" ")}
    >
      {cartCount}
    </span>
  )}
</button>


        {/* ✅ Drawer/Modal: SOLO móvil */}
        {showCartMobile && (
          <div className="md:hidden fixed inset-0 z-50">
            {/* backdrop */}
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => setShowCartMobile(false)}
            />

            {/* drawer */}
            <div
              className={[
                "absolute left-0 right-0 bottom-0",
                "max-h-[85vh] overflow-auto",
                "bg-[#3a0d12]/95 border-t border-[#5a1b22]",
                "rounded-t-2xl p-4",
              ].join(" ")}
            >
              {renderCarritoUI({ showClose: true })}
            </div>
          </div>
        )}
      </>
    );
  };

  return (
    <div className="min-h-screen bg-[#2b0a0b] text-[#f8f1e6] flex flex-col md:flex-row">
      <AdminSidebar user={user} onLogout={handleLogout} />

      <div className="flex-1 flex flex-col">
        <header className="border-b border-[#5a1b22] bg-[#2b0a0b]/80 backdrop-blur px-4 md:px-8 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl md:text-2xl font-semibold">
                  Panel de Caja
                </h1>
                <span className={estadoBadge(cajaEstado)}>{cajaEstado}</span>
              </div>
              <p className="text-xs md:text-sm text-[#c9b296] capitalize">
                {today}
              </p>

              {cajaEstado === "ABIERTA" && (
                <p className="text-[11px] text-[#b39878] mt-1">
                  Apertura: {fmtQ(cierreActual?.monto_apertura ?? 0)}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 justify-end">
              {cajaEstado === "ABIERTA" && (
                <button
                  type="button"
                  onClick={() => setShowCerrarCaja((v) => !v)}
                  className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-[11px] text-amber-100 hover:bg-amber-400/15 disabled:opacity-40"
                  disabled={loadingCaja}
                  title="Cerrar caja"
                >
                  ⛔ Cerrar caja
                </button>
              )}

              <button
                type="button"
                onClick={verificarCajaHoy}
                className="rounded-full border border-[#7a2b33] px-3 py-1.5 text-[11px] text-[#f1e4d4] hover:bg-[#4b141a]/80 disabled:opacity-40"
                disabled={loadingCaja}
              >
                ⟳ Verificar caja
              </button>
            </div>
          </div>

          {cajaEstado === "ABIERTA" && showCerrarCaja && (
            <div className="mt-4 bg-[#3a0d12]/70 border border-[#5a1b22] rounded-2xl p-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Cierre de caja</div>
                  <div className="text-[11px] text-[#c9b296] mt-1">
                    Ingresa el efectivo contado (opcional). El sistema calcula
                    totales y guarda diferencia.
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[#e3c578] text-sm font-semibold">
                      Q
                    </span>
                    <input
                      value={montoCierreReportado}
                      onChange={(e) => setMontoCierreReportado(e.target.value)}
                      placeholder="(opcional)"
                      inputMode="decimal"
                      className="w-40 rounded-full border border-[#6b232b] bg-[#2b0a0b]/60 px-3 py-2 text-[11px] text-[#f8f1e6] placeholder-[#b39878] focus:outline-none focus:ring-2 focus:ring-[#d6b25f]"
                      disabled={loadingCaja}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={cerrarCaja}
                    disabled={loadingCaja}
                    className="rounded-2xl border border-amber-400/30 bg-amber-400/10 hover:bg-amber-400/15 px-4 py-2 text-[11px] font-semibold text-amber-100 disabled:opacity-40"
                  >
                    ✅ Confirmar cierre
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowCerrarCaja(false)}
                    className="rounded-2xl border border-[#7a2b33] hover:bg-[#4b141a]/80 px-4 py-2 text-[11px] text-[#f1e4d4]"
                    disabled={loadingCaja}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          )}

          {!!error && (
            <p className="text-[11px] text-red-300 mt-2">Error: {error}</p>
          )}
        </header>

        {cajaEstado === "CARGANDO" || loadingCaja ? (
          <div className="flex-1 flex items-center justify-center text-[#c9b296]">
            Verificando estado de caja…
          </div>
        ) : cajaEstado === "ABIERTA" ? (
          renderPOS()
        ) : (
          renderApertura()
        )}
      </div>
    </div>
  );
}
