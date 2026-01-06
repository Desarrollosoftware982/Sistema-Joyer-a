// src/utils/pricing.js

/**
 * Calcula el precio de venta a partir de un costo total unitario
 * y un margen que puede venir:
 *  - en la fila (margenFila)
 *  - en la categoría (margenCategoria)
 *  - por defecto (margenDefault)
 *
 * El margen puede venir como fracción (0.4) o como porcentaje (40).
 */
function calcularPrecioVenta(costoTotalUnit, opciones = {}) {
  const {
    margenFila = null,
    margenCategoria = null,
    margenDefault = 0.4, // 40%
  } = opciones;

  // 1) Determinar el margen “bruto”
  let margen = margenFila;

  if (margen == null) {
    if (margenCategoria != null) {
      margen = Number(margenCategoria);
    } else {
      margen = margenDefault;
    }
  }

  margen = Number(margen);
  if (Number.isNaN(margen)) {
    margen = margenDefault;
  }

  // 2) Si es porcentaje (>1), lo pasamos a fracción
  if (margen > 1) {
    margen = margen / 100;
  }

  // 3) Si el costo es 0 o negativo, no hay precio
  if (!costoTotalUnit || costoTotalUnit <= 0) {
    return {
      precioVenta: 0,
      margenFraccion: margen,
    };
  }

  const precio = costoTotalUnit * (1 + margen);
  const precioRedondeado = Math.round(precio * 100) / 100;

  return {
    precioVenta: precioRedondeado,
    margenFraccion: margen,
  };
}

module.exports = {
  calcularPrecioVenta,
};
