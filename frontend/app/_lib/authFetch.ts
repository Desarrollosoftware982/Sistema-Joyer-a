// frontend/app/_lib/authFetch.ts
const API_URL =
  (process.env.NEXT_PUBLIC_API_URL &&
    process.env.NEXT_PUBLIC_API_URL.trim().replace(/\/$/, "")) ||
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:4000");

export function getToken(): string | null {
  if (typeof window === "undefined") return null;

  const keys = ["token", "authToken", "accessToken", "jwt", "joyeria_token"];

  for (const k of keys) {
    const v = localStorage.getItem(k);
    if (v && v.trim()) return v.trim();
  }

  // fallback por si lo guardaste en sessionStorage
  for (const k of keys) {
    const v = sessionStorage.getItem(k);
    if (v && v.trim()) return v.trim();
  }

  return null;
}

export function authHeaders(extra?: Record<string, string>) {
  const token = getToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(extra || {}),
  };
}

export async function authFetch(path: string, init: RequestInit = {}) {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: authHeaders((init.headers as any) || {}),
  });
}

