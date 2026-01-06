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
  console.warn("⚠️  Falta DATABASE_URL. Revisa variables de entorno (o backend/.env en local).");
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

// ✅ Útil en Render (reverse proxy). No afecta local.
app.set("trust proxy", 1);

app.use(cors());
app.use(express.json());

// Rutas
app.use("/api/auth", authRoutes);
app.use("/api/catalog", catalogRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/purchases", purchasesRoutes);
app.use("/api/cash", cashRoutes);
app.use("/api/cash-register", cashRegisterRoutes);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Backend joyería OK" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Backend joyería escuchando en puerto ${PORT}`);
});
