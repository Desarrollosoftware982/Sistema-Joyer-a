"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";

// ✅ Si NO hay NEXT_PUBLIC_API_URL (recomendado en Render 1 servicio), usa rutas relativas: "/api/..."
// ✅ Si en local corres frontend separado, puedes setear NEXT_PUBLIC_API_URL="http://localhost:4000"
const API_BASE_RAW = process.env.NEXT_PUBLIC_API_URL || "";
const API_BASE = API_BASE_RAW.replace(/\/+$/, ""); // quita slash final si existe

function buildApiUrl(path: string) {
  // Si no hay base, en producción 1 servicio funciona perfecto con rutas relativas
  if (!API_BASE) return path;

  // Blindaje: si alguien puso NEXT_PUBLIC_API_URL terminando en "/api"
  // y el path ya empieza con "/api", evita duplicar "/api/api"
  if (API_BASE.endsWith("/api") && path.startsWith("/api/")) {
    return `${API_BASE}${path.replace(/^\/api/, "")}`;
  }

  return `${API_BASE}${path}`;
}

interface LoginResponse {
  ok: boolean;
  token?: string;
  mfaRequired?: boolean;
  mfaToken?: string;
  user?: {
    id: string;
    nombre: string;
    email: string;
    username?: string | null;
    rol: string;
  };
  message?: string;
}

export default function LoginPage() {
  const router = useRouter();

  // ✅ Antes: email. Ahora: identifier (usuario o correo)
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // ✅ MFA (solo cuando el backend lo pida)
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const getRedirectByRole = (rolRaw?: string) => {
    const rol = String(rolRaw || "").trim().toUpperCase();

    if (rol === "CAJERO") return "/caja";
    if (rol === "ADMIN") return "/dashboard";

    if (rol === "INVENTARIO") return "/dashboard/inventario";
    if (rol === "MAYORISTA") return "/dashboard";

    return "/dashboard";
  };

  const saveSessionAndRedirect = (data: LoginResponse) => {
    if (!data.token) return;

    localStorage.setItem("joyeria_token", data.token);
    if (data.user) localStorage.setItem("joyeria_user", JSON.stringify(data.user));

    const nextPath = getRedirectByRole(data.user?.rol);
    router.push(nextPath);
  };

  const handleVerifyMfa = async () => {
    setError(null);
    setInfo(null);

    if (!mfaToken) {
      setError("Falta el token de verificación MFA. Inicie sesión nuevamente.");
      setMfaRequired(false);
      return;
    }

    // ✅ PARCHE PRO: solo dígitos, máximo 6
    const codeClean = String(mfaCode || "").replace(/\D/g, "").slice(0, 6);

    if (codeClean.length !== 6) {
      setError("Ingrese un código válido (6 dígitos).");
      return;
    }

    try {
      setLoading(true);

      const res = await fetch(buildApiUrl("/api/auth/mfa/verify-login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mfaToken, code: codeClean }),
      });

      // ✅ evita crash si no viene JSON
      const data: LoginResponse = await res.json().catch(() => ({ ok: false }));

      if (!res.ok || !data.ok || !data.token) {
        setError(data.message || "Código inválido.");
        return;
      }

      saveSessionAndRedirect(data);
    } catch (err) {
      console.error(err);
      setError("Error al verificar el código.");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    // ✅ PARCHE PRO: si ya estamos en MFA, Enter / submit verifica el código
    if (mfaRequired) {
      await handleVerifyMfa();
      return;
    }

    if (!identifier || !password) {
      setError("Por favor ingrese usuario/correo y contraseña.");
      return;
    }

    try {
      setLoading(true);

      const res = await fetch(buildApiUrl("/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // ✅ Backend espera { identifier, password }
        body: JSON.stringify({ identifier, password }),
      });

      // ✅ evita crash si no viene JSON
      const data: LoginResponse = await res.json().catch(() => ({ ok: false }));

      if (!res.ok || !data.ok) {
        setError(data.message || "Credenciales inválidas.");
        return;
      }

      // ✅ Si pide MFA (ADMIN), mostramos el campo de código
      if (data.mfaRequired) {
        if (!data.mfaToken) {
          setError("No se recibió token MFA. Intente de nuevo.");
          return;
        }

        setMfaRequired(true);
        setMfaToken(data.mfaToken);
        setMfaCode("");
        setInfo("Ingrese el código de Google Authenticator para continuar.");
        return;
      }

      if (!data.token) {
        setError(data.message || "No se recibió token.");
        return;
      }

      saveSessionAndRedirect(data);
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
              <h1 className="text-2xl font-semibold font-display mb-1">
                Sistema Joyería
              </h1>
              <p className="text-xs text-[#e3d2bd]">
                Inicia sesión para acceder
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4" autoComplete="on">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-[#f1e4d4]">
                  Usuario
                </label>
                <input
                  type="text"
                  className="w-full rounded-xl border border-[#6b232b] bg-[#2b0a0b]/70 px-3 py-2.5 text-sm text-[#f8f1e6] placeholder-[#b39878] focus:outline-none focus:ring-2 focus:ring-[#d6b25f] focus:border-[#d6b25f]"
                  placeholder="admin o admin@joyeria.local"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  autoComplete="username"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-[#f1e4d4]">
                  Contraseña
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    className="w-full rounded-xl border border-[#6b232b] bg-[#2b0a0b]/70 px-3 py-2.5 pr-10 text-sm text-[#f8f1e6] placeholder-[#b39878] focus:outline-none focus:ring-2 focus:ring-[#d6b25f] focus:border-[#d6b25f]"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-[#e3c578] hover:opacity-90"
                  >
                    {showPassword ? "Ocultar" : "Ver"}
                  </button>
                </div>
              </div>

              {/* ? MFA step (aparece solo si backend lo pide) */}
              {mfaRequired && (
                <div className="fixed inset-0 z-50 flex items-center justify-center">
                  <div className="absolute inset-0 bg-[#2b0a0b]/70 backdrop-blur-sm">
                    <div className="absolute -top-32 -left-24 h-64 w-64 rounded-full bg-[#d6b25f]/10 blur-3xl" />
                    <div className="absolute -bottom-32 -right-24 h-64 w-64 rounded-full bg-[#c39a4c]/10 blur-3xl" />
                  </div>

                  <div className="relative w-full max-w-md mx-4 rounded-3xl border border-[#5a1b22] bg-[#3a0d12]/95 shadow-2xl shadow-black/50 px-6 py-7">
                    <h2 className="text-sm font-semibold text-[#f8f1e6] mb-3">
                      Codigo de Google Authenticator
                    </h2>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      className="w-full rounded-xl border border-[#6b232b] bg-[#2b0a0b]/70 px-3 py-2.5 text-sm text-[#f8f1e6] placeholder-[#b39878] focus:outline-none focus:ring-2 focus:ring-[#d6b25f] focus:border-[#d6b25f]"
                      placeholder="123456"
                      value={mfaCode}
                      // ? PARCHE PRO: solo digitos, maximo 6
                      onChange={(e) =>
                        setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                      }
                    />
                    <button
                      type="button"
                      onClick={handleVerifyMfa}
                      disabled={loading}
                      className="w-full mt-3 inline-flex items-center justify-center rounded-xl border border-[#d6b25f]/60 bg-[#d6b25f]/10 hover:bg-[#d6b25f]/15 disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-[#f8f1e6] transition-all"
                    >
                      {loading ? "Verificando codigo..." : "Verificar y entrar"}
                    </button>
                    {info && (
                      <div className="mt-3 text-[11px] text-[#e8cf8f] bg-[#d6b25f]/10 border border-[#d6b25f]/30 rounded-lg px-3 py-2 leading-relaxed">
                        {info}
                      </div>
                    )}
                    {error && (
                      <div className="mt-3 text-[11px] text-red-300 bg-red-900/30 border border-red-700 rounded-lg px-3 py-2 leading-relaxed">
                        {error}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {info && (
                <div className="text-[11px] text-[#e8cf8f] bg-[#d6b25f]/10 border border-[#d6b25f]/30 rounded-lg px-3 py-2 leading-relaxed">
                  {info}
                </div>
              )}

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
                {loading ? "Verificando credenciales..." : "Ingresar"}
              </button>

              {/* ? Boton de recuperacion */}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => router.push("/recuperar")}
                  className="text-[11px] text-[#e3c578] hover:opacity-90 underline underline-offset-4"
                >
                  Olvidaste tu contrasena?
                </button>
              </div>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
