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
  email: string;
  rol: string;
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

export default function UsuariosRolesPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [sucursales, setSucursales] = useState<SucursalItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [nombre, setNombre] = useState("");
  const [username, setUsername] = useState("");
  const [usernameManual, setUsernameManual] = useState(false);
  const [email, setEmail] = useState("");
  const [rolId, setRolId] = useState("");
  const [sucursalId, setSucursalId] = useState("");
  const [password, setPassword] = useState("");

  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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

    const loadLists = async () => {
      try {
        setLoading(true);
        const [resRoles, resSuc] = await Promise.all([
          fetch(`${API_URL}/api/admin/roles`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${API_URL}/api/admin/sucursales`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);

        if (resRoles.ok) {
          const data = await resRoles.json();
          setRoles(data.items || []);
        }

        if (resSuc.ok) {
          const data = await resSuc.json();
          setSucursales(data.items || []);
        }
      } catch (err) {
        console.error("Error cargando listas", err);
      } finally {
        setLoading(false);
      }
    };

    loadLists();
  }, [token]);

  const generateUsername = (fullName: string) => {
    const base = String(fullName || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    if (!base) return "";

    const parts = base.split(/[^a-z0-9]+/g).filter(Boolean);
    if (parts.length === 0) return "";
    if (parts.length === 1) return parts[0];

    const first = parts[0];
    const last = parts[parts.length - 1];
    const firstInitial = first[0] || "";

    const candidate = `${firstInitial}${last}`;
    return candidate || "";
  };

  useEffect(() => {
    if (!nombre.trim()) {
      setUsername("");
      setUsernameManual(false);
      return;
    }

    if (!usernameManual) {
      setUsername(generateUsername(nombre));
    }
  }, [nombre, usernameManual]);

  const rolOptions = useMemo(
    () => roles.map((r) => ({ value: r.id, label: r.nombre })),
    [roles]
  );

  const sucursalOptions = useMemo(
    () => sucursales.map((s) => ({ value: s.id, label: s.nombre, codigo: s.codigo })),
    [sucursales]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMsg(null);

    if (!nombre.trim() || !email.trim() || !rolId || !username.trim()) {
      setError("Completa usuario, nombre, correo y rol.");
      return;
    }

    if (password && password.length < 8) {
      setError("La contrasena debe tener minimo 8 caracteres.");
      return;
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(username.trim())) {
      setError("El usuario solo permite letras, numeros, punto, guion y guion bajo.");
      return;
    }

    try {
      setSaving(true);
      const res = await fetch(`${API_URL}/api/admin/users/invite`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          nombre: nombre.trim(),
          username: username.trim(),
          email: email.trim(),
          rolId,
          sucursalId: sucursalId || null,
          password: password ? password : null,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        setError(data.message || "No se pudo crear el usuario.");
        return;
      }

      const createdUsername = data?.user?.username ? ` (${data.user.username})` : "";
      const warning = data?.emailWarning ? ` ${data.emailWarning}` : "";
      setMsg(`Usuario creado correctamente${createdUsername}.${warning}`);

      setNombre("");
      setUsername("");
      setUsernameManual(false);
      setEmail("");
      setRolId("");
      setSucursalId("");
      setPassword("");
    } catch (err) {
      console.error(err);
      setError("Error al conectar con el servidor.");
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
            <h1 className="text-xl md:text-2xl font-semibold">Usuarios & Roles</h1>
            <p className="text-xs md:text-sm text-[#c9b296]">
              Crea usuarios y enviales enlace para establecer su contrasena
            </p>
          </div>
          <div className="text-xs text-[#c9b296]">
            {loading ? "Cargando catalogos..." : ""}
          </div>
        </header>

        <main className="flex-1 px-4 md:px-8 py-6">
          <section className="max-w-3xl">
            <div className="bg-[#3a0d12]/70 border border-[#5a1b22] rounded-2xl p-5 md:p-6">
              <h2 className="text-sm font-semibold mb-2">Asignar nuevo usuario</h2>
              <p className="text-xs text-[#c9b296] mb-4">
                El usuario se genera automaticamente a partir del nombre completo.
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-[#f1e4d4]">
                      Usuario
                    </label>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => {
                        setUsername(e.target.value);
                        setUsernameManual(true);
                      }}
                      className="w-full rounded-xl border border-[#6b232b] bg-[#2b0a0b]/70 px-3 py-2.5 text-sm text-[#f8f1e6] placeholder-[#b39878] focus:outline-none focus:ring-2 focus:ring-[#d6b25f] focus:border-[#d6b25f]"
                      placeholder="p.ej. jvelasquez"
                      required
                    />
                    <p className="text-[11px] text-[#c9b296]">
                      Solo letras/numeros y . _ -
                    </p>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-[#f1e4d4]">
                      Nombre completo
                    </label>
                    <input
                      type="text"
                      value={nombre}
                      onChange={(e) => setNombre(e.target.value)}
                      className="w-full rounded-xl border border-[#6b232b] bg-[#2b0a0b]/70 px-3 py-2.5 text-sm text-[#f8f1e6] placeholder-[#b39878] focus:outline-none focus:ring-2 focus:ring-[#d6b25f] focus:border-[#d6b25f]"
                      placeholder="Ej: Maria Perez"
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
                      className="w-full rounded-xl border border-[#6b232b] bg-[#2b0a0b]/70 px-3 py-2.5 text-sm text-[#f8f1e6] placeholder-[#b39878] focus:outline-none focus:ring-2 focus:ring-[#d6b25f] focus:border-[#d6b25f]"
                      placeholder="usuario@correo.com"
                      required
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-[#f1e4d4]">Rol</label>
                    <select
                      value={rolId}
                      onChange={(e) => setRolId(e.target.value)}
                      className="w-full rounded-xl border border-[#6b232b] bg-[#2b0a0b]/70 px-3 py-2.5 text-sm text-[#f8f1e6] focus:outline-none focus:ring-2 focus:ring-[#d6b25f] focus:border-[#d6b25f]"
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
                    <label className="block text-xs font-medium text-[#f1e4d4]">
                      Sucursal
                    </label>
                    <select
                      value={sucursalId}
                      onChange={(e) => setSucursalId(e.target.value)}
                      className="w-full rounded-xl border border-[#6b232b] bg-[#2b0a0b]/70 px-3 py-2.5 text-sm text-[#f8f1e6] focus:outline-none focus:ring-2 focus:ring-[#d6b25f] focus:border-[#d6b25f]"
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

                <div className="space-y-1">
                  <label className="block text-xs font-medium text-[#f1e4d4]">
                    Contrasena (opcional)
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-[#6b232b] bg-[#2b0a0b]/70 px-3 py-2.5 text-sm text-[#f8f1e6] placeholder-[#b39878] focus:outline-none focus:ring-2 focus:ring-[#d6b25f] focus:border-[#d6b25f]"
                    placeholder="8 a 16 caracteres"
                  />
                  <p className="text-[11px] text-[#c9b296]">
                    Minimo 8 caracteres. Si no ingresas contrasena, se enviara un enlace valido por 15 minutos.
                  </p>
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

                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-[#d6b25f] via-[#e3c578] to-[#e8cf8f] disabled:opacity-60 disabled:cursor-not-allowed px-5 py-2.5 text-sm font-semibold text-[#2b0a0b] shadow-lg shadow-[#2b0a0b]/40 transition-all"
                >
                  {saving ? "Creando..." : "Crear usuario"}
                </button>
              </form>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

