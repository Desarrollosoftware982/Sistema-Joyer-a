"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminSidebar from "../../_components/AdminSidebar";

interface User {
  id: string;
  nombre: string;
  email: string;
  rol: string;
}

export default function ComprasHomePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  const today = new Date().toLocaleDateString("es-GT", {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  // Verificar sesión igual que en inventario/productos
  useEffect(() => {
    const t = localStorage.getItem("joyeria_token");
    const uStr = localStorage.getItem("joyeria_user");

    if (!t || !uStr) {
      router.push("/login");
      return;
    }

    try {
      const u: User = JSON.parse(uStr);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUser(u);
    } catch {
      router.push("/login");
    }
  }, [router]);

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
            <h1 className="text-xl md:text-2xl font-semibold">Compras</h1>
            <p className="text-xs md:text-sm text-[#c9b296] capitalize">
              {today}
            </p>
          </div>
        </header>

        {/* Contenido principal */}
        <main className="flex-1 px-4 md:px-8 py-6 space-y-6 max-w-5xl">
          <section className="bg-[#3a0d12]/80 border border-[#5a1b22] rounded-2xl p-4 mb-4">
            <h2 className="text-sm font-semibold mb-1">
              Panel de compras y carga masiva
            </h2>
            <p className="text-[11px] text-[#c9b296]">
              Desde aquí puedes importar una compra grande desde Excel y
              generar las etiquetas de código de barras de los productos.
            </p>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            {/* Tarjeta: Importar compra masiva */}
            <button
              type="button"
              onClick={() => router.push("/dashboard/compras/importar")}
              className="text-left bg-[#3a0d12]/80 border border-[#5a1b22] rounded-2xl p-4 hover:border-[#d6b25f]/60 hover:bg-[#3a0d12] transition"
            >
              <h3 className="text-sm font-semibold text-[#f8f1e6] mb-1">
                Importar compra masiva
              </h3>
              <p className="text-[11px] text-[#c9b296]">
                Sube un archivo Excel con hasta cientos de productos, costos y
                cantidades. El sistema creará o actualizará los productos,
                registrará la compra y actualizará el inventario.
              </p>
            </button>

            
          </section>
        </main>
      </div>
    </div>
  );
}
