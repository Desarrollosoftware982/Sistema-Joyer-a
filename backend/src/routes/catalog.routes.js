// src/routes/catalog.routes.js
const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth"); // middleware JWT
const catalogController = require("../controllers/catalog.controller");

// Todas estas rutas requieren estar autenticado
router.use(auth);

/**
 * CATEGORÍAS
 */

// GET /api/catalog/categories
router.get("/categories", catalogController.getCategories);

// POST /api/catalog/categories
router.post("/categories", catalogController.createCategory);

// PUT /api/catalog/categories/:id
router.put("/categories/:id", catalogController.updateCategory);

// DELETE /api/catalog/categories/:id
router.delete("/categories/:id", catalogController.deleteCategory);

/**
 * PRODUCTOS
 */

// GET /api/catalog/products?q=&page=&pageSize=
router.get("/products", catalogController.getProducts);

// POST /api/catalog/products
router.post("/products", catalogController.createProduct);

// PUT /api/catalog/products/:id
router.put("/products/:id", catalogController.updateProduct);

// GET /api/catalog/products/:id
router.get("/products/:id", catalogController.getProductById);

module.exports = router;
