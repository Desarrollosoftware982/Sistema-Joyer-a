-- Corrige la duplicación de inventario:
--
-- 1) Había DOS triggers AFTER INSERT sobre inventario_movimientos que aplicaban
--    cada movimiento al stock (trg_mov_inv_apply y t_apply_inventario_movimiento),
--    por lo que TODO movimiento (ENTRADA, VENTA, TRASPASO, ...) sumaba/restaba doble.
--    Se elimina trg_mov_inv_apply y se conserva t_apply_inventario_movimiento,
--    que además valida ubicaciones y bloquea stock negativo (fn_existencias_sumar).
--
-- 2) fn_confirmar_compra insertaba ENTRADAs a bodega y fn_inventariar_compra_a_bodega
--    las insertaba OTRA VEZ (con motivo distinto, así que su control de idempotencia
--    no las detectaba). Resultado: cada compra confirmada sumaba stock x4.
--    fn_confirmar_compra queda solo con prorrateo + costo promedio + estado;
--    fn_inventariar_compra_a_bodega es ahora el ÚNICO que inventaría (tiene idempotencia).
--
-- Este script es idempotente: puede ejecutarse más de una vez sin efectos adicionales.

DROP TRIGGER IF EXISTS trg_mov_inv_apply ON public.inventario_movimientos;

CREATE OR REPLACE FUNCTION public.fn_confirmar_compra(p_compra uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_sucursal UUID;
  v_usuario  UUID;
  bodega_id  UUID;
  r RECORD;
BEGIN
  PERFORM fn_prorratear_costos_compra(p_compra);

  SELECT sucursal_id, usuario_id
  INTO v_sucursal, v_usuario
  FROM compras
  WHERE id = p_compra;

  IF v_sucursal IS NULL THEN
    RAISE EXCEPTION 'Compra % sin sucursal', p_compra;
  END IF;

  SELECT id
  INTO bodega_id
  FROM ubicaciones
  WHERE sucursal_id = v_sucursal
    AND es_bodega = TRUE
  LIMIT 1;

  IF bodega_id IS NULL THEN
    RAISE EXCEPTION 'No hay ubicación BODEGA para la sucursal de la compra %', p_compra;
  END IF;

  -- ⚠️ Las ENTRADAS de inventario ya NO se insertan aquí:
  -- las crea únicamente fn_inventariar_compra_a_bodega (con idempotencia).
  FOR r IN
    SELECT producto_id, cantidad, costo_unitario_final
    FROM compras_detalle
    WHERE compra_id = p_compra
  LOOP
    PERFORM fn_aplicar_costo_promedio(r.producto_id, r.cantidad, r.costo_unitario_final);
  END LOOP;

  UPDATE compras
  SET estado = 'CONFIRMADA'
  WHERE id = p_compra;
END $function$;
