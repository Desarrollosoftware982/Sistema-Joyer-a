// routes/purchases.routes.js
const express = require('express');
const prisma = require('../config/prisma');
const { authRequired, requireRole } = require('../middlewares/auth');
const { calcularPrecioVenta } = require('../utils/pricing');

// 🔹 Librerías para PDF y código de barras
const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js');

const router = express.Router();

/** ============================
 * Helpers (NO rompen nada)
 * ============================ */

// ✅ Normaliza texto para nombre_norm (obligatorio en tu modelo categorias)
function normalizeNombreNorm(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita acentos
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

// Placeholder agresivo para código de barras (evita "AUTO", "-", una letra, etc.)
function isBarcodePlaceholder(v) {
  const s = String(v ?? '').trim();
  if (!s) return true;

  const lower = s.toLowerCase();
  const bad = new Set([
    '-', '—', '–', '−', '_',
    'na', 'n/a', 'null', 'none', 'sin', 's/c', 'sc',
    'auto',
  ]);

  if (bad.has(lower)) return true;
  if (/^[A-Za-z]$/.test(s)) return true; // UNA sola letra
  return false;
}

/**
 * GET /api/purchases
 * Lista de compras recientes (con ?limit=20) para la pantalla de etiquetas.
 * La pantalla de Next está llamando exactamente a esta ruta.
 */
router.get(
  '/',
  authRequired,
  requireRole(['admin', 'inventario']),
  async (req, res) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 20;

      const compras = await prisma.compras.findMany({
        where: {
          // si quieres ver TODAS, quita esta línea
          estado: 'CONFIRMADA',
        },
        orderBy: { fecha_ingreso: 'desc' },
        take: limit,
        include: {
          proveedores: true, // coincide con tu modelo Prisma
        },
      });

      return res.json({
        ok: true,
        data: {
          items: compras,
        },
      });
    } catch (err) {
      console.error('GET /api/purchases error', err);
      return res.status(500).json({
        ok: false,
        message: 'Error cargando compras recientes',
      });
    }
  }
);

/**
 * POST /api/purchases/import
 * Importar una compra masiva desde JSON (después se conecta con Excel/CSV).
 */
router.post(
  '/import',
  authRequired,
  requireRole(['admin', 'inventario']),
  async (req, res) => {
    // 🔹 CORREGIDO: req.body es un objeto, no una función
    const {
      sucursalId,
      proveedorId,
      moneda = 'GTQ',
      tipoCambio = 1,
      margenDefault = 0.4,
      items,
    } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ ok: false, message: 'No se recibieron items para la compra' });
    }

    // ✅ Normalizar y validar TODAS las filas ANTES de abrir la transacción:
    // los errores de datos devuelven 400 sin gastar tiempo de transacción.
    const filas = [];
    for (let i = 0; i < items.length; i++) {
      const raw = items[i];

      // barcode: limpia placeholders (AUTO, -, una letra, etc.)
      const codigoBarrasRaw = raw.codigo_barras ?? raw.codigoBarras ?? null;
      const codigoBarrasStr =
        codigoBarrasRaw === null ? '' : String(codigoBarrasRaw).trim();
      const codigoBarras = isBarcodePlaceholder(codigoBarrasStr)
        ? null
        : codigoBarrasStr;

      const sku = raw.sku ? String(raw.sku).trim() : null;
      const nombreProducto = String(
        raw.nombre_producto || raw.nombreProducto || ''
      ).trim();
      const categoriaNombre = String(raw.categoria || '').trim().toUpperCase();

      const cantidad = Number(raw.cantidad) || 0;
      const costoCompra = Number(raw.costo_compra ?? raw.costoCompra ?? 0) || 0;
      const costoEnvio = Number(raw.costo_envio ?? raw.costoEnvio ?? 0) || 0;
      const costoImpuestos =
        Number(raw.costo_impuestos ?? raw.costoImpuestos ?? 0) || 0;
      const costoDesaduanaje =
        Number(raw.costo_desaduanaje ?? raw.costoDesaduanaje ?? 0) || 0;
      const margen = raw.porcentaje_margen ?? raw.margen ?? null;

      if (!nombreProducto || !cantidad || costoCompra <= 0) {
        return res.status(400).json({
          ok: false,
          message: `Fila ${i + 1}: datos incompletos (nombre, cantidad, costo_compra son obligatorios)`,
        });
      }

      filas.push({
        fila: i + 1,
        codigoBarras,
        sku,
        nombreProducto,
        categoriaNombre,
        cantidad,
        costoCompra,
        costoEnvio,
        costoImpuestos,
        costoDesaduanaje,
        margen,
      });
    }

    // 🛡️ Protección anti doble importación: si en las últimas 24 h ya se
    // importó una compra con las mismas filas y piezas, se pide confirmación
    // explícita (confirmarDuplicado: true) antes de volver a sumar stock.
    const confirmarDuplicado = req.body?.confirmarDuplicado === true;

    if (!confirmarDuplicado) {
      try {
        const totalPiezas =
          Math.round(filas.reduce((acc, f) => acc + f.cantidad, 0) * 1000) / 1000;

        const gemelas = await prisma.$queryRaw`
          SELECT c.id, c.creado_en,
                 COUNT(cd.id)::int          AS filas,
                 SUM(cd.cantidad)::numeric  AS piezas
          FROM compras c
          JOIN compras_detalle cd ON cd.compra_id = c.id
          WHERE c.creado_en > now() - interval '24 hours'
            AND c.estado <> 'ANULADA'
          GROUP BY c.id
          HAVING COUNT(cd.id) = ${filas.length}
             AND ROUND(SUM(cd.cantidad), 3) = ROUND(${totalPiezas}::numeric, 3)
          ORDER BY c.creado_en DESC
          LIMIT 1
        `;

        if (Array.isArray(gemelas) && gemelas.length > 0) {
          const g = gemelas[0];
          return res.status(409).json({
            ok: false,
            code: 'COMPRA_DUPLICADA',
            message:
              'Ya se importó una compra idéntica en las últimas 24 horas. ' +
              'Si la confirmas, las cantidades se sumarán OTRA VEZ al inventario.',
            data: {
              compraId: g.id,
              fecha: g.creado_en,
              filas: Number(g.filas),
              piezas: Number(g.piezas),
            },
          });
        }
      } catch (dupErr) {
        // La protección nunca debe bloquear una importación legítima
        console.warn('No se pudo verificar compra duplicada:', dupErr.message);
      }
    }

    try {
      const resultado = await prisma.$transaction(async (tx) => {
        // 1) Resolver sucursal (usa SP por defecto)
        let sucursalIdFinal = sucursalId;
        if (!sucursalIdFinal) {
          const sp = await tx.sucursales.findFirst({
            where: { codigo: 'SP' },
          });
          if (!sp) {
            throw new Error(
              'No se encontró la sucursal principal (codigo = SP)'
            );
          }
          sucursalIdFinal = sp.id;
        }

        // 2) Crear compra BORRADOR
        const compra = await tx.compras.create({
          data: {
            proveedor_id: proveedorId || null,
            sucursal_id: sucursalIdFinal,
            usuario_id: req.user.userId,
            moneda,
            tipo_cambio: tipoCambio,
            subtotal_mercaderia: 0,
            descuento_total: 0,
            impuesto_compra: 0,
            costo_envio: 0,
            costo_desaduanaje: 0,
            otros_costos: 0,
            total_compra: 0,
            prorrateada: false,
            estado: 'BORRADOR',
          },
        });

        let subtotalMerc = 0;
        let totalImpuestos = 0;
        let totalEnvio = 0;
        let totalDesadu = 0;
        let totalDescuentos = 0;

        const resumen = [];

        // 3) Categorías: un solo upsert por nombre distinto (antes era 1 por fila)
        const categoriasCache = new Map();
        for (const f of filas) {
          if (!f.categoriaNombre || categoriasCache.has(f.categoriaNombre)) continue;
          const nombre_norm = normalizeNombreNorm(f.categoriaNombre);

          const categoria = await tx.categorias.upsert({
            where: { nombre: f.categoriaNombre }, // nombre es @unique en tu BD
            update: {
              existe: true,
              // ✅ backfill por si existía antes sin nombre_norm
              nombre_norm,
            },
            create: {
              nombre: f.categoriaNombre,
              existe: true,
              nombre_norm,
            },
          });
          categoriasCache.set(f.categoriaNombre, categoria);
        }

        // 4) Productos existentes en bloque: 1 consulta en total
        // (antes eran hasta 2 findUnique POR FILA)
        const codigosArchivo = filas.map((f) => f.codigoBarras).filter(Boolean);
        const skusArchivo = filas.map((f) => f.sku).filter(Boolean);

        const condiciones = [];
        if (codigosArchivo.length) condiciones.push({ codigo_barras: { in: codigosArchivo } });
        if (skusArchivo.length) condiciones.push({ sku: { in: skusArchivo } });

        const existentes = condiciones.length
          ? await tx.productos.findMany({ where: { OR: condiciones } })
          : [];

        const porCodigo = new Map();
        const porSku = new Map();
        for (const p of existentes) {
          if (p.codigo_barras) porCodigo.set(p.codigo_barras, p);
          porSku.set(p.sku, p);
        }

        const detalleRows = [];
        const joinCategoriaRows = [];

        for (const f of filas) {
          const categoria = f.categoriaNombre
            ? categoriasCache.get(f.categoriaNombre) || null
            : null;

          // 5) Margen: fila > categoria.margen_recomendado > margenDefault
          const costoTotalUnit =
            f.costoCompra + f.costoEnvio + f.costoImpuestos + f.costoDesaduanaje;

          const { precioVenta, margenFraccion } = calcularPrecioVenta(
            costoTotalUnit,
            {
              margenFila: f.margen,
              margenCategoria: categoria?.margen_recomendado ?? null,
              margenDefault,
            }
          );

          // 6) Buscar/crear producto (barcode primero, luego SKU, igual que antes)
          let producto =
            (f.codigoBarras && porCodigo.get(f.codigoBarras)) ||
            (f.sku && porSku.get(f.sku)) ||
            null;

          let esNuevo = false;
          if (!producto) {
            const skuFinal =
              f.sku || f.codigoBarras || `SKU-${Date.now()}-${f.fila}`;

            producto = await tx.productos.create({
              data: {
                sku: skuFinal,
                nombre: f.nombreProducto,
                codigo_barras: f.codigoBarras,
                // ✅ NO fijar precio_venta aquí

                // opcional: dejarlo inactivo hasta que Ventas lo configure
                activo: false, // 👈 recomendado para que no salga en catálogo público
                archivado: false,

                iva_porcentaje: 0,
                stock_minimo: 0,

                costo_compra: f.costoCompra,
                costo_envio: f.costoEnvio,
                costo_impuestos: f.costoImpuestos,
                costo_desaduanaje: f.costoDesaduanaje,
              },
            });

            esNuevo = true;
          } else {
            // Actualizar solo costos (precio_venta opcional)
            producto = await tx.productos.update({
              where: { id: producto.id },
              data: {
                costo_compra: f.costoCompra,
                costo_envio: f.costoEnvio,
                costo_impuestos: f.costoImpuestos,
                costo_desaduanaje: f.costoDesaduanaje,
              },
            });
          }

          // Si el archivo repite el mismo producto, las filas siguientes lo
          // encuentran en los mapas y entran por la rama de actualización.
          if (producto.codigo_barras) porCodigo.set(producto.codigo_barras, producto);
          porSku.set(producto.sku, producto);

          if (categoria) {
            joinCategoriaRows.push({
              producto_id: producto.id,
              categoria_id: categoria.id,
            });
          }

          // 7) Acumular totales
          subtotalMerc += f.cantidad * f.costoCompra;
          totalImpuestos += f.cantidad * f.costoImpuestos;
          totalEnvio += f.cantidad * f.costoEnvio;
          totalDesadu += f.cantidad * f.costoDesaduanaje;

          detalleRows.push({
            compra_id: compra.id,
            producto_id: producto.id,
            cantidad: f.cantidad,
            costo_unitario_base: f.costoCompra,
          });

          resumen.push({
            fila: f.fila,
            productoId: producto.id,
            sku: producto.sku,
            codigo_barras: producto.codigo_barras,
            creado: esNuevo,
            cantidad: f.cantidad,
            costoTotalUnit,
            precioVentaSugerido: precioVenta,
            margenFraccionSugerido: margenFraccion,
          });
        }

        // Relación producto-categoría y detalle de compra en bloque (2 consultas
        // en vez de 1-2 por fila)
        if (joinCategoriaRows.length) {
          await tx.productos_categorias.createMany({
            data: joinCategoriaRows,
            skipDuplicates: true,
          });
        }

        if (detalleRows.length) {
          await tx.compras_detalle.createMany({ data: detalleRows });
        }

        // 8) Actualizar cabecera
        const compraActualizada = await tx.compras.update({
          where: { id: compra.id },
          data: {
            subtotal_mercaderia: subtotalMerc,
            impuesto_compra: totalImpuestos,
            costo_envio: totalEnvio,
            costo_desaduanaje: totalDesadu,
            descuento_total: totalDescuentos,
          },
        });

        // 9) Confirmar compra (triggera inventario y costos)
        await tx.$executeRawUnsafe(
          `SELECT fn_confirmar_compra($1::uuid);`,
          compra.id
        );

        // ✅ NO rompemos si NO existe la función de inventariado a bodega
        const existeFnRows = await tx.$queryRaw`
          SELECT EXISTS (
            SELECT 1
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.proname = 'fn_inventariar_compra_a_bodega'
          ) AS existe_fn;
        `;

        const existe_fn = Array.isArray(existeFnRows) && existeFnRows[0]?.existe_fn;

        if (existe_fn) {
          await tx.$queryRaw`
            SELECT public.fn_inventariar_compra_a_bodega(${compra.id}::uuid);
          `;
        } else {
          console.warn(
            '⚠️ fn_inventariar_compra_a_bodega no existe en esta BD. Se omite inventariado a bodega.'
          );
        }

        return {
          compra: compraActualizada,
          resumen,
        };
      }, {
        // La importación corre muchas consultas y termina en funciones SQL
        // pesadas (fn_confirmar_compra + inventariado a bodega). El default de
        // 5s cortaba la transacción a media carga en producción con el error
        // "Transaction not found / already closed".
        maxWait: 15_000,
        timeout: 180_000,
      });

      return res.status(201).json({
        ok: true,
        message: 'Compra importada y confirmada correctamente',
        data: resultado,
      });
    } catch (err) {
      console.error('POST /api/purchases/import error', err);

      let message = err.message || 'Error importando compra masiva';

      // Transacción expirada (P2028): el caso típico con archivos grandes.
      if (
        err?.code === 'P2028' ||
        /Transaction (API error|not found|already closed)/i.test(String(err?.message))
      ) {
        message =
          'La importación tardó demasiado y la base de datos cerró la operación. ' +
          'No se guardó nada: vuelve a intentarlo y, si el archivo es muy grande, divídelo en partes.';
      } else if (err?.code === 'P2002') {
        const campos = Array.isArray(err?.meta?.target)
          ? err.meta.target.join(', ')
          : String(err?.meta?.target || 'campo único');
        message = `Datos duplicados en ${campos}: ya existe un registro con ese valor (revisa SKU, código de barras o categoría repetidos).`;
      }

      return res.status(500).json({ ok: false, message });
    }
  }
);

/**
 * GET /api/purchases/recent
 * Alias adicional (si más adelante quieres usar esta ruta).
 * NO lo toqué: se mantiene la lógica que ya tenías.
 */
router.get(
  '/recent',
  authRequired,
  requireRole(['admin', 'inventario']),
  async (req, res) => {
    try {
      const compras = await prisma.compras.findMany({
        take: 20,
        orderBy: { fecha_ingreso: 'desc' },
        include: {
          proveedores: true,
        },
      });

      return res.json({
        ok: true,
        data: {
          items: compras,
        },
      });
    } catch (err) {
      console.error('GET /api/purchases/recent error', err);
      return res.status(500).json({
        ok: false,
        message: 'Error cargando compras recientes',
      });
    }
  }
);

/**
 * GET /api/purchases/:id/labels/pdf
 * Genera un PDF con una etiqueta por pieza de los productos de la compra.
 */
router.get(
  '/:id/labels/pdf',
  authRequired,
  requireRole(['admin', 'inventario']),
  async (req, res) => {
    const { id } = req.params;

    try {
      const compra = await prisma.compras.findUnique({
        where: { id },
        include: {
          compras_detalle: {
            include: {
              productos: true,
            },
          },
          proveedores: true,
        },
      });

      if (!compra) {
        return res
          .status(404)
          .json({ ok: false, message: 'Compra no encontrada' });
      }

      if (!compra.compras_detalle || compra.compras_detalle.length === 0) {
        return res.status(400).json({
          ok: false,
          message: 'La compra no tiene detalle para generar etiquetas',
        });
      }

      // Construir lista de etiquetas: una por unidad (cantidad)
      const labels = [];
      for (const det of compra.compras_detalle) {
        const prod = det.productos;
        if (!prod) continue;

        const qty = Math.max(1, Math.round(Number(det.cantidad) || 0));

        for (let i = 0; i < qty; i++) {
          labels.push({
            sku: prod.sku,
            nombre: prod.nombre,
            codigo_barras: prod.codigo_barras, // si quieres usar SKU como fallback: prod.codigo_barras || prod.sku
          });
        }
      }

      if (labels.length === 0) {
        return res.status(400).json({
          ok: false,
          message: 'No hay productos con código de barras para esta compra.',
        });
      }

      // Headers para respuesta PDF
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="etiquetas-${id}.pdf"`
      );

      const doc = new PDFDocument({ size: 'A4', margin: 20 });
      doc.pipe(res);

      // Encabezado
      doc.fontSize(12).text('Joyería — Etiquetas de compra', { align: 'center' });
      if (compra.proveedores) {
        doc
          .moveDown(0.3)
          .fontSize(9)
          .text(`Proveedor: ${compra.proveedores.nombre}`, { align: 'center' });
      }
      doc
        .moveDown(0.2)
        .fontSize(8)
        .text(`Compra: ${id}`, { align: 'center' });
      doc.moveDown(1);

      const pageMargin = doc.page.margins.left;
      const rowGap = 10;
      const colGap = 10;
      const cols = 3;

      const usableWidth = doc.page.width - pageMargin * 2;
      const labelWidth = (usableWidth - (cols - 1) * colGap) / cols;

      // 🔹 Un poco más alta para que todo quepa cómodo
      const labelHeight = 80;

      let currentY = doc.y;
      let currentCol = 0;

      const maxY = () => doc.page.height - doc.page.margins.bottom;

      const drawLabel = async (label, x, y) => {
        const padding = 6;
        const innerWidth = labelWidth - padding * 2;

        // Marco
        doc
          .roundedRect(x, y, labelWidth, labelHeight, 6)
          .lineWidth(0.5)
          .strokeColor('#555555')
          .stroke();

        // Título (nombre)
        doc
          .fontSize(9)
          .fillColor('#000000')
          .text(label.nombre || '', x + padding, y + padding, {
            width: innerWidth,
            height: 18,
            ellipsis: true,
          });

        // SKU
        doc
          .fontSize(8)
          .fillColor('#333333')
          .text(`SKU: ${label.sku || ''}`, x + padding, y + padding + 20, {
            width: innerWidth,
            height: 10,
          });

        if (label.codigo_barras) {
          // Posicionamos el código de barras pegado a la parte inferior interna
          const barcodeHeight = 26;
          const barcodeY = y + labelHeight - padding - barcodeHeight;

          // Texto del código justo encima del código de barras
          doc
            .fontSize(7)
            .fillColor('#333333')
            .text(label.codigo_barras, x + padding, barcodeY - 10, {
              width: innerWidth,
              height: 8,
              ellipsis: true,
            });

          try {
            const png = await bwipjs.toBuffer({
              bcid: 'code128',
              text: label.codigo_barras,
              scale: 2,
              height: 10,
              includetext: false,
            });

            doc.image(png, x + padding, barcodeY, {
              width: innerWidth,
              height: barcodeHeight,
            });
          } catch (barcodeErr) {
            console.error('Error generando código de barras', barcodeErr);
          }
        }
      };

      // Pintar todas las etiquetas
      for (let i = 0; i < labels.length; i++) {
        if (currentCol >= cols) {
          currentCol = 0;
          currentY += labelHeight + rowGap;
        }

        if (currentY + labelHeight > maxY()) {
          doc.addPage();
          currentY = doc.page.margins.top;
          currentCol = 0;
        }

        const x = pageMargin + currentCol * (labelWidth + colGap);
        const y = currentY;

        // eslint-disable-next-line no-await-in-loop
        await drawLabel(labels[i], x, y);

        currentCol += 1;
      }

      doc.end();
    } catch (err) {
      console.error('GET /api/purchases/:id/labels/pdf error', err);
      if (!res.headersSent) {
        return res.status(500).json({
          ok: false,
          message: 'Error generando PDF de etiquetas',
        });
      }
    }
  }
);

module.exports = router;
