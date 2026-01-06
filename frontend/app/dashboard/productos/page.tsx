"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminSidebar from "../../_components/AdminSidebar";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface User {
  id: string;
  nombre: string;
  email: string;
  rol: string;
}

interface Categoria {
  id: string;
  nombre: string;
}

interface Producto {
  id: string;
  sku: string;
  nombre: string;
  precio_venta: number;
  codigo_barras?: string | null;
  activo: boolean;

  // Opcionales (por si el backend los devuelve)
  costo_compra?: number;
  costo_envio?: number;
  costo_impuestos?: number;
  costo_desaduanaje?: number;
}

export default function ProductosPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);

  // Form
  const [sku, setSku] = useState("");
  const [nombre, setNombre] = useState("");
  const [precioVenta, setPrecioVenta] = useState("");
  const [stockMinimo, setStockMinimo] = useState("");
  const [codigoBarras, setCodigoBarras] = useState("");
  const [categoriasSeleccionadas, setCategoriasSeleccionadas] = useState<
    string[]
  >([]);

  // 🔹 Nuevos campos de costos
  const [costoCompra, setCostoCompra] = useState("");
  const [costoEnvio, setCostoEnvio] = useState("");
  const [costoImpuestos, setCostoImpuestos] = useState("");
  const [costoDesaduanaje, setCostoDesaduanaje] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Último código de barras creado (para imprimir etiqueta)
  const [lastCreatedBarcode, setLastCreatedBarcode] = useState<string | null>(
    null
  );

  const today = new Date().toLocaleDateString("es-GT", {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  // Verificar sesión (user + token)
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

  // Cargar categorías y algunos productos recientes
  useEffect(() => {
    if (!token) return;

    const loadData = async () => {
      try {
        setLoading(true);

        const [resCats, resProds] = await Promise.all([
          fetch(`${API_URL}/api/catalog/categories`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(
            `${API_URL}/api/catalog/products?page=1&pageSize=10&soloActivos=true`,
            {
              headers: { Authorization: `Bearer ${token}` },
            }
          ),
        ]);

        if (resCats.ok) {
          const catsData = await resCats.json();
          setCategorias(catsData.data || catsData);
        }

        if (resProds.ok) {
          const prodsData = await resProds.json();
          const lista = prodsData.data?.items || prodsData.items || prodsData;
          setProductos(lista);
        }
      } catch (err) {
        console.error(err);
        setError("No se pudieron cargar los datos iniciales.");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [token]);

  const generarCodigoBarras = () => {
    const base = (sku || "PROD").replace(/[^A-Z0-9]/gi, "").toUpperCase();
    const prefix = base.slice(0, 6) || "PROD";
    const time = Date.now().toString().slice(-6);
    const random = Math.floor(100 + Math.random() * 900); // 3 dígitos
    const code = `${prefix}-${time}${random}`;
    setCodigoBarras(code);
  };

  const handleCategoriasChange = (
    e: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const options = Array.from(e.target.selectedOptions).map((o) => o.value);
    setCategoriasSeleccionadas(options);
  };

  const limpiarForm = () => {
    setSku("");
    setNombre("");
    setPrecioVenta("");
    setStockMinimo("");
    setCodigoBarras("");
    setCategoriasSeleccionadas([]);

    // limpiar costos
    setCostoCompra("");
    setCostoEnvio("");
    setCostoImpuestos("");
    setCostoDesaduanaje("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setError(null);
    setSuccess(null);

    if (!sku.trim() || !nombre.trim()) {
      setError("SKU y nombre del producto son obligatorios.");
      return;
    }

    try {
      setSaving(true);

      const body = {
        sku: sku.trim(),
        nombre: nombre.trim(),
        precioVenta: precioVenta ? Number(precioVenta) : 0,
        stockMinimo: stockMinimo ? Number(stockMinimo) : 0,
        categoriasIds: categoriasSeleccionadas,
        // si el input está vacío, el backend generará uno
        codigoBarras: codigoBarras.trim() || undefined,

        // 🔹 nuevos campos enviados al backend
        costoCompra: costoCompra ? Number(costoCompra) : 0,
        costoEnvio: costoEnvio ? Number(costoEnvio) : 0,
        costoImpuestos: costoImpuestos ? Number(costoImpuestos) : 0,
        costoDesaduanaje: costoDesaduanaje ? Number(costoDesaduanaje) : 0,
      };

      const res = await fetch(`${API_URL}/api/catalog/products`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok || data.ok === false) {
        throw new Error(data.message || "Error creando producto");
      }

      const productoCreado: Producto = data.data || data;

      // obtener el código de barras que quedó asignado
      const newBarcode =
        (productoCreado.codigo_barras as string | null) ||
        codigoBarras.trim() ||
        "";

      setLastCreatedBarcode(newBarcode || null);

      setSuccess("Producto guardado correctamente.");
      limpiarForm();
      // refrescamos listado corto
      setProductos((prev) => [productoCreado, ...prev].slice(0, 10));
    } catch (err: any) {
      console.error(err);
      setError(
        err?.message === "Ya existe un producto con ese SKU o código de barras"
          ? err.message
          : "No se pudo guardar el producto."
      );
      setLastCreatedBarcode(null);
    } finally {
      setSaving(false);
    }
  };

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

  return (
    <div className="min-h-screen bg-[#2b0a0b] text-[#f8f1e6] flex">
      {/* Sidebar reutilizado (igual que dashboard/inventario) */}
      <AdminSidebar user={user} onLogout={handleLogout} />

      <div className="flex-1 flex flex-col">
        {/* Top bar */}
        <header className="border-b border-[#5a1b22] bg-[#2b0a0b]/80 backdrop-blur flex items-center justify-between px-4 md:px-8 py-4 sticky top-0 z-10">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold">Productos</h1>
            <p className="text-xs md:text-sm text-[#c9b296] capitalize">
              {today}
            </p>
          </div>
        </header>

        {/* Contenido principal */}
        <main className="flex-1 px-4 md:px-8 py-6 space-y-6">
          {/* Listado breve de productos recientes */}
          <section className="bg-[#3a0d12]/80 border border-[#5a1b22] rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">Productos recientes</h2>
              <span className="text-[11px] text-[#c9b296]">
                Se muestran los últimos 10 productos creados.
              </span>
            </div>

            {loading ? (
              <p className="text-sm text-[#c9b296]">Cargando productos...</p>
            ) : productos.length === 0 ? (
              <p className="text-sm text-[#b39878]">
                Aún no hay productos registrados. Empieza usando el formulario
                de abajo.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#5a1b22] text-[#c9b296]">
                      <th className="text-left py-2 px-2">SKU</th>
                      <th className="text-left py-2 px-2">Nombre</th>
                      <th className="text-right py-2 px-2">
                        Precio venta (Q)
                      </th>
                      <th className="text-left py-2 px-2">Código barras</th>
                      <th className="text-center py-2 px-2">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productos.map((p) => (
                      <tr
                        key={p.id}
                        className="border-b border-[#3a0d12]/70 hover:bg-[#3a0d12]/60"
                      >
                        <td className="py-2 px-2 text-[#f8f1e6]">{p.sku}</td>
                        <td className="py-2 px-2 text-[#f8f1e6]">{p.nombre}</td>
                        <td className="py-2 px-2 text-right text-[#e3c578]">
                          {p.precio_venta.toLocaleString("es-GT", {
                            minimumFractionDigits: 2,
                          })}
                        </td>
                        <td className="py-2 px-2 text-[#f1e4d4]">
                          {p.codigo_barras || (
                            <span className="text-[#b39878]">—</span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-center">
                          <span
                            className={`px-2 py-1 rounded-full text-[11px] border ${
                              p.activo
                                ? "border-[#d6b25f]/60 text-[#e3c578] bg-[#d6b25f]/10"
                                : "border-[#7a2b33] text-[#c9b296] bg-[#4b141a]/60"
                            }`}
                          >
                            {p.activo ? "Activo" : "Inactivo"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Form nuevo producto */}
          <section className="bg-[#3a0d12]/80 border border-[#5a1b22] rounded-2xl p-4 space-y-4">
            <h2 className="text-sm font-semibold">Nuevo producto</h2>

            {error && (
              <p className="text-xs text-red-300 bg-red-900/40 border border-red-700/60 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
            {success && (
              <p className="text-xs text-[#e3c578] bg-[#d6b25f]/10 border border-[#b98c3f]/60 rounded-lg px-3 py-2">
                {success}
              </p>
            )}

            {/* Bloque para imprimir etiqueta del último producto creado */}
            {lastCreatedBarcode && (
              <div className="mt-1 flex flex-col md:flex-row items-start md:items-center justify-between gap-2 rounded-lg border border-[#6b232b] bg-[#3a0d12]/70 px-3 py-2">
                <div className="text-[11px] text-[#e3d2bd]">
                  <div className="font-semibold text-[#f8f1e6]">
                    Etiqueta lista para imprimir
                  </div>
                  <div className="font-mono text-xs text-[#f1e4d4]">
                    Código: {lastCreatedBarcode}
                  </div>
                  <div className="text-[11px] text-[#b39878]">
                    Corresponde al último producto guardado.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    window.open(
                      `/dashboard/productos/etiqueta/${encodeURIComponent(
                        lastCreatedBarcode
                      )}`,
                      "_blank"
                    )
                  }
                  className="px-4 py-1.5 rounded-full bg-[#d6b25f] hover:bg-[#e3c578] text-[11px] font-semibold text-[#2b0a0b] self-stretch md:self-auto"
                >
                  Imprimir etiqueta
                </button>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs text-[#e3d2bd]">SKU *</label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-[#6b232b] bg-[#2b0a0b]/80 px-3 py-2 text-sm placeholder-[#b39878] focus:outline-none focus:ring-2 focus:ring-[#d6b25f]"
                    placeholder="Ej. ANILLO-ORO-001"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-[#e3d2bd]">
                    Precio venta (Q)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full rounded-lg border border-[#6b232b] bg-[#2b0a0b]/80 px-3 py-2 text-sm placeholder-[#b39878] focus:outline-none focus:ring-2 focus:ring-[#d6b25f]"
                    placeholder="0.00"
                    value={precioVenta}
                    onChange={(e) => setPrecioVenta(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-[#e3d2bd]">
                  Nombre del producto *
                </label>
                <input
                  type="text"
                  className="w-full rounded-lg border border-[#6b232b] bg-[#2b0a0b]/80 px-3 py-2 text-sm placeholder-[#b39878] focus:outline-none focus:ring-2 focus:ring-[#d6b25f]"
                  placeholder="Ej. Anillo de oro 14K"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-[1fr,2fr] gap-4">
                <div className="space-y-1">
                  <label className="text-xs text-[#e3d2bd]">Stock mínimo</label>
                  <input
                    type="number"
                    className="w-full rounded-lg border border-[#6b232b] bg-[#2b0a0b]/80 px-3 py-2 text-sm placeholder-[#b39878] focus:outline-none focus:ring-2 focus:ring-[#d6b25f]"
                    placeholder="Ej. 2"
                    value={stockMinimo}
                    onChange={(e) => setStockMinimo(e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-[#e3d2bd]">Categorías</label>
                  <select
                    multiple
                    className="w-full min-h-[80px] rounded-lg border border-[#6b232b] bg-[#2b0a0b]/80 px-3 py-2 text-sm text-[#f8f1e6] focus:outline-none focus:ring-2 focus:ring-[#d6b25f]"
                    value={categoriasSeleccionadas}
                    onChange={handleCategoriasChange}
                  >
                    {categorias.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.nombre}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-[#b39878]">
                    Mantén presionada CTRL (o CMD en Mac) para seleccionar
                    varias.
                  </p>
                </div>
              </div>

              {/* 🔹 Bloque de costos de compra (opcional) */}
              <div className="border-t border-[#5a1b22] pt-4 mt-2">
                <h3 className="text-xs font-semibold text-[#e3d2bd] mb-2">
                  Costos de compra (opcional)
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs text-[#e3d2bd]">
                      Costo proveedor (Q)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      className="w-full rounded-lg border border-[#6b232b] bg-[#2b0a0b]/80 px-3 py-2 text-sm placeholder-[#b39878] focus:outline-none focus:ring-2 focus:ring-[#d6b25f]"
                      placeholder="Ej. 500.00"
                      value={costoCompra}
                      onChange={(e) => setCostoCompra(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-[#e3d2bd]">
                      Costo envío (Q)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      className="w-full rounded-lg border border-[#6b232b] bg-[#2b0a0b]/80 px-3 py-2 text-sm placeholder-[#b39878] focus:outline-none focus:ring-2 focus:ring-[#d6b25f]"
                      placeholder="Ej. 50.00"
                      value={costoEnvio}
                      onChange={(e) => setCostoEnvio(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-[#e3d2bd]">
                      Impuestos (Q)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      className="w-full rounded-lg border border-[#6b232b] bg-[#2b0a0b]/80 px-3 py-2 text-sm placeholder-[#b39878] focus:outline-none focus:ring-2 focus:ring-[#d6b25f]"
                      placeholder="Ej. 30.00"
                      value={costoImpuestos}
                      onChange={(e) => setCostoImpuestos(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-[#e3d2bd]">
                      Desaduanaje (Q)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      className="w-full rounded-lg border border-[#6b232b] bg-[#2b0a0b]/80 px-3 py-2 text-sm placeholder-[#b39878] focus:outline-none focus:ring-2 focus:ring-[#d6b25f]"
                      placeholder="Ej. 20.00"
                      value={costoDesaduanaje}
                      onChange={(e) => setCostoDesaduanaje(e.target.value)}
                    />
                  </div>
                </div>
                <p className="mt-1 text-[11px] text-[#b39878]">
                  Estos costos se usan para calcular el valor del inventario y
                  el margen en el módulo de Inventario. Si los dejas en blanco,
                  se considerarán 0.
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-[#e3d2bd]">
                  Código de barras (opcional)
                </label>
                <div className="flex gap-2 flex-col md:flex-row">
                  <input
                    type="text"
                    className="flex-1 rounded-lg border border-[#6b232b] bg-[#2b0a0b]/80 px-3 py-2 text-sm placeholder-[#b39878] focus:outline-none focus:ring-2 focus:ring-[#d6b25f]"
                    placeholder="Si lo dejas vacío se generará uno automáticamente"
                    value={codigoBarras}
                    onChange={(e) => setCodigoBarras(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={generarCodigoBarras}
                    className="px-4 py-2 rounded-lg border border-[#d6b25f]/60 text-[#e3c578] text-sm hover:bg-[#3a0d12]/40"
                  >
                    Generar automático
                  </button>
                </div>
                <p className="text-[11px] text-[#b39878]">
                  Una vez guardado, este código queda asociado solo a este
                  producto y podrás usarlo para generar etiquetas de código de
                  barras e imprimirlas.
                </p>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full md:w-auto px-6 py-2.5 rounded-lg bg-[#d6b25f] hover:bg-[#e3c578] text-sm font-semibold text-[#2b0a0b] disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {saving ? "Guardando..." : "Guardar producto"}
                </button>
              </div>
            </form>
          </section>
        </main>
      </div>
    </div>
  );
}
