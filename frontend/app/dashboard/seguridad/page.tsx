"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeCanvas } from "qrcode.react";

const API_BASE_RAW = process.env.NEXT_PUBLIC_API_URL || "";
const API_BASE = API_BASE_RAW.replace(/\/+$/, "");

function buildApiUrl(path: string) {
  if (API_BASE) return `${API_BASE}${path}`;

  if (typeof window !== "undefined") {
    const isLocalhost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    if (!isLocalhost) return path;
  }

  return `http://localhost:4000${path}`;
}

function getAuthToken() {
  return (
    localStorage.getItem("joyeria_token") ||
    localStorage.getItem("token") ||
    localStorage.getItem("auth_token") ||
    localStorage.getItem("jwt") ||
    ""
  );
}

function getSecretFromOtpAuth(otpauthUrl: string): string {
  try {
    const parsed = new URL(otpauthUrl);
    return parsed.searchParams.get("secret") || "";
  } catch {
    return "";
  }
}

export default function SeguridadPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [mfaEnabled, setMfaEnabled] = useState<boolean>(false);
  const [isAdmin, setIsAdmin] = useState(true);

  const [setupLoading, setSetupLoading] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const [otpauthUrl, setOtpauthUrl] = useState<string>("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const token = useMemo(() => {
    if (typeof window === "undefined") return "";
    return getAuthToken();
  }, []);

  const secret = useMemo(() => getSecretFromOtpAuth(otpauthUrl), [otpauthUrl]);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        if (!token) {
          if (!alive) return;
          setLoading(false);
          return;
        }

        const res = await fetch(buildApiUrl("/api/auth/me"), {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => null);

        if (!alive) return;

        if (!res.ok || !data?.ok) {
          setError(data?.message || "No se pudo cargar el perfil.");
          setLoading(false);
          return;
        }

        const rol = String(data.user?.rol || "").trim().toUpperCase();
        setIsAdmin(rol === "ADMIN");
        setMfaEnabled(!!data.user?.mfa_enabled);
      } catch {
        if (!alive) return;
        setError("Error al conectar con el servidor.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    };

    load();
    return () => {
      alive = false;
    };
  }, [token]);

  const handleSetup = async () => {
    setError(null);
    setMsg(null);
    setOtpauthUrl("");
    setCode("");

    if (!token) {
      setError("No autenticado.");
      return;
    }

    try {
      setSetupLoading(true);

      const res = await fetch(buildApiUrl("/api/auth/mfa/setup"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok || !data?.otpauth_url) {
        setError(data?.message || "No se pudo iniciar la configuracion MFA.");
        return;
      }

      setOtpauthUrl(String(data.otpauth_url));
      setMsg("Escanee el QR con Authenticator y confirme el codigo.");
    } catch {
      setError("Error al conectar con el servidor.");
    } finally {
      setSetupLoading(false);
    }
  };

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMsg(null);

    const clean = code.replace(/\D/g, "").slice(0, 6);

    if (!token) {
      setError("No autenticado.");
      return;
    }
    if (!otpauthUrl) {
      setError("Primero debe generar la clave.");
      return;
    }
    if (clean.length !== 6) {
      setError("Ingrese un codigo de 6 digitos.");
      return;
    }

    try {
      setConfirmLoading(true);

      const res = await fetch(buildApiUrl("/api/auth/mfa/confirm"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: clean }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        setError(data?.message || "Codigo invalido.");
        return;
      }

      setMfaEnabled(true);
      setOtpauthUrl("");
      setCode("");
      setMsg("MFA activado correctamente.");
    } catch {
      setError("Error al conectar con el servidor.");
    } finally {
      setConfirmLoading(false);
    }
  };

  const copySecret = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setMsg("Clave secreta copiada.");
      setError(null);
    } catch {
      setError("No se pudo copiar automaticamente. Copiala manualmente.");
    }
  };

  const disabledSetup = loading || setupLoading || confirmLoading || mfaEnabled;
  const disabledConfirm = confirmLoading || setupLoading || !otpauthUrl;

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

            <h1 className="text-2xl font-semibold mb-1">Seguridad</h1>
            <p className="text-xs text-[#e3d2bd]">Configure MFA con Authenticator.</p>
          </div>

          {loading ? (
            <div className="text-[11px] text-[#c9b296] text-center">Cargando estado...</div>
          ) : !token ? (
            <div className="space-y-4 text-center">
              <div className="text-[11px] text-red-300 bg-red-900/30 border border-red-700 rounded-lg px-3 py-3 leading-relaxed">
                No autenticado. Inicie sesion para configurar seguridad.
              </div>
              <button
                type="button"
                onClick={() => router.push("/login")}
                className="w-full inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-[#d6b25f] via-[#e3c578] to-[#e8cf8f] px-4 py-2.5 text-sm font-semibold text-[#2b0a0b] shadow-lg shadow-[#2b0a0b]/40 transition-all"
              >
                Ir a Login
              </button>
            </div>
          ) : !isAdmin ? (
            <div className="space-y-4 text-center">
              <div className="text-[11px] text-red-300 bg-red-900/30 border border-red-700 rounded-lg px-3 py-3 leading-relaxed">
                Acceso restringido. MFA esta disponible unicamente para cuentas ADMIN.
              </div>
              <button
                type="button"
                onClick={() => router.push("/dashboard")}
                className="w-full inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-[#d6b25f] via-[#e3c578] to-[#e8cf8f] px-4 py-2.5 text-sm font-semibold text-[#2b0a0b] shadow-lg shadow-[#2b0a0b]/40 transition-all"
              >
                Volver
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-[11px] text-[#c9b296]">
                Estado MFA:{" "}
                <span className={mfaEnabled ? "text-[#e8cf8f] font-semibold" : "text-red-300 font-semibold"}>
                  {mfaEnabled ? "Activado" : "Desactivado"}
                </span>
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

              {!mfaEnabled && (
                <>
                  <button
                    type="button"
                    onClick={handleSetup}
                    disabled={disabledSetup}
                    className="w-full inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-[#d6b25f] via-[#e3c578] to-[#e8cf8f] disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-[#2b0a0b] shadow-lg shadow-[#2b0a0b]/40 transition-all"
                  >
                    {setupLoading ? "Generando..." : "Configurar MFA (Authenticator)"}
                  </button>

                  {otpauthUrl && (
                    <form onSubmit={handleConfirm} className="space-y-3">
                      <div className="rounded-2xl border border-[#6b232b] bg-[#2b0a0b]/70 p-3 space-y-2">
                        <div className="flex items-center justify-center mb-2">
                          <div className="rounded-xl bg-white p-2">
                            <QRCodeCanvas value={otpauthUrl} size={180} />
                          </div>
                        </div>
                        <p className="text-[11px] text-[#c9b296]">
                          Si no puede escanear, use la clave secreta manual:
                        </p>
                        <div className="font-mono text-xs text-[#f8f1e6] break-all">
                          {secret || "No se pudo extraer la clave secreta."}
                        </div>
                        <button
                          type="button"
                          onClick={copySecret}
                          className="inline-flex items-center justify-center rounded-lg border border-[#d6b25f]/60 bg-[#d6b25f]/10 hover:bg-[#d6b25f]/15 px-3 py-1.5 text-[11px] text-[#f8f1e6]"
                        >
                          Copiar clave
                        </button>
                      </div>

                      <div className="space-y-1">
                        <label className="block text-xs font-medium text-[#f1e4d4]">Codigo (6 digitos)</label>
                        <input
                          inputMode="numeric"
                          className="w-full rounded-xl border border-[#6b232b] bg-[#2b0a0b]/70 px-3 py-2.5 text-sm text-[#f8f1e6] placeholder-[#b39878] focus:outline-none focus:ring-2 focus:ring-[#d6b25f] focus:border-[#d6b25f]"
                          placeholder="123456"
                          value={code}
                          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                          autoComplete="one-time-code"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={disabledConfirm}
                        className="w-full inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-[#d6b25f] via-[#e3c578] to-[#e8cf8f] disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-[#2b0a0b] shadow-lg shadow-[#2b0a0b]/40 transition-all"
                      >
                        {confirmLoading ? "Confirmando..." : "Confirmar y activar MFA"}
                      </button>
                    </form>
                  )}
                </>
              )}

              <button
                type="button"
                onClick={() => router.push("/dashboard")}
                className="w-full text-[11px] text-[#e3c578] hover:opacity-90 underline underline-offset-4"
              >
                Volver
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
