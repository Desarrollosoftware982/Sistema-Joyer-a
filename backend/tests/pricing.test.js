// tests/pricing.test.js
const { calcularPrecioVenta } = require('../src/utils/pricing');

describe('calcularPrecioVenta', () => {
  test('usa el margen por defecto cuando no hay margen en fila ni categoría', () => {
    const { precioVenta, margenFraccion } = calcularPrecioVenta(100, {});
    // margen por defecto 0.4 => 40%
    expect(margenFraccion).toBeCloseTo(0.4);
    expect(precioVenta).toBeCloseTo(140); // 100 * 1.4
  });

  test('cuando el margen viene como porcentaje (>1) lo convierte a fracción', () => {
    const { precioVenta, margenFraccion } = calcularPrecioVenta(100, {
      margenFila: 40, // 40%
      margenDefault: 0.3,
    });

    expect(margenFraccion).toBeCloseTo(0.4);
    expect(precioVenta).toBeCloseTo(140);
  });

  test('prioriza margen de la fila sobre margen de categoría', () => {
    const { precioVenta, margenFraccion } = calcularPrecioVenta(200, {
      margenFila: 50,          // 50%
      margenCategoria: 0.3,    // 30% (no debería usarse)
      margenDefault: 0.2,
    });

    expect(margenFraccion).toBeCloseTo(0.5);
    expect(precioVenta).toBeCloseTo(300); // 200 * 1.5
  });

  test('con costo cero devuelve precio 0', () => {
    const { precioVenta } = calcularPrecioVenta(0, {});
    expect(precioVenta).toBe(0);
  });
});
