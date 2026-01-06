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

export default function CategoriasPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [nombreNuevo, setNombreNuevo] = useState("");
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

  // Verificar sesión
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

  const cargarCategorias = async () => {
    if (!token) return;
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/api/catalog/categories`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Error al cargar categorías");
      const data = await res.json();
      const lista: Categoria[] = data.data || data;
      setCategorias(lista);
    } catch (err) {
      console.error(err);
      setError("No se pudieron cargar las categorías.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    cargarCategorias();
  }, [token]);

  const handleCrear = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setError(null);
    setSuccess(null);

    if (!nombreNuevo.trim()) {
      setError("El nombre de la categoría es obligatorio.");
      return;
    }

    try {
      setSaving(true);
      const res = await fetch(`${API_URL}/api/catalog/categories`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ nombre: nombreNuevo.trim() }),
      });

      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.message || "Error creando categoría");
      }

      const categoriaCreada: Categoria = data.data || data;

      setCategorias((prev) => [...prev, categoriaCreada]);
      setNombreNuevo("");
      setSuccess("Categoría creada correctamente.");
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

  const handleEliminar = async (id: string) => {
    if (!token) return;

    const confirmar = window.confirm(
      "¿Seguro que deseas eliminar esta categoría?"
    );
    if (!confirmar) return;

    try {
      const res = await fetch(`${API_URL}/api/catalog/categories/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.message || "Error eliminando categoría");
      }

      setCategorias((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      console.error(err);
      alert("No se pudo eliminar la categoría.");
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

            <p className="text-[11px] text-[#b39878]">
              Total categorías: {categorias.length}
            </p>
          </section>

          {/* Listado de categorías */}
          <section className="bg-[#3a0d12]/80 border border-[#5a1b22] rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold">Listado de categorías</h2>
            </div>

            {loading ? (
              <p className="text-sm text-[#c9b296]">
                Cargando categorías...
              </p>
            ) : categorias.length === 0 ? (
              <p className="text-sm text-[#b39878]">
                Aún no hay categorías registradas.
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
                    {categorias.map((cat) => (
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
