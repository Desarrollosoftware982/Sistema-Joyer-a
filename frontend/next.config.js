/** @type {import('next').NextConfig} */
const nextConfig = {
  // Mejor para entornos tipo Render (y despliegues más “limpios”)
  output: "standalone",

  // Ajustes sanos para producción
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
};

module.exports = nextConfig;
