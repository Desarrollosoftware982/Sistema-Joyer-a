const path = require("path");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

// ✅ Carga .env local solo si existe (en Render se usan Environment Variables)
dotenv.config({ path: path.join(__dirname, "..", ".env") });

// ✅ Prisma (para shutdown limpio)
const prisma = require("./config/prisma");

// ✅ Debug útil (no imprime la contraseña completa)
const dbUrl = process.env.DATABASE_URL || "";
const maskedDbUrl = dbUrl
  ? dbUrl.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:****@")
  : "";

if (!process.env.DATABASE_URL) {
  console.warn("⚠️  Falta DATABASE_URL. Configúrala en Render (Environment).");
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

const app = express();
const PORT = process.env.PORT || 4000;

// ✅ Render / reverse proxy
app.set("trust proxy", 1);

// ✅ CORS configurable (para producción); si no defines nada, deja abierto como hoy
const corsOrigin = process.env.CORS_ORIGIN?.trim();
app.use(
  cors({
    origin: corsOrigin ? corsOrigin.split(",").map((s) => s.trim()) : true,
    credentials: true,
  })
);

// ✅ JSON con límite sano (evita requests gigantes)
app.use(express.json({ limit: "2mb" }));

// Rutas
app.use("/api/auth", authRoutes);
app.use("/api/catalog", catalogRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/purchases", purchasesRoutes);
app.use("/api/cash", cashRoutes);
app.use("/api/cash-register", cashRegisterRoutes);

app.get("/api/health", async (req, res) => {
  // ping simple de DB (sin exponer nada sensible)
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: "ok", message: "Backend joyería OK" });
  } catch (e) {
    res.status(500).json({ ok: false, db: "fail", message: "DB no responde" });
  }
});

// ✅ Handler de errores (no interfiere con rutas que ya responden bien)
app.use((err, req, res, next) => {
  console.error("❌ Error no controlado:", err);
  res.status(500).json({ message: "Error interno del servidor" });
});

const server = app.listen(PORT, () => {
  console.log(`Backend joyería escuchando en puerto ${PORT}`);
});

// ✅ Apagado limpio (Render manda SIGTERM en deploys/restarts)
const shutdown = async (signal) => {
  try {
    console.log(`🛑 ${signal} recibido. Cerrando servidor…`);
    server.close(async () => {
      try {
        await prisma.$disconnect();
      } catch {}
      console.log("✅ Shutdown completo.");
      process.exit(0);
    });

    // fallback por si algo se queda colgado
    setTimeout(() => process.exit(1), 10000).unref();
  } catch {
    process.exit(1);
  }
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e));
process.on("uncaughtException", (e) => console.error("uncaughtException:", e));
