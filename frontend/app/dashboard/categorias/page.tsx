// frontend/app/dashboard/categorias/page.tsx
"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import AdminSidebar from "../../_components/AdminSidebar";

/**
 * ✅ En producción (mismo dominio): usa rutas relativas "/api/..."
 * ✅ En local: si defines NEXT_PUBLIC_API_URL / NEXT_PUBLIC_API_BASE_URL, lo respeta
 */
const API_BASE_RAW =
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "";
const API_BASE = API_BASE_RAW.replace(/\/+$/, "");

function buildApiUrl(path: string) {
  if (API_BASE) return `${API_BASE}${path}`;

  if (typeof window !== "undefined") {
    const isLocalhost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    if (!isLocalhost) return path; // "/api/..."
  }

  return `http://localhost:4000${path}`;
}

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

export default function CategoriasPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [busqueda, setBusqueda] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const today = new Date().toLocaleDateString("es-GT", {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  // ==========================
  // Helpers
  // ==========================
  const normalizeLite = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();

  // ✅ FIX: tipado estable para fetch (evita el union {} | { Authorization: string })
  const authHeaders = useMemo<Record<string, string>>(() => {
    if (!token) return {} as Record<string, string>;
    return { Authorization: `Bearer ${token}` };
  }, [token]);

  const handleLogout = () => {
    localStorage.removeItem("joyeria_token");
    localStorage.removeItem("joyeria_user");
    router.push("/login");
  };

  const handleAuthFail = () => {
    // Sesión vencida / token inválido
    handleLogout();
  };

  // ==========================
  // 1) Verificar sesión
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
      setUser(u);
      setToken(t);
    } catch {
      router.push("/login");
    }
  }, [router]);

  // ==========================
  // 2) Cargar categorías
  // ==========================
  const cargarCategorias = async (signal?: AbortSignal) => {
    if (!token) return;

    try {
      setError(null);
      setLoading(true);

      const res = await fetch(buildApiUrl(`/api/catalog/categories`), {
        headers: authHeaders,
        signal,
      });

      if (res.status === 401 || res.status === 403) {
        handleAuthFail();
        return;
      }

      if (!res.ok) throw new Error("Error al cargar categorías");

      const data = await res.json();
      const lista: Categoria[] = (data?.data ?? data) || [];

      // Orden bonito (alfabético)
      lista.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

      setCategorias(lista);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      console.error(err);
      setError("No se pudieron cargar las categorías.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    const ctrl = new AbortController();
    cargarCategorias(ctrl.signal);
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ==========================
  // 3) Crear categoría
  // ==========================
  const handleCrear = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setError(null);
    setSuccess(null);

    const nombre = nombreNuevo.trim();
    if (!nombre) {
      setError("El nombre de la categoría es obligatorio.");
      return;
    }

    // ✅ Bloqueo rápido de duplicados (case/acentos-insensitive)
    const nombreNorm = normalizeLite(nombre);
    const yaExisteLocal = categorias.some(
      (c) => normalizeLite(c.nombre) === nombreNorm
    );
    if (yaExisteLocal) {
      setError("Ya existe una categoría con ese nombre.");
      return;
    }

    try {
      setSaving(true);

      const res = await fetch(buildApiUrl(`/api/catalog/categories`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({ nombre }),
      });

      if (res.status === 401 || res.status === 403) {
        handleAuthFail();
        return;
      }

      const data = await res.json();

      if (!res.ok || data.ok === false) {
        throw new Error(data.message || "Error creando categoría");
      }

      const categoriaCreada: Categoria = data.data || data;

      setCategorias((prev) => {
        const next = [...prev, categoriaCreada];
        next.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
        return next;
      });

      setNombreNuevo("");
      setSuccess("Categoría creada correctamente.");
      // Se autodesvanece (porque la felicidad también debe tener TTL 😄)
      window.setTimeout(() => setSuccess(null), 2500);
    } catch (err: any) {
      console.error(err);
      setError(
        err?.message === "Ya existe una categoría con ese nombre"
          ? err.message
          : "No se pudo guardar la categoría."
      );
    } finally {
      setSaving(false);
    }
  };

  // ==========================
  // 4) Eliminar categoría
  // ==========================
  const handleEliminar = async (id: string) => {
    if (!token) return;

    const cat = categorias.find((c) => c.id === id);
    const confirmar = window.confirm(
      `¿Seguro que deseas eliminar la categoría${
        cat?.nombre ? `: "${cat.nombre}"` : ""
      }?`
    );
    if (!confirmar) return;

    setError(null);
    setSuccess(null);

    // Optimistic UI
    const snapshot = categorias;
    setCategorias((prev) => prev.filter((c) => c.id !== id));

    try {
      const res = await fetch(buildApiUrl(`/api/catalog/categories/${id}`), {
        method: "DELETE",
        headers: authHeaders,
      });

      if (res.status === 401 || res.status === 403) {
        handleAuthFail();
        return;
      }

      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.ok === false) {
        throw new Error(data.message || "Error eliminando categoría");
      }

      setSuccess("Categoría eliminada correctamente.");
      window.setTimeout(() => setSuccess(null), 2000);
    } catch (err: any) {
      console.error(err);
      // rollback
      setCategorias(snapshot);

      // Mensaje más útil
      setError(
        err?.message ||
          "No se pudo eliminar la categoría. Puede estar en uso por productos."
      );
    }
  };

  // ==========================
  // 5) Filtro
  // ==========================
  const categoriasFiltradas = useMemo(() => {
    const q = normalizeLite(busqueda);
    if (!q) return categorias;
    return categorias.filter((c) => normalizeLite(c.nombre).includes(q));
  }, [busqueda, categorias]);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#2b0a0b] text-[#f1e4d4]">
        Cargando sesión...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#2b0a0b] text-[#f8f1e6] flex">
      <AdminSidebar user={user} onLogout={handleLogout} />

      <div className="flex-1 flex flex-col">
        {/* Top bar */}
        <header className="border-b border-[#5a1b22] bg-[#2b0a0b]/80 backdrop-blur flex items-center justify-between px-4 md:px-8 py-4 sticky top-0 z-10">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold">Categorías</h1>
            <p className="text-xs md:text-sm text-[#c9b296] capitalize">
              {today}
            </p>
          </div>

          <button
            type="button"
            onClick={() => cargarCategorias()}
            className="hidden md:inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#d6b25f]/60 text-[11px] text-[#e3c578] hover:bg-[#d6b25f]/10"
            title="Refrescar"
          >
            Refrescar ↻
          </button>
        </header>

        <main className="flex-1 px-4 md:px-8 py-6 space-y-6">
          {/* Nueva categoría */}
          <section className="bg-[#3a0d12]/80 border border-[#5a1b22] rounded-2xl p-4 space-y-3">
            <h2 className="text-sm font-semibold">Nueva categoría</h2>

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

            <form
              onSubmit={handleCrear}
              className="flex flex-col md:flex-row gap-3 items-stretch md:items-center"
            >
              <input
                type="text"
                className="flex-1 rounded-lg border border-[#6b232b] bg-[#2b0a0b]/80 px-3 py-2 text-sm placeholder-[#b39878] focus:outline-none focus:ring-2 focus:ring-[#d6b25f]"
                placeholder="Ej. Anillos, Cadenas, Aretes..."
                value={nombreNuevo}
                onChange={(e) => setNombreNuevo(e.target.value)}
              />
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2.5 rounded-lg bg-[#d6b25f] hover:bg-[#e3c578] text-sm font-semibold text-[#2b0a0b] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {saving ? "Guardando..." : "Agregar"}
              </button>
            </form>

            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <p className="text-[11px] text-[#b39878]">
                Total categorías: {categorias.length}
              </p>

              <input
                type="text"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className="w-full md:w-72 rounded-lg border border-[#6b232b] bg-[#2b0a0b]/80 px-3 py-2 text-[12px] placeholder-[#b39878] focus:outline-none focus:ring-2 focus:ring-[#d6b25f]"
                placeholder="Buscar categoría…"
              />
            </div>
          </section>

          {/* Listado de categorías */}
          <section className="bg-[#3a0d12]/80 border border-[#5a1b22] rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold">Listado de categorías</h2>
              <span className="text-[11px] text-[#c9b296]">
                Mostrando: {categoriasFiltradas.length}
              </span>
            </div>

            {loading ? (
              <p className="text-sm text-[#c9b296]">Cargando categorías...</p>
            ) : categoriasFiltradas.length === 0 ? (
              <p className="text-sm text-[#b39878]">
                No hay categorías para mostrar.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#5a1b22] text-[#c9b296]">
                      <th className="text-left py-2 px-2">Nombre</th>
                      <th className="text-right py-2 px-2">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categoriasFiltradas.map((cat) => (
                      <tr
                        key={cat.id}
                        className="border-b border-[#3a0d12]/70 hover:bg-[#3a0d12]/60"
                      >
                        <td className="py-2 px-2 text-[#f8f1e6]">
                          {cat.nombre}
                        </td>
                        <td className="py-2 px-2 text-right">
                          <button
                            type="button"
                            onClick={() => handleEliminar(cat.id)}
                            className="px-3 py-1 rounded-full border border-red-500/70 text-[11px] text-red-300 hover:bg-red-900/40"
                          >
                            Eliminar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
