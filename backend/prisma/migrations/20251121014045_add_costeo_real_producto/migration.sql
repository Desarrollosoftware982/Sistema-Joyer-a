CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CreateEnum
CREATE TYPE "dte_status" AS ENUM ('PENDIENTE', 'EMITIDO', 'RECHAZADO', 'ANULADO');

-- CreateEnum
CREATE TYPE "dte_tipo" AS ENUM ('FACTURA', 'RECIBO');

-- CreateEnum
CREATE TYPE "move_type" AS ENUM ('ENTRADA', 'SALIDA', 'AJUSTE', 'VENTA', 'TRASPASO');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('EFECTIVO', 'TRANSFERENCIA', 'TARJETA');

-- CreateEnum
CREATE TYPE "purchase_status" AS ENUM ('BORRADOR', 'CONFIRMADA', 'ANULADA');

-- CreateEnum
CREATE TYPE "quote_status" AS ENUM ('BORRADOR', 'ENVIADA', 'ACEPTADA', 'RECHAZADA', 'VENCIDA');

-- CreateEnum
CREATE TYPE "sale_status" AS ENUM ('PENDIENTE', 'CONFIRMADA', 'ANULADA');

-- CreateTable
CREATE TABLE "categorias" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,

    CONSTRAINT "categorias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cierres_caja" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sucursal_id" UUID NOT NULL,
    "fecha_inicio" TIMESTAMPTZ(6) NOT NULL,
    "fecha_fin" TIMESTAMPTZ(6),
    "usuario_id" UUID NOT NULL,
    "total_efectivo" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_transferencia" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_tarjeta" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_general" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cierres_caja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clientes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "nit" TEXT,
    "telefono" TEXT,
    "redes" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compras" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "proveedor_id" UUID,
    "sucursal_id" UUID NOT NULL,
    "usuario_id" UUID,
    "fecha_factura" DATE,
    "fecha_ingreso" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "num_factura" TEXT,
    "guia_dhl" TEXT,
    "doc_sat" TEXT,
    "moneda" TEXT NOT NULL DEFAULT 'GTQ',
    "tipo_cambio" DECIMAL(12,4) NOT NULL DEFAULT 1,
    "subtotal_mercaderia" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "descuento_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "impuesto_compra" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "costo_envio" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "costo_desaduanaje" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "otros_costos" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_compra" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "prorrateada" BOOLEAN NOT NULL DEFAULT false,
    "estado" "purchase_status" NOT NULL DEFAULT 'BORRADOR',
    "observaciones" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compras_detalle" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "compra_id" UUID NOT NULL,
    "producto_id" UUID NOT NULL,
    "cantidad" DECIMAL(14,3) NOT NULL,
    "costo_unitario_base" DECIMAL(12,2) NOT NULL,
    "costo_unitario_final" DECIMAL(12,2),
    "total_base" DECIMAL(14,2),
    "total_final" DECIMAL(14,2),

    CONSTRAINT "compras_detalle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cotizaciones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "folio" SERIAL NOT NULL,
    "fecha" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sucursal_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "cliente_id" UUID,
    "cliente_nombre" TEXT,
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "descuento" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "impuestos" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "estado" "quote_status" NOT NULL DEFAULT 'BORRADOR',
    "observaciones" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cotizaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cotizaciones_detalle" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cotizacion_id" UUID NOT NULL,
    "producto_id" UUID,
    "cantidad" DECIMAL(12,3) NOT NULL,
    "precio_unitario" DECIMAL(12,2) NOT NULL,
    "descuento" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "impuesto" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_linea" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "cotizaciones_detalle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispositivos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "alias" TEXT,
    "sucursal_id" UUID,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispositivos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dte_documentos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "venta_id" UUID,
    "tipo" "dte_tipo" NOT NULL DEFAULT 'RECIBO',
    "serie" TEXT,
    "numero" TEXT,
    "sat_uuid" TEXT,
    "sat_fecha" TIMESTAMPTZ(6),
    "status" "dte_status" NOT NULL DEFAULT 'PENDIENTE',
    "certificador" TEXT,
    "req_json" JSONB,
    "resp_json" JSONB,
    "xml_url" TEXT,
    "pdf_url" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dte_documentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dte_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dte_id" UUID NOT NULL,
    "producto_id" UUID,
    "descripcion" TEXT NOT NULL,
    "cantidad" DECIMAL(12,3) NOT NULL,
    "precio_unitario" DECIMAL(12,2) NOT NULL,
    "impuesto" DECIMAL(12,2) NOT NULL,
    "total_linea" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "dte_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotencia" (
    "idempotency_key" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidad_id" UUID,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotencia_pkey" PRIMARY KEY ("idempotency_key")
);

-- CreateTable
CREATE TABLE "inventario_existencias" (
    "producto_id" UUID NOT NULL,
    "ubicacion_id" UUID NOT NULL,
    "stock" DECIMAL(14,3) NOT NULL DEFAULT 0,

    CONSTRAINT "inventario_existencias_pkey" PRIMARY KEY ("producto_id","ubicacion_id")
);

-- CreateTable
CREATE TABLE "inventario_movimientos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fecha" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tipo" "move_type" NOT NULL,
    "producto_id" UUID NOT NULL,
    "ubicacion_origen_id" UUID,
    "ubicacion_destino_id" UUID,
    "cantidad" DECIMAL(14,3) NOT NULL,
    "motivo" TEXT,
    "ref_venta_id" UUID,
    "usuario_id" UUID,
    "costo_unitario" DECIMAL(12,2),
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventario_movimientos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sku" TEXT NOT NULL,
    "codigo_barras" TEXT,
    "nombre" TEXT NOT NULL,
    "precio_venta" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "iva_porcentaje" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "costo_promedio" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "costo_ultimo" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "costo_compra" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "costo_envio" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "costo_impuestos" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "costo_desaduanaje" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "costo_real" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "stock_minimo" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "archivado" BOOLEAN NOT NULL DEFAULT false,
    "zero_since" TIMESTAMPTZ(6),
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "productos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productos_categorias" (
    "producto_id" UUID NOT NULL,
    "categoria_id" UUID NOT NULL,

    CONSTRAINT "productos_categorias_pkey" PRIMARY KEY ("producto_id","categoria_id")
);

-- CreateTable
CREATE TABLE "proveedores" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "nit" TEXT,
    "contacto" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "direccion" TEXT,
    "notas" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proveedores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sucursales" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "direccion" TEXT,
    "telefono" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sucursales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ubicaciones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sucursal_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "es_vitrina" BOOLEAN NOT NULL DEFAULT false,
    "es_bodega" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ubicaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "pass_hash" TEXT NOT NULL,
    "rol_id" UUID NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ventas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "folio" SERIAL NOT NULL,
    "fecha" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sucursal_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "cliente_id" UUID,
    "cliente_nombre" TEXT,
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "descuento" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "impuestos" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "estado" "sale_status" NOT NULL DEFAULT 'CONFIRMADA',
    "idempotency_key" TEXT,
    "dispositivo_id" UUID,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ventas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ventas_detalle" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "venta_id" UUID NOT NULL,
    "producto_id" UUID NOT NULL,
    "cantidad" DECIMAL(12,3) NOT NULL,
    "precio_unitario" DECIMAL(12,2) NOT NULL,
    "descuento" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "impuesto" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_linea" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "ventas_detalle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ventas_pagos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "venta_id" UUID NOT NULL,
    "metodo" "payment_method" NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "card_brand" TEXT,
    "card_last4" TEXT,
    "auth_code" TEXT,
    "processor_txn_id" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ventas_pagos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categorias_nombre_key" ON "categorias"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "dte_documentos_venta_id_key" ON "dte_documentos"("venta_id");

-- CreateIndex
CREATE UNIQUE INDEX "productos_sku_key" ON "productos"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "productos_codigo_barras_key" ON "productos"("codigo_barras");

-- CreateIndex
CREATE INDEX "idx_prod_codigo_barras" ON "productos"("codigo_barras");

-- CreateIndex
CREATE INDEX "idx_prod_nombre_trgm" ON "productos" ("nombre");

-- CreateIndex
CREATE INDEX "idx_prod_sku" ON "productos"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "roles_nombre_key" ON "roles"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "sucursales_codigo_key" ON "sucursales"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "ubicaciones_sucursal_id_nombre_key" ON "ubicaciones"("sucursal_id", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ventas_idempotency_key_key" ON "ventas"("idempotency_key");

-- AddForeignKey
ALTER TABLE "cierres_caja" ADD CONSTRAINT "cierres_caja_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cierres_caja" ADD CONSTRAINT "cierres_caja_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compras" ADD CONSTRAINT "compras_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "proveedores"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compras" ADD CONSTRAINT "compras_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compras" ADD CONSTRAINT "compras_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compras_detalle" ADD CONSTRAINT "compras_detalle_compra_id_fkey" FOREIGN KEY ("compra_id") REFERENCES "compras"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "compras_detalle" ADD CONSTRAINT "compras_detalle_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cotizaciones" ADD CONSTRAINT "cotizaciones_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cotizaciones" ADD CONSTRAINT "cotizaciones_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cotizaciones" ADD CONSTRAINT "cotizaciones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cotizaciones_detalle" ADD CONSTRAINT "cotizaciones_detalle_cotizacion_id_fkey" FOREIGN KEY ("cotizacion_id") REFERENCES "cotizaciones"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cotizaciones_detalle" ADD CONSTRAINT "cotizaciones_detalle_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dispositivos" ADD CONSTRAINT "dispositivos_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dte_documentos" ADD CONSTRAINT "dte_documentos_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "ventas"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dte_items" ADD CONSTRAINT "dte_items_dte_id_fkey" FOREIGN KEY ("dte_id") REFERENCES "dte_documentos"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dte_items" ADD CONSTRAINT "dte_items_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventario_existencias" ADD CONSTRAINT "inventario_existencias_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventario_existencias" ADD CONSTRAINT "inventario_existencias_ubicacion_id_fkey" FOREIGN KEY ("ubicacion_id") REFERENCES "ubicaciones"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventario_movimientos" ADD CONSTRAINT "inventario_movimientos_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventario_movimientos" ADD CONSTRAINT "inventario_movimientos_ubicacion_destino_id_fkey" FOREIGN KEY ("ubicacion_destino_id") REFERENCES "ubicaciones"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventario_movimientos" ADD CONSTRAINT "inventario_movimientos_ubicacion_origen_id_fkey" FOREIGN KEY ("ubicacion_origen_id") REFERENCES "ubicaciones"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inventario_movimientos" ADD CONSTRAINT "inventario_movimientos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "productos_categorias" ADD CONSTRAINT "productos_categorias_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "productos_categorias" ADD CONSTRAINT "productos_categorias_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ubicaciones" ADD CONSTRAINT "ubicaciones_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "roles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ventas" ADD CONSTRAINT "ventas_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ventas" ADD CONSTRAINT "ventas_dispositivo_id_fkey" FOREIGN KEY ("dispositivo_id") REFERENCES "dispositivos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ventas" ADD CONSTRAINT "ventas_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ventas" ADD CONSTRAINT "ventas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ventas_detalle" ADD CONSTRAINT "ventas_detalle_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ventas_detalle" ADD CONSTRAINT "ventas_detalle_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "ventas"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ventas_pagos" ADD CONSTRAINT "ventas_pagos_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "ventas"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
