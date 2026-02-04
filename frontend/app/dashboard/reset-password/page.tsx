"use client";

import Image from "next/image";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const API_URL =
  (process.env.NEXT_PUBLIC_API_URL &&
    process.env.NEXT_PUBLIC_API_URL.trim().replace(/\/$/, "")) ||
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:4000");

function ResetPasswordInner() {
  const router = useRouter();
  const sp = useSearchParams();

  const emailRaw = useMemo(() => sp.get("email") || "", [sp]);
  const tokenRaw = useMemo(() => sp.get("token") || "", [sp]);

  // ✅ normalización segura (sin cambiar UI)
  const email = useMemo(() => emailRaw.trim().toLowerCase(), [emailRaw]);
  const token = useMemo(() => tokenRaw.trim(), [tokenRaw]);

  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [invalidLink, setInvalidLink] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let alive = true;

    const validate = async () => {
      if (!email || !token) {
        if (!alive) return;
        setInvalidLink(true);
        setChecking(false);
        return;
      }

      try {
        const res = await fetch(
          `${API_URL}/api/auth/reset-password/validate?token=${encodeURIComponent(
            token
          )}&email=${encodeURIComponent(email)}`
        );

        // ✅ evita crash si no viene JSON
        const data = await res.json().catch(() => null);

        if (!alive) return;

        if (!res.ok || !data?.ok) {
          setInvalidLink(true);
        }
      } catch {
        if (!alive) return;
        setInvalidLink(true);
      } finally {
        if (!alive) return;
        setChecking(false);
      }
    };

    validate();

    return () => {
      alive = false;
    };
  }, [email, token]);

  const hasMinLength = newPassword.length >= 8;
  const hasUpper = /[A-Z]/.test(newPassword);
  const hasLower = /[a-z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const hasSymbol = /[^A-Za-z0-9]/.test(newPassword);
  const confirmTouched = newPassword2.length > 0;
  const confirmMatch = newPassword === newPassword2;

  // ✅ ULTRA PRO: reglas completas + confirmación
  const allRulesOk = hasMinLength && hasUpper && hasLower && hasNumber && hasSymbol;

  // ✅ ULTRA PRO: habilitar solo si cumple TODO, link válido, y no está cargando/validando
  const canSubmit =
    !checking && !invalidLink && !loading && allRulesOk && confirmTouched && confirmMatch;

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMsg(null);

    // ✅ ULTRA PRO: hard-guard (aunque intenten enviar con Enter / hacks)
    if (!canSubmit) return;

    if (!email || !token) {
      setInvalidLink(true);
      return;
    }

    try {
      setLoading(true);

      // ✅ ULTRA PRO: re-validar enlace justo antes de resetear (por si venció en la pantalla)
      const pre = await fetch(
        `${API_URL}/api/auth/reset-password/validate?token=${encodeURIComponent(
          token
        )}&email=${encodeURIComponent(email)}`
      );
      const preData = await pre.json().catch(() => null);

      if (!pre.ok || !preData?.ok) {
        setInvalidLink(true);
        return;
      }

      const res = await fetch(`${API_URL}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email, // ✅ ya viene normalizado
          token,
          newPassword,
        }),
      });

      // ✅ evita crash si no viene JSON
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        const msgText = String(data?.message || "No se pudo restablecer la contraseña.");

        // ✅ si es enlace inválido/vencido/ya usado, mandamos al flujo correcto
        if (msgText.toLowerCase().includes("enlace") || msgText.toLowerCase().includes("link")) {
          setInvalidLink(true);
          return;
        }

        setError(msgText);
        return;
      }

      setMsg(data?.message || "Contraseña actualizada correctamente.");
    } catch (err) {
      console.error(err);
      setError("Error al conectar con el servidor.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#2b0a0b] text-[#f8f1e6]">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-40 -left-24 h-72 w-72 rounded-full bg-[#d6b25f]/15 blur-3xl" />
        <div className="absolute -bottom-40 -right-24 h-72 w-72 rounded-full bg-[#c39a4c]/15 blur-3xl" />
      </div>

      <div className="w-full max-w-md px-4">
        <section className="relative bg-[#3a0d12]/95 border border-[#5a1b22] rounded-3xl shadow-2xl shadow-black/40 px-6 py-7 md:px-7 md:py-8">
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
            <h1 className="text-2xl font-semibold mb-1">Nueva contraseña</h1>
            <p className="text-xs text-[#e3d2bd]">
              Este enlace vence en 15 minutos y solo se usa una vez.
            </p>
          </div>

          {checking ? (
            <div className="text-[11px] text-[#c9b296] text-center">Validando enlace...</div>
          ) : invalidLink ? (
            <div className="space-y-5 text-center">
              <div className="text-[11px] text-red-300 bg-red-900/30 border border-red-700 rounded-lg px-3 py-3 leading-relaxed">
                Enlace inválido o vencido. Solicita uno nuevo.
              </div>
              <button
                type="button"
                onClick={() => router.push("/recuperar")}
                className="w-full inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-[#d6b25f] via-[#e3c578] to-[#e8cf8f] px-4 py-2.5 text-sm font-semibold text-[#2b0a0b] shadow-lg shadow-[#2b0a0b]/40 transition-all"
              >
                Recuperar contraseña
              </button>
            </div>
          ) : msg ? (
            <div className="space-y-5 text-center">
              <div className="text-[11px] text-[#e8cf8f] bg-[#d6b25f]/10 border border-[#d6b25f]/30 rounded-lg px-3 py-3 leading-relaxed">
                Contraseña definida con éxito.
              </div>
              <button
                type="button"
                onClick={() => router.push("/login")}
                className="w-full inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-[#d6b25f] via-[#e3c578] to-[#e8cf8f] px-4 py-2.5 text-sm font-semibold text-[#2b0a0b] shadow-lg shadow-[#2b0a0b]/40 transition-all"
              >
                Volver a iniciar sesión
              </button>
            </div>
          ) : (
            <form onSubmit={handleReset} className="space-y-4">
              <div className="text-[11px] text-[#c9b296]">
                Correo: <span className="text-[#e3c578]">{email || "(no encontrado)"}</span>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-[#f1e4d4]">
                  Nueva contraseña
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    className="w-full rounded-xl border border-[#6b232b] bg-[#2b0a0b]/70 px-3 py-2.5 pr-10 text-sm text-[#f8f1e6] placeholder-[#b39878] focus:outline-none focus:ring-2 focus:ring-[#d6b25f] focus:border-[#d6b25f]"
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-[#e3c578] hover:opacity-90"
                  >
                    {showPassword ? "Ocultar" : "Ver"}
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] text-[#c9b296] mt-2">
                  <div className={hasMinLength ? "text-[#e8cf8f]" : ""}>
                    {hasMinLength ? "✓" : "•"} Mínimo 8 caracteres
                  </div>
                  <div className={hasUpper ? "text-[#e8cf8f]" : ""}>
                    {hasUpper ? "✓" : "•"} Al menos 1 mayúscula
                  </div>
                  <div className={hasLower ? "text-[#e8cf8f]" : ""}>
                    {hasLower ? "✓" : "•"} Al menos 1 minúscula
                  </div>
                  <div className={hasNumber ? "text-[#e8cf8f]" : ""}>
                    {hasNumber ? "✓" : "•"} Al menos 1 número
                  </div>
                  <div className={hasSymbol ? "text-[#e8cf8f]" : ""}>
                    {hasSymbol ? "✓" : "•"} 1 símbolo
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-[#f1e4d4]">
                  Confirmar contraseña
                </label>
                <input
                  type={showPassword ? "text" : "password"}
                  className="w-full rounded-xl border border-[#6b232b] bg-[#2b0a0b]/70 px-3 py-2.5 text-sm text-[#f8f1e6] placeholder-[#b39878] focus:outline-none focus:ring-2 focus:ring-[#d6b25f] focus:border-[#d6b25f]"
                  placeholder="••••••••"
                  value={newPassword2}
                  onChange={(e) => setNewPassword2(e.target.value)}
                  autoComplete="new-password"
                />
                {confirmTouched && !confirmMatch && (
                  <div className="text-[11px] text-red-300">Las contraseñas no coinciden.</div>
                )}
              </div>

              {error && (
                <div className="text-[11px] text-red-300 bg-red-900/30 border border-red-700 rounded-lg px-3 py-2 leading-relaxed">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={!canSubmit}
                className="w-full inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-[#d6b25f] via-[#e3c578] to-[#e8cf8f] disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-[#2b0a0b] shadow-lg shadow-[#2b0a0b]/40 transition-all"
              >
                {loading ? "Estableciendo..." : "Establecer contraseña"}
              </button>

              <button
                type="button"
                onClick={() => router.push("/login")}
                className="w-full text-[11px] text-[#e3c578] hover:opacity-90 underline underline-offset-4"
              >
                Volver a iniciar sesión
              </button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#2b0a0b] text-[#f8f1e6]">
          <div className="text-[11px] text-[#c9b296] text-center">Cargando...</div>
        </div>
      }
    >
      <ResetPasswordInner />
    </Suspense>
  );
}

