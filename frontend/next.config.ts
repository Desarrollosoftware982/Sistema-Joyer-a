import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mejor para entornos tipo Render (y despliegues más “limpios”)
  output: "standalone",

  // Ajustes sanos para producción
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
};

export default nextConfig;
