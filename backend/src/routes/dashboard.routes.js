const express = require("express");
const { authRequired, requireRole, attachCurrentUser } = require("../middlewares/auth");
const dashboardController = require("../controllers/dashboard.controller");

const router = express.Router();

const ROLES_ADMIN_CAJERO = ["admin", "ADMIN", "cajero", "CAJERO"];

router.get(
  "/summary",
  authRequired,
  attachCurrentUser,
  requireRole(ROLES_ADMIN_CAJERO),
  dashboardController.dashboardSummary
);

router.get(
  "/top-products",
  authRequired,
  attachCurrentUser,
  requireRole(ROLES_ADMIN_CAJERO),
  dashboardController.dashboardTopProducts
);

router.get(
  "/low-stock",
  authRequired,
  attachCurrentUser,
  requireRole(ROLES_ADMIN_CAJERO),
  dashboardController.dashboardLowStock
);

router.get(
  "/last-sales",
  authRequired,
  attachCurrentUser,
  requireRole(ROLES_ADMIN_CAJERO),
  dashboardController.dashboardLastSales
);

module.exports = router;
