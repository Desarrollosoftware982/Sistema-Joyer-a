// src/routes/inventory.routes.js
const express = require("express");
const { authRequired, requireRole } = require("../middlewares/auth");
const inventoryController = require("../controllers/inventory.controller");

const router = express.Router();

// Listar existencias por producto y sucursal
router.get("/stock", authRequired, inventoryController.getStock);

// Stock bajo usando la vista
router.get("/stock-bajo", authRequired, inventoryController.getLowStock);

// ✅ NUEVO: Traslado rápido BODEGA -> VITRINA (para POS)
router.post(
  "/traslado-vitrina",
  authRequired,
  requireRole(["admin", "inventario", "cajero"]),
  inventoryController.transferToVitrina
);

// ✅ NUEVO: Asegurar stock de VITRINA para POS (múltiples items)
// (mueve de BODEGA -> VITRINA lo necesario)
router.post(
  "/pos/ensure-vitrina",
  authRequired,
  requireRole(["admin", "inventario", "cajero"]),
  inventoryController.ensureVitrinaForPOS
);

// Registrar movimiento manual (ajustes/traspasos)
router.post(
  "/movimientos",
  authRequired,
  requireRole(["admin", "inventario"]),
  inventoryController.createMovement
);

// Confirmar compra
router.post(
  "/compras/:id/confirmar",
  authRequired,
  requireRole(["admin", "inventario"]),
  inventoryController.confirmPurchase
);

module.exports = router;
