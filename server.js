// server.js (en la raíz)
const path = require("path");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

// Carga env local si existe (en Render se usan Environment Variables del dashboard)
dotenv.config({ path: path.join(__dirname, "backend", ".env") });

const PORT = process.env.PORT || 4000;
const isProd = process.env.NODE_ENV === "production";

// ====== BACKEND ROUTES (tal cual las tienes) ======
const authRoutes = require("./backend/src/routes/auth.routes");
const catalogRoutes = require("./backend/src/routes/catalog.routes");
const inventoryRoutes = require("./backend/src/routes/inventory.routes");
const salesRoutes = require("./backend/src/routes/sales.routes");
const reportsRoutes = require("./backend/src/routes/reports.routes");
const purchasesRoutes = require("./backend/src/routes/purchases.routes");
const cashRoutes = require("./backend/src/routes/cash.routes");
const cashRegisterRoutes = require("./backend/src/routes/cashRegister.routes");
const dashboardRoutes = require("./backend/src/routes/dashboard.routes");
const cajaChicaRoutes = require("./backend/src/routes/cajaChica.routes");
const adminRoutes = require("./backend/src/routes/admin.routes");
const reportesRoutes = require("./backend/src/routes/reportes.routes");

// ====== NEXT (frontend) ======
const next = require("next");
const nextApp = next({
  dev: !isProd,
  dir: path.join(__dirname, "frontend"),
});
const handle = nextApp.getRequestHandler();

nextApp
  .prepare()
  .then(() => {
    const app = express();

    // Si usas Render (proxy), esto ayuda a que Express interprete bien headers
    app.set("trust proxy", 1);

    app.use(cors());
    app.use(express.json({ limit: "10mb" }));


    // --- API ---
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
    app.use("/api/reportes", reportesRoutes);

 // Healthcheck
app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Backend joyería OK", env: isProd ? "prod" : "dev" });
});

// FRONT (Next)
app.all(/.*/, (req, res) => handle(req, res));

    app.listen(PORT, () => {
      console.log(`✅ Fullstack (API + Next) escuchando en puerto ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ Error preparando Next:", err);
    process.exit(1);
  });
