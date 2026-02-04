"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AdminSidebar from "../../_components/AdminSidebar";

const API_URL =
  (process.env.NEXT_PUBLIC_API_URL &&
    process.env.NEXT_PUBLIC_API_URL.trim().replace(/\/$/, "")) ||
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:4000");

interface User {
  id: string;
  nombre: string;
  username: string;
  email: string;
  activo: boolean;
  roles?: { id: string; nombre: string } | null;
  sucursales?: { id: string; nombre: string; codigo?: string } | null;
}

interface RoleItem {
  id: string;
  nombre: string;
}

interface SucursalItem {
  id: string;
  nombre: string;
  codigo?: string;
}

export default function UsuariosRolesConfigPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ id: string; nombre: string; email: string; rol: string } | null>(
    null
  );
  const [token, setToken] = useState<string | null>(null);

  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [sucursales, setSucursales] = useState<SucursalItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [editUser, setEditUser] = useState<User | null>(null);
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [rolId, setRolId] = useState("");
  const [sucursalId, setSucursalId] = useState("");

  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  useEffect(() => {
    const t = localStorage.getItem("joyeria_token");
    const uStr = localStorage.getItem("joyeria_user");

    if (!t || !uStr) {
      router.push("/login");
      return;
    }

    try {
      const u = JSON.parse(uStr);
      setUser({
        id: String(u?.id ?? ""),
        nombre: String(u?.nombre ?? "Usuario"),
        email: String(u?.email ?? ""),
        rol: String(u?.rol ?? u?.roleName ?? u?.role ?? ""),
      });
      setToken(t);
    } catch {
      router.push("/login");
    }
  }, [router]);

  const loadAll = async (tkn: string) => {
    try {
      setLoading(true);
      const [resUsers, resRoles, resSuc] = await Promise.all([
        fetch(`${API_URL}/api/admin/users`, {
          headers: { Authorization: `Bearer ${tkn}` },
        }),
        fetch(`${API_URL}/api/admin/roles`, {
          headers: { Authorization: `Bearer ${tkn}` },
        }),
        fetch(`${API_URL}/api/admin/sucursales`, {
          headers: { Authorization: `Bearer ${tkn}` },
        }),
      ]);

      if (resUsers.ok) {
        const data = await resUsers.json();
        setUsers(data.items || []);
      }
      if (resRoles.ok) {
        const data = await resRoles.json();
        setRoles(data.items || []);
      }
      if (resSuc.ok) {
        const data = await resSuc.json();
        setSucursales(data.items || []);
      }
    } catch (err) {
      console.error("Error cargando usuarios", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    loadAll(token);
  }, [token]);

  const rolOptions = useMemo(
    () => roles.map((r) => ({ value: r.id, label: r.nombre })),
    [roles]
  );

  const sucursalOptions = useMemo(
    () => sucursales.map((s) => ({ value: s.id, label: s.nombre, codigo: s.codigo })),
    [sucursales]
  );

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const rol = u.roles?.nombre || "";
      const suc = u.sucursales?.nombre || "";
      return (
        String(u.username || "").toLowerCase().includes(q) ||
        String(u.nombre || "").toLowerCase().includes(q) ||
        String(u.email || "").toLowerCase().includes(q) ||
        rol.toLowerCase().includes(q) ||
        suc.toLowerCase().includes(q)
      );
    });
  }, [users, search]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageUsers = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredUsers.slice(start, start + pageSize);
  }, [filteredUsers, safePage]);

  const beginEdit = (u: User) => {
    setEditUser(u);
    setNombre(u.nombre || "");
    setEmail(u.email || "");
    setRolId(u.roles?.id || "");
    setSucursalId(u.sucursales?.id || "");
    setMsg(null);
    setError(null);
  };

  const cancelEdit = () => {
    setEditUser(null);
    setNombre("");
    setEmail("");
    setRolId("");
    setSucursalId("");
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    setError(null);
    setMsg(null);

    if (!nombre.trim() || !email.trim() || !rolId) {
      setError("Completa nombre, correo y rol.");
      return;
    }

    try {
      setSaving(true);
      const res = await fetch(`${API_URL}/api/admin/users/${editUser.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          nombre: nombre.trim(),
          email: email.trim(),
          rolId,
          sucursalId: sucursalId || null,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.message || "No se pudo actualizar.");
        return;
      }

      setMsg("Usuario actualizado.");
      await loadAll(token || "");
    } catch (err) {
      console.error(err);
      setError("Error al conectar con el servidor.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (u: User) => {
    if (!token) return;
    const ok = window.confirm(`Eliminar usuario ${u.username || u.email}?`);
    if (!ok) return;

    try {
      const res = await fetch(`${API_URL}/api/admin/users/${u.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.message || "No se pudo eliminar.");
        return;
      }
      await loadAll(token);
    } catch (err) {
      console.error(err);
      setError("Error al conectar con el servidor.");
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
        Cargando sesion...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#2b0a0b] text-[#f8f1e6] flex">
      <AdminSidebar user={user} onLogout={handleLogout} />

      <div className="flex-1 flex flex-col">
        <header className="border-b border-[#5a1b22] bg-[#2b0a0b]/80 backdrop-blur flex items-center justify-between px-4 md:px-8 py-4 sticky top-0 z-10">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold">Usuarios y roles</h1>
            <p className="text-xs md:text-sm text-[#c9b296]">
              Administrar usuarios existentes
            </p>
          </div>
          <div className="text-xs text-[#c9b296]">{loading ? "Cargando..." : ""}</div>
        </header>

        <main className="flex-1 px-4 md:px-8 py-6 space-y-6">
          <section className="bg-[#3a0d12]/70 border border-[#5a1b22] rounded-2xl p-5 md:p-6">
            <h2 className="text-sm font-semibold mb-3">Usuarios</h2>

            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Buscar por usuario, nombre, correo, rol o sucursal"
                className="w-full md:max-w-sm rounded-xl border border-[#6b232b] bg-[#2b0a0b]/70 px-3 py-2 text-sm text-[#f8f1e6] placeholder-[#b39878] focus:outline-none focus:ring-2 focus:ring-[#d6b25f] focus:border-[#d6b25f]"
              />
              <div className="text-[11px] text-[#c9b296]">
                {filteredUsers.length} resultados
              </div>
            </div>

            {/* Tabla (md+) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="text-[#c9b296] border-b border-[#5a1b22]">
                    <th className="text-left py-2 pr-3">Usuario</th>
                    <th className="text-left py-2 pr-3">Nombre</th>
                    <th className="text-left py-2 pr-3">Correo</th>
                    <th className="text-left py-2 pr-3">Rol</th>
                    <th className="text-left py-2 pr-3">Sucursal</th>
                    <th className="text-left py-2 pr-3">Estado</th>
                    <th className="text-right py-2 pr-3">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length === 0 && !loading && (
                    <tr>
                      <td colSpan={7} className="py-4 text-center text-[#b39878]">
                        No hay usuarios registrados.
                      </td>
                    </tr>
                  )}
                  {pageUsers.map((u) => (
                    <tr key={u.id} className="border-b border-[#3a0d12]/60 hover:bg-[#3a0d12]/60">
                      <td className="py-2 pr-3 text-[#f8f1e6]">{u.username || "-"}</td>
                      <td className="py-2 pr-3">{u.nombre}</td>
                      <td className="py-2 pr-3">{u.email}</td>
                      <td className="py-2 pr-3">{u.roles?.nombre || "-"}</td>
                      <td className="py-2 pr-3">{u.sucursales?.nombre || "-"}</td>
                      <td className="py-2 pr-3">{u.activo ? "Activo" : "Inactivo"}</td>
                      <td className="py-2 pr-3 text-right space-x-2">
                        <button
                          type="button"
                          onClick={() => beginEdit(u)}
                          className="text-[11px] px-2 py-1 rounded-full border border-[#6b232b] hover:border-[#d6b25f] hover:text-[#d6b25f]"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(u)}
                          className="text-[11px] px-2 py-1 rounded-full border border-red-700 text-red-300 hover:text-red-200 hover:border-red-400"
                        >
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Cards (sm) */}
            <div className="md:hidden space-y-3">
              {filteredUsers.length === 0 && !loading && (
                <div className="py-4 text-center text-[#b39878]">No hay usuarios registrados.</div>
              )}
              {pageUsers.map((u) => (
                <div
                  key={u.id}
                  className="rounded-xl border border-[#5a1b22] bg-[#2b0a0b]/60 p-3 space-y-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[#f8f1e6]">
                        {u.nombre}
                      </div>
                      <div className="text-[11px] text-[#c9b296]">
                        {u.username || "-"}
                      </div>
                    </div>
                    <div className="text-[11px] text-[#c9b296]">
                      {u.activo ? "Activo" : "Inactivo"}
                    </div>
                  </div>

                  <div className="text-[11px] text-[#c9b296]">
                    {u.email}
                  </div>
                  <div className="text-[11px] text-[#c9b296]">
                    Rol: <span className="text-[#f8f1e6]">{u.roles?.nombre || "-"}</span>
                  </div>
                  <div className="text-[11px] text-[#c9b296]">
                    Sucursal:{" "}
                    <span className="text-[#f8f1e6]">{u.sucursales?.nombre || "-"}</span>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => beginEdit(u)}
                      className="text-[11px] px-2 py-1 rounded-full border border-[#6b232b] hover:border-[#d6b25f] hover:text-[#d6b25f]"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(u)}
                      className="text-[11px] px-2 py-1 rounded-full border border-red-700 text-red-300 hover:text-red-200 hover:border-red-400"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {filteredUsers.length > pageSize && (
              <div className="mt-4 flex items-center justify-between text-xs text-[#c9b296]">
                <span>
                  Pagina {safePage} de {totalPages}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={safePage === 1}
                    className="px-3 py-1 rounded-full border border-[#6b232b] disabled:opacity-50"
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safePage === totalPages}
                    className="px-3 py-1 rounded-full border border-[#6b232b] disabled:opacity-50"
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            )}
          </section>

          {editUser && (
            <div className="fixed inset-0 z-50 flex items-center justify-center md:static md:block">
              <div className="absolute inset-0 bg-[#2b0a0b]/70 backdrop-blur-sm md:hidden">
                <div className="absolute -top-32 -left-24 h-64 w-64 rounded-full bg-[#d6b25f]/10 blur-3xl" />
                <div className="absolute -bottom-32 -right-24 h-64 w-64 rounded-full bg-[#c39a4c]/10 blur-3xl" />
              </div>
              <section className="relative w-full max-w-md mx-4 md:max-w-none bg-[#3a0d12]/70 border border-[#5a1b22] rounded-2xl p-5 md:p-6">
              <h2 className="text-sm font-semibold mb-3">Editar usuario</h2>

              <form onSubmit={handleUpdate} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-[#f1e4d4]">Usuario</label>
                    <input
                      type="text"
                      value={editUser.username || ""}
                      disabled
                      className="w-full rounded-xl border border-[#6b232b] bg-[#2b0a0b]/60 px-3 py-2.5 text-sm text-[#b39878] cursor-not-allowed"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-[#f1e4d4]">
                      Nombre completo
                    </label>
                    <input
                      type="text"
                      value={nombre}
                      onChange={(e) => setNombre(e.target.value)}
                      className="w-full rounded-xl border border-[#6b232b] bg-[#2b0a0b]/70 px-3 py-2.5 text-sm text-[#f8f1e6]"
                      required
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-[#f1e4d4]">
                      Correo electronico
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-xl border border-[#6b232b] bg-[#2b0a0b]/70 px-3 py-2.5 text-sm text-[#f8f1e6]"
                      required
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-[#f1e4d4]">Rol</label>
                    <select
                      value={rolId}
                      onChange={(e) => setRolId(e.target.value)}
                      className="w-full rounded-xl border border-[#6b232b] bg-[#2b0a0b]/70 px-3 py-2.5 text-sm text-[#f8f1e6]"
                      required
                    >
                      <option value="">Selecciona un rol</option>
                      {rolOptions.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-[#f1e4d4]">Sucursal</label>
                    <select
                      value={sucursalId}
                      onChange={(e) => setSucursalId(e.target.value)}
                      className="w-full rounded-xl border border-[#6b232b] bg-[#2b0a0b]/70 px-3 py-2.5 text-sm text-[#f8f1e6]"
                    >
                      <option value="">Selecciona una sucursal</option>
                      {sucursalOptions.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}{s.codigo ? ` (${s.codigo})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {msg && (
                  <div className="text-[11px] text-[#e8cf8f] bg-[#d6b25f]/10 border border-[#d6b25f]/30 rounded-lg px-3 py-2 leading-relaxed">
                    {msg}
                  </div>
                )}

                {error && (
                  <div className="text-[11px] text-red-300 bg-red-900/30 border border-red-700 rounded-lg px-3 py-2 leading-relaxed">
                    {error}
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-[#d6b25f] via-[#e3c578] to-[#e8cf8f] disabled:opacity-60 disabled:cursor-not-allowed px-5 py-2.5 text-sm font-semibold text-[#2b0a0b] shadow-lg shadow-[#2b0a0b]/40 transition-all"
                  >
                    {saving ? "Guardando..." : "Guardar cambios"}
                  </button>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="text-[11px] px-3 py-2 rounded-full border border-[#6b232b] text-[#e3d2bd] hover:border-[#d6b25f] hover:text-[#d6b25f]"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

