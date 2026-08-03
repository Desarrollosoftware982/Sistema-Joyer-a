-- ============================================================================
-- CORRECCIÓN DE DATOS: stock duplicado x8 por triggers/funciones duplicadas
-- Fecha: 2026-08-03
--
-- ⚠️ ANTES DE EJECUTAR:
--   1. Haz un respaldo:  pg_dump "URL_DE_PRODUCCION" -Fc -f respaldo.dump
--   2. Ejecuta en un momento SIN ventas activas (toma segundos).
--   3. Ejecuta primero la migración estructural
--      (20260803000001_fix_inventario_duplicado) o el BLOQUE 1 equivalente.
--
-- Los bloques 2-4 solo tocan el historial (ledger) y recalculan existencias;
-- ningún trigger se dispara en DELETE, así que no hay efectos dobles.
-- ============================================================================

-- ============================================================
-- BLOQUE 2: eliminar la copia duplicada de entradas por compra
-- (las de motivo 'Compra <id>' que tienen su gemela
--  'Entrada por compra <id>'; se conserva la segunda)
-- ============================================================
BEGIN;

DELETE FROM inventario_movimientos m
WHERE m.tipo = 'ENTRADA'
  AND m.motivo LIKE 'Compra %'
  AND EXISTS (
    SELECT 1
    FROM inventario_movimientos m2
    WHERE m2.tipo = 'ENTRADA'
      AND m2.producto_id = m.producto_id
      AND m2.motivo = 'Entrada por compra ' || substring(m.motivo FROM 8)
  );

COMMIT;

-- ============================================================
-- BLOQUE 3: eliminar la compra duplicada (el archivo se importó 2 veces)
-- Paso A: identifica las dos compras gemelas (misma cantidad de filas/piezas):
-- ============================================================
SELECT c.id, c.creado_en, c.estado,
       COUNT(cd.id)      AS filas,
       SUM(cd.cantidad)  AS piezas,
       c.subtotal_mercaderia
FROM compras c
LEFT JOIN compras_detalle cd ON cd.compra_id = c.id
GROUP BY c.id
ORDER BY c.creado_en DESC
LIMIT 10;

-- Paso B: pega el id de la compra DUPLICADA (normalmente la más reciente
-- de las dos gemelas) en v_compra y ejecuta:
DO $$
DECLARE
  v_compra uuid := 'PEGA-AQUI-EL-UUID-DE-LA-COMPRA-DUPLICADA';
BEGIN
  DELETE FROM inventario_movimientos
  WHERE motivo IN ('Compra ' || v_compra, 'Entrada por compra ' || v_compra);

  DELETE FROM compras_detalle WHERE compra_id = v_compra;
  DELETE FROM compras WHERE id = v_compra;

  RAISE NOTICE 'Compra % eliminada con sus movimientos y detalle', v_compra;
END $$;

-- ============================================================
-- BLOQUE 4: recalcular TODO el stock desde el historial,
-- aplicando cada movimiento UNA sola vez.
-- (También corrige el doble descuento histórico de ventas/traspasos.)
-- ============================================================
BEGIN;

UPDATE inventario_existencias SET stock = 0;

WITH deltas AS (
  SELECT producto_id, ubicacion_destino_id AS ubicacion_id, SUM(cantidad) AS delta
  FROM inventario_movimientos
  WHERE tipo IN ('ENTRADA','AJUSTE','TRASPASO')
    AND ubicacion_destino_id IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  SELECT producto_id, ubicacion_origen_id, -SUM(cantidad)
  FROM inventario_movimientos
  WHERE tipo IN ('SALIDA','VENTA','TRASPASO')
    AND ubicacion_origen_id IS NOT NULL
  GROUP BY 1, 2
),
agg AS (
  SELECT producto_id, ubicacion_id, SUM(delta) AS stock
  FROM deltas
  GROUP BY 1, 2
)
INSERT INTO inventario_existencias (producto_id, ubicacion_id, stock)
SELECT producto_id, ubicacion_id, stock
FROM agg
ON CONFLICT (producto_id, ubicacion_id)
DO UPDATE SET stock = EXCLUDED.stock;

-- Recalcular la marca "en cero desde" de cada producto
UPDATE productos p
SET zero_since = CASE
  WHEN COALESCE(
         (SELECT SUM(e.stock) FROM inventario_existencias e WHERE e.producto_id = p.id),
         0
       ) <= 0
    THEN COALESCE(p.zero_since, now())
  ELSE NULL
END;

COMMIT;

-- ============================================================
-- BLOQUE 5: verificación
-- ============================================================

-- Piezas totales: deben ser ~3,179 (las del archivo) menos lo ya vendido
SELECT SUM(stock) AS piezas_totales FROM inventario_existencias;

-- Stock por ubicación
SELECT u.nombre AS ubicacion, SUM(e.stock) AS piezas
FROM inventario_existencias e
JOIN ubicaciones u ON u.id = e.ubicacion_id
GROUP BY 1
ORDER BY 1;

-- No debería devolver filas (stock negativo = anomalía a revisar)
SELECT p.sku, p.nombre, u.nombre AS ubicacion, e.stock
FROM inventario_existencias e
JOIN productos p ON p.id = e.producto_id
JOIN ubicaciones u ON u.id = e.ubicacion_id
WHERE e.stock < 0
ORDER BY e.stock
LIMIT 20;

-- Ya no debe haber entradas duplicadas (debe devolver 0)
SELECT COUNT(*) AS entradas_duplicadas_restantes
FROM inventario_movimientos m
WHERE m.tipo = 'ENTRADA'
  AND m.motivo LIKE 'Compra %'
  AND EXISTS (
    SELECT 1 FROM inventario_movimientos m2
    WHERE m2.tipo = 'ENTRADA'
      AND m2.producto_id = m.producto_id
      AND m2.motivo = 'Entrada por compra ' || substring(m.motivo FROM 8)
  );
