"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const API_URL =
  (process.env.NEXT_PUBLIC_API_URL &&
    process.env.NEXT_PUBLIC_API_URL.trim().replace(/\/$/, "")) ||
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:4000");

// ✅ Cooldown UI (fallback si backend no manda cooldownUntil)
const COOLDOWN_SECONDS = 120;

// ✅ PRO: cooldown por correo (key por email)
const COOLDOWN_KEY_PREFIX = "xuping_forgotpwd_cooldown_until:";

// ✅ PRO+: recordar último correo enviado (para mantener cooldown aunque limpies el input)
const LAST_EMAIL_KEY = "xuping_forgotpwd_last_email";

const cooldownKeyForEmail = (rawEmail: string) => {
  const clean = String(rawEmail || "").trim().toLowerCase();
  return `${COOLDOWN_KEY_PREFIX}${clean || "no-email"}`;
};

export default function RecuperarPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ✅ cooldown en segundos (no se muestra, solo deshabilita)
  const [cooldown, setCooldown] = useState(0);

  // ✅ PRO+: último correo enviado (para no perder cooldown si limpiamos el input)
  const [lastEmailSent, setLastEmailSent] = useState("");

  // ✅ PRO+: al montar, recuperar lastEmailSent (si existe)
  useEffect(() => {
    try {
      const last = localStorage.getItem(LAST_EMAIL_KEY) || "";
      if (last) setLastEmailSent(String(last));
    } catch {
      // ignore
    }
  }, []);

  // ✅ PRO/PRO+: cuando cambia el email (o lastEmailSent), revisar cooldown del correo “activo”
  // - Si hay texto en input: usamos ese correo
  // - Si el input está vacío: usamos lastEmailSent (para que el botón siga bloqueado)
  useEffect(() => {
    const emailClean = email.trim().toLowerCase();
    const effectiveEmail = emailClean || lastEmailSent;

    if (!effectiveEmail) {
      setCooldown(0);
      return;
    }

    try {
      const key = cooldownKeyForEmail(effectiveEmail);
      const untilRaw = localStorage.getItem(key);
      const until = untilRaw ? Number(untilRaw) : 0;

      if (until && until > Date.now()) {
        const remaining = Math.ceil((until - Date.now()) / 1000);
        setCooldown(remaining);

        // ✅ PRO+: si el cooldown viene del correo que el usuario escribió, guardarlo como lastEmailSent
        if (emailClean && emailClean !== lastEmailSent) {
          setLastEmailSent(emailClean);
          try {
            localStorage.setItem(LAST_EMAIL_KEY, emailClean);
          } catch {
            // ignore
          }
        }
      } else {
        // si ya venció, limpiamos esa key
        localStorage.removeItem(key);

        // si el input está vacío y el lastEmailSent ya no tiene cooldown, desbloquea
        if (!emailClean) setCooldown(0);
      }
    } catch {
      // ignore
    }
  }, [email, lastEmailSent]);

  // ✅ tick 1s (sin interval permanente)
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // ✅ PRO+: cuando cooldown llega a 0, solo limpiamos si de verdad ya venció el cooldown del lastEmailSent
  useEffect(() => {
    if (cooldown !== 0) return;
    if (!lastEmailSent) return;

    try {
      const key = cooldownKeyForEmail(lastEmailSent);
      const untilRaw = localStorage.getItem(key);
      const until = untilRaw ? Number(untilRaw) : 0;

      if (!until || until <= Date.now()) {
        localStorage.removeItem(key);
        localStorage.removeItem(LAST_EMAIL_KEY);
        // mantenemos el estado consistente
        setLastEmailSent("");
      }
    } catch {
      // ignore
    }
  }, [cooldown, lastEmailSent]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMsg(null);

    // ✅ si está en cooldown, no hacemos nada (aunque el botón ya está disabled)
    if (cooldown > 0) return;

    const emailClean = email.trim().toLowerCase();

    if (!emailClean) {
      setError("Ingrese su correo.");
      return;
    }

    try {
      setLoading(true);

      const res = await fetch(`${API_URL}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailClean }),
      });

      const data = await res.json().catch(() => null);

      // Si rate-limit u otro error (por si acaso)
      if (!res.ok) {
        setError(data?.message || "Espere un momento e intente de nuevo.");
        return;
      }

      // Respuesta genérica (anti-enumeración)
      setMsg(data?.message || "Si el correo existe, se enviará un enlace de recuperación.");

      // ✅ PRO+: guardar lastEmailSent ANTES de limpiar input
      setLastEmailSent(emailClean);
      try {
        localStorage.setItem(LAST_EMAIL_KEY, emailClean);
      } catch {
        // ignore
      }

      // ✅ AQUI está el cambio mínimo: usar cooldownUntil del backend si viene
      const untilFromBackend = Number(data?.cooldownUntil) || 0;
      const untilFallback = Date.now() + COOLDOWN_SECONDS * 1000;
      const until = untilFromBackend > Date.now() ? untilFromBackend : untilFallback;

      // ✅ setCooldown basado en until real
      setCooldown(Math.ceil((until - Date.now()) / 1000));

      // ✅ persistir cooldown POR CORREO usando until real
      try {
        localStorage.setItem(cooldownKeyForEmail(emailClean), String(until));
      } catch {
        // ignore
      }

      // ✅ limpiar el input del correo después de enviar
      setEmail("");
    } catch (err) {
      console.error(err);
      setError("Error al conectar con el servidor.");
    } finally {
      setLoading(false);
    }
  };

  const disabled = loading || cooldown > 0;

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
            <h1 className="text-2xl font-semibold mb-1">Recuperar contraseña</h1>
            <p className="text-xs text-[#e3d2bd]">
              Le enviaremos un enlace que vence en 15 minutos.
            </p>
          </div>

          <form onSubmit={handleSend} className="space-y-4">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-[#f1e4d4]">
                Correo electrónico
              </label>
              <input
                type="email"
                className="w-full rounded-xl border border-[#6b232b] bg-[#2b0a0b]/70 px-3 py-2.5 text-sm text-[#f8f1e6] placeholder-[#b39878] focus:outline-none focus:ring-2 focus:ring-[#d6b25f] focus:border-[#d6b25f]"
                placeholder="tu-correo@dominio.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
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
              disabled={disabled}
              className="w-full inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-[#d6b25f] via-[#e3c578] to-[#e8cf8f] disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-[#2b0a0b] shadow-lg shadow-[#2b0a0b]/40 transition-all"
            >
              {loading ? "Enviando..." : "Enviar enlace"}
            </button>

            <button
              type="button"
              onClick={() => router.push("/login")}
              className="w-full text-[11px] text-[#e3c578] hover:opacity-90 underline underline-offset-4"
            >
              Volver al inicio de sesión
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

