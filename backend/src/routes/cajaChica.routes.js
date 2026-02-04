const express = require("express");
const { authRequired, requireRole } = require("../middlewares/auth");
const cajaChicaController = require("../controllers/cajaChica.controller");

const router = express.Router();

router.get(
  "/resumen",
  authRequired,
  cajaChicaController.resumenCajaChica
);

router.get(
  "/saldo",
  authRequired,
  cajaChicaController.saldoCajaChica
);

router.get(
  "/entregas",
  authRequired,
  cajaChicaController.listEntregas
);

router.post(
  "/entregas",
  authRequired,
  requireRole(["admin"]),
  cajaChicaController.createEntrega
);

router.get(
  "/cambios",
  authRequired,
  cajaChicaController.listCambios
);

router.get(
  "/export",
  authRequired,
  cajaChicaController.exportCajaChicaExcel
);

module.exports = router;
