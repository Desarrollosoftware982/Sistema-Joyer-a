const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

// ✅ En producción (Render) NO dependemos de archivo .env.
// ✅ En local sí lo cargamos desde backend/.env como ya lo tenías.
if (process.env.NODE_ENV !== "production") {
  const envPath = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

// ✅ Debug útil (no imprime la contraseña completa)
const dbUrl = process.env.DATABASE_URL || "";
const maskedDbUrl = dbUrl
  ? dbUrl.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:****@")
  : "";

if (!process.env.DATABASE_URL) {
  console.warn(
    "⚠️  Falta DATABASE_URL. Revisa variables de entorno (o backend/.env en local)."
  );
} else {
  console.log("✅ DATABASE_URL (runtime):", maskedDbUrl);
}

const authRoutes = require("./routes/auth.routes");
const catalogRoutes = require("./routes/catalog.routes");
const inventoryRoutes = require("./routes/inventory.routes");
const salesRoutes = require("./routes/sales.routes");
const reportsRoutes = require("./routes/reports.routes");
const purchasesRoutes = require("./routes/purchases.routes");
const cashRoutes = require("./routes/cash.routes");
const cashRegisterRoutes = require("./routes/cashRegister.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const cajaChicaRoutes = require("./routes/cajaChica.routes");
const adminRoutes = require("./routes/admin.routes");

// ✅ NUEVO: rutas en español para reportes (Excel, etc.)
const reportesRoutes = require("./routes/reportes.routes");

const app = express();
const PORT = process.env.PORT || 4000;

// ✅ IMPORTANTE para Render/proxies (rate-limit, req.ip, headers reales)
app.set("trust proxy", 1);

/* =========================================================
 * ✅ CORS: NO rompe producción
 * - Si NO hay whitelist en env => se queda como hoy: app.use(cors())
 * - Si SÍ hay whitelist => activa CORS estricto (como tu local)
 * =======================================================*/
const envOrigins = (process.env.CORS_ORIGIN || process.env.FRONTEND_URL || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const hasWhitelist = envOrigins.length > 0;

if (!hasWhitelist) {
  // ✅ EXACTAMENTE lo que ya te funciona hoy
  app.use(cors());
} else {
  const allowedOrigins = [
    ...envOrigins,
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ].filter(Boolean);

  const corsOptions = {
    origin: (origin, cb) => {
      // Permitir herramientas sin Origin (Postman/curl)
      if (!origin) return cb(null, true);

      if (allowedOrigins.includes(origin)) return cb(null, true);

      console.warn("🚫 CORS bloqueado para origin:", origin);
      return cb(new Error(`CORS bloqueado para origin: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  };

  app.use(cors(corsOptions));
  // ✅ Responde preflight (OPTIONS) para TODAS las rutas
  app.options(/.*/, cors(corsOptions));
}

// ✅ Parsers (no rompen nada, solo completan)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rutas existentes
app.use("/api/auth", authRoutes);
app.use("/api/catalog", catalogRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/purchases", purchasesRoutes);
app.use("/api/cash", cashRoutes);
app.use("/api/cash-register", cashRegisterRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/caja-chica", cajaChicaRoutes);
app.use("/api/admin", adminRoutes);

// ✅ NUEVO: monta /api/reportes (por ejemplo: /api/reportes/ventas/export ...)
app.use("/api/reportes", reportesRoutes);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Backend joyería OK" });
});

// ✅ Handler de errores (solo “se nota” si algo truena)
app.use((err, req, res, next) => {
  console.error("🔥 Error no manejado:", err);

  if (
    hasWhitelist &&
    String(err?.message || "").startsWith("CORS bloqueado")
  ) {
    return res.status(403).json({ ok: false, message: "CORS bloqueado" });
  }

  return res.status(500).json({ ok: false, message: "Error interno del servidor" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Backend joyería escuchando en puerto ${PORT}`);
});
