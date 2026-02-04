const express = require("express");
const router = express.Router();

const {
  exportReporteVentasExcel,
  exportReporteInventarioInternoExcel,
} = require("../controllers/reportes.controller");

// ✅ Endpoint final: GET /api/reportes/ventas/export?from=YYYY-MM-DD&to=YYYY-MM-DD&metodo=EFECTIVO|TRANSFERENCIA|TARJETA
router.get("/ventas/export", exportReporteVentasExcel);
router.get("/inventario-interno/export", exportReporteInventarioInternoExcel);

module.exports = router;
