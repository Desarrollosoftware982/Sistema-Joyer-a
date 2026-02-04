"use client";

import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";

interface User {
  id: string;
  nombre: string;
  email: string;
  rol: string;
}

/**
 * ✅ A + B:
 * - user y onLogout opcionales (no rompe pantallas que sí los envían).
 * - Si faltan, leemos user desde localStorage ("joyeria_user").
 * - Logout fallback limpia token/user y manda a /login.
 */
interface AdminSidebarProps {
  user?: User | null;
  onLogout?: () => void;
}

export default function AdminSidebar({ user, onLogout }: AdminSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false); // sólo escritorio
  const [mobileOpen, setMobileOpen] = useState(false); // sólo móvil

  // ✅ B: Auto-user desde localStorage si no viene por props
  const safeUser: User = useMemo(() => {
    if (user?.id) return user;

    if (typeof window !== "undefined") {
      const raw = localStorage.getItem("joyeria_user");
      if (raw) {
        try {
          const u: any = JSON.parse(raw);

          return {
            id: String(u?.id ?? ""),
            nombre: String(u?.nombre ?? "Usuario"),
            email: String(u?.email ?? ""),
            // soporta varias llaves por si alguna pantalla guardó distinto
            rol: String(u?.rol ?? u?.roleName ?? u?.role ?? u?.rolNombre ?? ""),
          };
        } catch {
          // si está corrupto, caemos al fallback
        }
      }
    }

    return { id: "", nombre: "Usuario", email: "", rol: "" };
  }, [user]);

  // ✅ B: Logout fallback consistente con Bearer/localStorage
  const safeLogout =
    onLogout ??
    (() => {
      try {
        localStorage.removeItem("joyeria_token");
        localStorage.removeItem("joyeria_user");
      } catch {}
      router.push("/login");
    });

  // ✅ Normalizar rol
  const rolNorm = String(safeUser?.rol || "").trim().toUpperCase();
  const isAdmin = rolNorm === "ADMIN";
  const isCajero = rolNorm === "CAJERO";

  // ✅ Menús separados por rol (NO se mezclan)
  const mainNav = useMemo(() => {
    if (isCajero) {
      return [
        { label: "Caja (Apertura / POS)", path: "/caja" },
        { label: "Resumen", path: "/caja/resumen" },
        { label: "Reportes de Ventas", path: "/caja/reportes" },
        { label: "Cotizaciones", path: "/caja/cotizaciones" },
        { label: "Caja chica", path: "/caja/caja-chica" },
      ];
    }

    return [
      { label: "Dashboard", path: "/dashboard" },
      { label: "POS - Caja", path: "/dashboard/pos" },
      { label: "Ventas", path: "/dashboard/ventas" },
      { label: "Inventario", path: "/dashboard/inventario" },
      { label: "Reportes", path: "/dashboard/reportes" },
      { label: "Caja chica", path: "/dashboard/caja-chica" },
    ];
  }, [isCajero]);

  // ✅ Administración SOLO ADMIN
  const adminNav = useMemo(() => {
    if (!isAdmin) return [];
    return [
      { label: "Compras", path: "/dashboard/compras" },
      { label: "Productos", path: "/dashboard/productos" },
      { label: "Categorías", path: "/dashboard/categorias" },
      { label: "Registrar usuarios", path: "/dashboard/usuarios" },
      { label: "Usuarios y roles", path: "/dashboard/configuracion" },
      { label: "Perfil/Seguridad", path: "/dashboard/seguridad" },
    ];
  }, [isAdmin]);

  const goTo = (path: string) => {
    if (pathname === path) return;
    router.push(path);
  };

  // ✅ Evita que "/dashboard" o "/caja" se queden activos al entrar a subrutas
  const isActive = (path: string) => {
    if (path === "/dashboard" || path === "/caja") return pathname === path;
    return pathname === path || pathname.startsWith(path + "/");
  };

  const panelTitle = isAdmin ? "Panel Administrativo" : isCajero ? "Panel de Caja" : "Panel";

  return (
    <>
      {/* ====== ESCRITORIO (md+) ====== */}

      {collapsed && (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="hidden md:inline-flex fixed left-3 top-3 z-40 h-9 w-9 items-center justify-center rounded-full border border-[#6b232b] bg-[#3a0d12]/90 hover:bg-[#4b141a]"
        >
          <span className="sr-only">Abrir menú</span>
          <div className="space-y-[3px]">
            <span className="block h-[2px] w-4 rounded-full bg-[#f1e4d4]" />
            <span className="block h-[2px] w-4 rounded-full bg-[#f1e4d4]" />
            <span className="block h-[2px] w-4 rounded-full bg-[#f1e4d4]" />
          </div>
        </button>
      )}

      {!collapsed && (
        <aside className="hidden md:flex md:flex-col w-64 min-h-screen border-r border-[#5a1b22] bg-[#2b0a0b]/90">
          <div className="px-6 py-5 border-b border-[#5a1b22] flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.15em] text-[#d6b25f]">Joyería</div>
              <div className="text-lg font-semibold text-[#f8f1e6]">{panelTitle}</div>
            </div>

            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#6b232b] bg-[#3a0d12] hover:bg-[#4b141a]"
            >
              <span className="sr-only">Contraer menú</span>
              <div className="space-y-[3px]">
                <span className="block h-[2px] w-4 rounded-full bg-[#e3d2bd]" />
                <span className="block h-[2px] w-4 rounded-full bg-[#e3d2bd]" />
                <span className="block h-[2px] w-4 rounded-full bg-[#e3d2bd]" />
              </div>
            </button>
          </div>

          <nav className="flex-1 px-3 py-4 space-y-1 text-sm">
            <div className="text-xs uppercase text-[#b39878] px-3 mb-1">Principal</div>

            {mainNav.map((item) => {
              const active = isActive(item.path);
              return (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => goTo(item.path)}
                  className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                    active
                      ? "bg-[#4b141a] text-[#d6b25f] font-medium"
                      : "hover:bg-[#3a0d12]/60 text-[#e3d2bd]"
                  }`}
                >
                  {active && <span className="inline-block h-2 w-2 rounded-full bg-[#d6b25f]" />}
                  <span>{item.label}</span>
                </button>
              );
            })}

            {isAdmin && adminNav.length > 0 && (
              <>
                <div className="text-xs uppercase text-[#b39878] px-3 mt-4 mb-1">
                  Administración
                </div>

                {adminNav.map((item) => {
                  const active = isActive(item.path);
                  return (
                    <button
                      key={item.path}
                      type="button"
                      onClick={() => goTo(item.path)}
                      className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                        active
                          ? "bg-[#4b141a] text-[#d6b25f] font-medium"
                          : "hover:bg-[#3a0d12]/60 text-[#e3d2bd]"
                      }`}
                    >
                      {active && (
                        <span className="inline-block h-2 w-2 rounded-full bg-[#d6b25f]" />
                      )}
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </>
            )}
          </nav>

          <div className="border-t border-[#5a1b22] px-4 py-4 text-xs text-[#c9b296] flex items-center justify-between">
            <div>
              <div className="font-medium text-[#f1e4d4] truncate">{safeUser.nombre}</div>
              <div className="text-[11px] text-[#d6b25f]">{rolNorm || "—"}</div>
            </div>
            <button
              type="button"
              onClick={safeLogout}
              className="text-[11px] px-3 py-1 rounded-full border border-[#6b232b] hover:border-red-500 hover:text-red-400 transition-colors"
            >
              Cerrar sesión
            </button>
          </div>
        </aside>
      )}

      {/* ====== MÓVIL (sm) ====== */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed bottom-4 right-4 z-40 flex md:hidden h-10 w-10 items-center justify-center rounded-full border border-[#6b232b] bg-[#3a0d12]/90 shadow-lg shadow-black/40"
      >
        <span className="sr-only">Abrir menú</span>
        <div className="space-y-[3px]">
          <span className="block h-[2px] w-4 rounded-full bg-[#f1e4d4]" />
          <span className="block h-[2px] w-4 rounded-full bg-[#f1e4d4]" />
          <span className="block h-[2px] w-4 rounded-full bg-[#f1e4d4]" />
        </div>
      </button>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="w-64 min-h-screen bg-[#2b0a0b] border-r border-[#5a1b22] flex flex-col">
            <div className="px-6 py-5 border-b border-[#5a1b22] flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.15em] text-[#d6b25f]">Joyería</div>
                <div className="text-lg font-semibold text-[#f8f1e6]">{panelTitle}</div>
              </div>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#6b232b] bg-[#3a0d12] hover:bg-[#4b141a]"
              >
                <span className="sr-only">Cerrar menú</span>
                <span className="block h-[2px] w-4 bg-[#e3d2bd] rounded-full rotate-45 translate-y-[1px]" />
                <span className="block h-[2px] w-4 bg-[#e3d2bd] rounded-full -rotate-45 -translate-y-[1px]" />
              </button>
            </div>

            <nav className="flex-1 px-3 py-4 space-y-1 text-sm overflow-y-auto">
              <div className="text-xs uppercase text-[#b39878] px-3 mb-1">Principal</div>

              {mainNav.map((item) => {
                const active = isActive(item.path);
                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => {
                      goTo(item.path);
                      setMobileOpen(false);
                    }}
                    className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                      active
                        ? "bg-[#4b141a] text-[#d6b25f] font-medium"
                        : "hover:bg-[#3a0d12]/60 text-[#e3d2bd]"
                    }`}
                  >
                    {active && <span className="inline-block h-2 w-2 rounded-full bg-[#d6b25f]" />}
                    <span>{item.label}</span>
                  </button>
                );
              })}

              {isAdmin && adminNav.length > 0 && (
                <>
                  <div className="text-xs uppercase text-[#b39878] px-3 mt-4 mb-1">
                    Administración
                  </div>

                  {adminNav.map((item) => {
                    const active = isActive(item.path);
                    return (
                      <button
                        key={item.path}
                        type="button"
                        onClick={() => {
                          goTo(item.path);
                          setMobileOpen(false);
                        }}
                        className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                          active
                            ? "bg-[#4b141a] text-[#d6b25f] font-medium"
                            : "hover:bg-[#3a0d12]/60 text-[#e3d2bd]"
                        }`}
                      >
                        {active && (
                          <span className="inline-block h-2 w-2 rounded-full bg-[#d6b25f]" />
                        )}
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </>
              )}
            </nav>

            <div className="border-t border-[#5a1b22] px-4 py-4 text-xs text-[#c9b296] flex items-center justify-between">
              <div>
                <div className="font-medium text-[#f1e4d4] truncate">{safeUser.nombre}</div>
                <div className="text-[11px] text-[#d6b25f]">{rolNorm || "—"}</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMobileOpen(false);
                  safeLogout();
                }}
                className="text-[11px] px-3 py-1 rounded-full border border-[#6b232b] hover:border-red-500 hover:text-red-400 transition-colors"
              >
                Cerrar sesión
              </button>
            </div>
          </div>

          <button type="button" className="flex-1 bg-black/50" onClick={() => setMobileOpen(false)} />
        </div>
      )}
    </>
  );
}
