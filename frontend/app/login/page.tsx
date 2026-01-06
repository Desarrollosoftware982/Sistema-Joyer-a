"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface LoginResponse {
  ok: boolean;
  token?: string;
  user?: {
    id: string;
    nombre: string;
    email: string;
    rol: string;
  };
  message?: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@joyeria.local");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getRedirectByRole = (rolRaw?: string) => {
    const rol = String(rolRaw || "").trim().toUpperCase();

    if (rol === "CAJERO") return "/caja";
    if (rol === "ADMIN") return "/dashboard";

    // Opcionales (si existen en tu sistema)
    if (rol === "INVENTARIO") return "/dashboard/inventario";
    if (rol === "MAYORISTA") return "/dashboard";

    // Fallback seguro
    return "/dashboard";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email || !password) {
      setError("Por favor ingrese correo y contraseña.");
      return;
    }

    try {
      setLoading(true);

      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data: LoginResponse = await res.json();

      if (!res.ok || !data.ok || !data.token) {
        setError(data.message || "Credenciales inválidas.");
        return;
      }

      // Guardar sesión
      localStorage.setItem("joyeria_token", data.token);
      if (data.user) {
        localStorage.setItem("joyeria_user", JSON.stringify(data.user));
      }

      // ✅ Redirect por rol
      const nextPath = getRedirectByRole(data.user?.rol);

      // Si el rol viniera vacío por alguna razón, igual no te deja varado
      router.push(nextPath);
    } catch (err) {
      console.error(err);
      setError("Error al conectar con el servidor.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#2b0a0b] text-[#f8f1e6]">
      {/* fondo suave */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-40 -left-24 h-72 w-72 rounded-full bg-[#d6b25f]/15 blur-3xl" />
        <div className="absolute -bottom-40 -right-24 h-72 w-72 rounded-full bg-[#c39a4c]/15 blur-3xl" />
      </div>

      <div className="w-full max-w-md px-4">
        <section className="relative bg-[#3a0d12]/95 border border-[#5a1b22] rounded-3xl shadow-2xl shadow-black/40 px-6 py-7 md:px-7 md:py-8">
          {/* pequeño acento */}
          <div className="absolute -top-6 right-10 h-16 w-16 rounded-full bg-gradient-to-br from-[#d6b25f]/45 via-[#e8cf8f]/30 to-[#b98c3f]/25 blur-2xl opacity-70" />

          <div className="relative">
            <div className="mb-6 text-center">
              <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl border border-[#6b232b] bg-[#2b0a0b]/70">
                <Image
                  src="/logo-xuping-regina.png"
                  alt="Xuping Regina"
                  width={72}
                  height={72}
                  className="h-16 w-16 object-contain"
                  priority
                />
              </div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-[#e3c578] mb-2">
                Acceso seguro
              </p>
              <h1 className="text-2xl font-semibold font-display mb-1">
                Sistema Joyería
              </h1>
              <p className="text-xs text-[#e3d2bd]">
                Inicia sesión para acceder al panel de ventas e inventario.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4" autoComplete="on">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-[#f1e4d4]">
                  Correo electrónico
                </label>
                <input
                  type="email"
                  className="w-full rounded-xl border border-[#6b232b] bg-[#2b0a0b]/70 px-3 py-2.5 text-sm text-[#f8f1e6] placeholder-[#b39878] focus:outline-none focus:ring-2 focus:ring-[#d6b25f] focus:border-[#d6b25f]"
                  placeholder="admin@joyeria.local"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-[#f1e4d4]">
                  Contraseña
                </label>
                <input
                  type="password"
                  className="w-full rounded-xl border border-[#6b232b] bg-[#2b0a0b]/70 px-3 py-2.5 text-sm text-[#f8f1e6] placeholder-[#b39878] focus:outline-none focus:ring-2 focus:ring-[#d6b25f] focus:border-[#d6b25f]"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>

              {error && (
                <div className="text-[11px] text-red-300 bg-red-900/30 border border-red-700 rounded-lg px-3 py-2 leading-relaxed">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-[#d6b25f] via-[#e3c578] to-[#e8cf8f] hover:from-[#e3c578] hover:via-[#edd58a] hover:to-[#e8cf8f] disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-[#2b0a0b] shadow-lg shadow-[#2b0a0b]/40 transition-all"
              >
                {loading ? "Verificando credenciales..." : "Ingresar al panel"}
              </button>
            </form>

            <p className="mt-4 text-[11px] text-center text-[#c9b296] leading-relaxed">
              Acceso restringido a{" "}
              <span className="text-[#e3c578]">
                admin, cajero, inventario y mayoristas
              </span>
              .
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
