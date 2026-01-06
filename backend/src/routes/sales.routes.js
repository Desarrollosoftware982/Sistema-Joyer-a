// src/routes/sales.routes.js
const express = require("express");
const { authRequired, requireRole, attachCurrentUser } = require("../middlewares/auth");
const salesController = require("../controllers/sales.controller");

// ✅ NUEVO: multer para recibir Excel/CSV como multipart/form-data
const multer = require("multer");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});

const router = express.Router();

// ✅ Roles permitidos (acepta mayúsculas/minúsculas sin tocar el middleware)
const ROLES_ADMIN_CAJERO = ["admin", "ADMIN", "cajero", "CAJERO"];

/**
 * Crear venta + detalle + pagos + confirmar (debe descargar stock)
 * POST /api/sales
 */
router.post(
  "/",
  authRequired,
  attachCurrentUser, // ✅ NO rompe nada, solo adjunta req.currentUser si existe
  requireRole(ROLES_ADMIN_CAJERO),
  salesController.createSale
);

/**
 * ✅ Venta POS (Cajero)
 * POST /api/sales/pos
 */
router.post(
  "/pos",
  authRequired,
  attachCurrentUser, // ✅ útil para corporación/sucursal/automatizaciones
  requireRole(ROLES_ADMIN_CAJERO),
  salesController.crearVentaPOS
);

/**
 * =============================
 * Ventas · Configuración (frontend)
 * Endpoints para modo manual / carga masiva
 * =============================
 */

/**
 * Registrar un producto para ventas (modo manual)
 * POST /api/sales/manual-product
 */
router.post(
  "/manual-product",
  authRequired,
  attachCurrentUser,
  requireRole(ROLES_ADMIN_CAJERO),
  salesController.createManualProduct
);

/**
 * Eliminar producto registrado manualmente
 * DELETE /api/sales/manual-product/:id
 */
router.delete(
  "/manual-product/:id",
  authRequired,
  attachCurrentUser,
  requireRole(ROLES_ADMIN_CAJERO),
  salesController.deleteManualProduct
);

/**
 * Guardar cambios masivos (nombre, categoría, precios, código barras)
 * POST /api/sales/bulk-products
 */
router.post(
  "/bulk-products",
  authRequired,
  attachCurrentUser,
  requireRole(ROLES_ADMIN_CAJERO),
  salesController.bulkUpdateProducts
);

/**
 * Carga masiva desde Excel / CSV (ventas)
 * POST /api/sales/import-excel
 */
router.post(
  "/import-excel",
  authRequired,
  attachCurrentUser,
  requireRole(ROLES_ADMIN_CAJERO),
  upload.any(), // ✅ acepta cualquier nombre de campo del archivo (file, archivo, excel...)
  salesController.importSalesExcel
);

module.exports = router;
