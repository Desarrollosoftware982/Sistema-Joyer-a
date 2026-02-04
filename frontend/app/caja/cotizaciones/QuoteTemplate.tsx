import Image from "next/image";

export type QuoteItem = {
  producto: string;
  cantidad: number;
  precio: number;
  total: number;
};

type Paper = "A4" | "LETTER";

type Props = {
  logoSrc?: string;

  fecha?: string;
  vendedor?: string;
  cliente?: string;
  descripcion?: string;

  items: QuoteItem[];
  totalGeneral: number;

  titulo?: string;
  paper?: Paper;
};

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("es-GT", {
    style: "currency",
    currency: "GTQ",
    minimumFractionDigits: 2,
  }).format(n);

export default function QuoteTemplate({
  logoSrc = "/logo-xuping-regina.png",
  titulo,
  fecha = "",
  vendedor = "",
  cliente = "",
  descripcion = "",
  items,
  totalGeneral,
  paper = "A4",
}: Props) {
  const visibleRows = 5;
  const itemsTop = items.slice(0, visibleRows);
  const emptyRows = Math.max(0, visibleRows - itemsTop.length);

  return (
    <div className={`sheet ${paper}`} id="quote-sheet">
      <div className="glow g1" />
      <div className="glow g2" />

      <div className="wrap">
        <header className="top">
          <div className="logoFrame">
            <Image
              src={logoSrc}
              alt="Xuping Regina"
              width={520}
              height={520}
              className="logo"
              priority
              unoptimized
              crossOrigin="anonymous"
              draggable={false}
            />
          </div>

          <div className="brand">
            <div className="brandTitle">XUPING REGINA</div>
            <div className="brandSub">JOYERÍA Y ACCESORIOS</div>
          </div>

          {titulo ? <div className="quoteTitle">{titulo}</div> : null}
        </header>

        <div className="ruleWrap">
          <div className="rule" />
        </div>

        <section className="meta">
          <div className="metaLeft">
            {/* ✅ SOLO CAMBIO: texto */}
            <div className="metaH">DETALLE DE LA COTIZACIÓN</div>

            <div className="descBox">
              {/* ✅ SOLO CAMBIO: si está vacío, no muestra placeholder */}
              {descripcion?.trim() ? descripcion : null}
            </div>
          </div>

          <div className="metaRight">
            <div className="metaCard">
              <div className="metaRow">
                <span className="metaLabel">FECHA</span>
                <span className="metaValueText">{fecha || "—"}</span>
              </div>
              <div className="metaRow">
                <span className="metaLabel">VENDEDOR</span>
                <span className="metaValueText">{vendedor || "—"}</span>
              </div>
              <div className="metaRow">
                <span className="metaLabel">CLIENTE</span>
                <span className="metaValueText">{cliente || "—"}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="table">
          <div className="thead">
            <div className="cell head">PRODUCTO</div>
            <div className="cell head headCenter">CANTIDAD</div>
            <div className="cell head headCenter">PRECIO</div>
            <div className="cell head headCenter">TOTAL</div>
          </div>

          {itemsTop.map((it, i) => (
            <div className="trow" key={i}>
              <div className="cell prod">
                <div className="prodName">{it.producto}</div>
              </div>
              <div className="cell num">{it.cantidad}</div>
              <div className="cell num">{fmtMoney(it.precio)}</div>
              <div className="cell num">{fmtMoney(it.total)}</div>
            </div>
          ))}

          {Array.from({ length: emptyRows }).map((_, i) => (
            <div className="trow" key={`empty-${i}`}>
              <div className="cell" />
              <div className="cell" />
              <div className="cell" />
              <div className="cell" />
            </div>
          ))}

          <div className="trow big">
            <div className="cell" />
            <div className="cell" />
            <div className="cell" />
            <div className="cell" />
          </div>

          <div className="tfoot">
            <div className="cell" />
            <div className="cell" />
            <div className="cell totalLabel">Total</div>
            <div className="cell totalValue">{fmtMoney(totalGeneral)}</div>
          </div>
        </section>

        <div className="below">
          <div className="note">
            Cotización válida por 30 días<span className="star">*</span>. Precios
            sujetos a cambios sin previo aviso.
          </div>

          {/* ✅ FIRMAS DESAPARECIDAS (no se renderiza nada) */}
        </div>
      </div>

      <div className="bottomRule" />

      <style jsx>{`
.sheet {
  /* Fondo tipo papel (blanco suave) */
  background: linear-gradient(
    180deg,
    #FBFAFA 0%,
    #FBFAFA 70%,
    #F7F5F6 100%
  );

  /* Variables de color SOLO para este template (alineadas al papel) */
  --paper: #FBFAFA;      /* base */
  --paper-alt: #F7F5F6;  /* variación suave */
  --paper-head: #F5F0EE; /* encabezado / zonas ligeramente más marcadas */
  --line: #D0CAC2;       /* líneas */
  --ink: #6A382E;        /* tinta (si ya la estás usando) */
}



        .sheet.A4 {
          width: 2480px;
          height: 3508px;
        }
        .sheet.LETTER {
          width: 2550px;
          height: 3300px;
        }

.sheet::before {
  content: "";
  display: none !important;
  background: none !important;
  opacity: 0 !important;
}


     /* Quita SOLO esa mancha/círculo */
.glow {
  display: none !important;
}

        .g1 {
          width: 720px;
          height: 720px;
          left: -120px;
          top: 460px;
          background: radial-gradient(
            circle,
            rgba(214, 176, 94, 0.45),
            transparent 60%
          );
        }
        .g2 {
          width: 900px;
          height: 900px;
          right: -240px;
          top: 980px;
          background: radial-gradient(
            circle,
            rgba(214, 176, 94, 0.35),
            transparent 60%
          );
        }

        .wrap {
          position: relative;
          padding: 160px 70px;
          width: 100%;
          box-sizing: border-box;
        }

        .top {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 26px;
          margin-bottom: 52px;
          text-align: center;
        }

        .logoFrame {
          width: 520px;
          height: 520px;
          border-radius: 34px;
          padding: 26px;
        background: linear-gradient(
  180deg,
  #7A2F27,
  #5E1F1A
); /* marrón vino en la “zona gris” del padding */

         border: 6px solid #F1D4BE; /* borde cálido tipo “oro crema” como el marco del logo */

          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45),
            inset 0 1px 0 rgba(255, 255, 255, 0.08);
          position: relative;
          overflow: hidden;
        }

        .logoFrame::after {
          content: "";
          position: absolute;
          inset: -40%;
          background: linear-gradient(
            120deg,
            transparent 40%,
            rgba(214, 176, 94, 0.22) 50%,
            transparent 60%
          );
          transform: rotate(8deg);
          opacity: 0.75;
          pointer-events: none;
        }

        .logo {
          width: 100%;
          height: 100%;
          object-fit: contain;
          filter: drop-shadow(0 16px 24px rgba(0, 0, 0, 0.45));
          position: relative;
          z-index: 1;
        }

.brandTitle {
  font-size: 92px;
  letter-spacing: 12px;
  text-transform: uppercase;

  /* tinta vino/marrón */
  color: #6A382E;

  /* look “impreso” (más robusta sin verse pesada) */
  font-weight: 700;

  /* sombra mínima, tipo impresión (nada de glow dorado) */
  text-shadow: 0 1px 0 rgba(0,0,0,0.22);

  /* serif clásico (usa la primera disponible) */
  font-family: "Cinzel", "Trajan Pro", "Times New Roman", Georgia, serif;

  margin-top: 4px;

  /* opcional, muy sutil: ayuda a “rellenar” como tinta */
  -webkit-text-stroke: 0.25px rgba(106, 56, 46, 0.65);
  paint-order: stroke fill;
}


.brandSub {
  margin-top: 4px;
  font-size: 44px;
  letter-spacing: 10px;
  text-transform: uppercase;

  color: #6A382E; /* tinta */
  opacity: 0.92;

  /* clave para poder dibujar las líneas */
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 28px; /* separación entre texto y líneas */
}
/* BRAND SUB: líneas doradas alineadas al centro visual del texto */
.brandSub {
  margin-top: 4px;
  font-size: 44px;
  letter-spacing: 10px;
  opacity: 0.92;
  color: #6A382E;

  display: flex;
  align-items: center;
  justify-content: center;
  gap: 28px;

  line-height: 1;
  white-space: nowrap;

  /* ✅ ajuste fino (mueve solo las líneas) */
  --sub-line-offset: 0.40em; /* prueba 0.24em–0.30em si quieres micro-ajuste */
}

/* líneas laterales */
.brandSub::before,
.brandSub::after {
  content: "";
  height: 2px;
  flex: 1 1 0;
  max-width: 520px;
  align-self: center;

  background: linear-gradient(
    90deg,
    transparent,
    rgba(214, 176, 94, 0.95),
    rgba(235, 206, 140, 0.85),
    rgba(214, 176, 94, 0.95),
    transparent
  );

  /* ✅ este es el que corrige la alineación */
  transform: translateY(var(--sub-line-offset));
}

.brandSub::after {
  background: linear-gradient(
    270deg,
    transparent,
    rgba(214, 176, 94, 0.95),
    rgba(235, 206, 140, 0.85),
    rgba(214, 176, 94, 0.95),
    transparent
  );
}



.quoteTitle {
  margin-top: 14px;
  font-size: 54px;
  letter-spacing: 4px;
  color: #6A382E;
  text-shadow: 0 10px 26px rgba(0, 0, 0, 0.45);

  /* ✅ SOLO esto: más robusta tipo impreso */
  font-weight: 800;
  -webkit-text-stroke: 0.6px #6A382E;
  paint-order: stroke fill;
}

        .ruleWrap {
          position: relative;
          margin: 42px 0 38px;
        }
        .rule {
          height: 8px;
          width: 100%;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(214, 176, 94, 0.95),
            rgba(235, 206, 140, 0.9),
            rgba(214, 176, 94, 0.95),
            transparent
          );
          border-radius: 999px;
          box-shadow: 0 8px 26px rgba(0, 0, 0, 0.35);
        }
        .ruleWrap::after {
          content: "";
          position: absolute;
          left: 0;
          right: 0;
          top: 14px;
          height: 2px;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(214, 176, 94, 0.6),
            transparent
          );
          opacity: 0.8;
        }

        .meta {
          display: grid;
          grid-template-columns: 1.35fr 1fr;
          gap: 46px;
          margin-bottom: 44px;
          align-items: start;
          width: 100%;
        }

    .metaH {
  font-size: 38px;
  letter-spacing: 3px;
  text-transform: uppercase;
  color: #6A382E;
  margin-bottom: 12px;

  /* ✅ SOLO esto: más robusta tipo impreso */
  font-weight: 800;
  -webkit-text-stroke: 0.5px #6A382E;
  paint-order: stroke fill;
}

        /* ✅ SOLO CAMBIO: quitar look de input */
        .descBox {
          font-size: 30px;
          letter-spacing: 0.6px;
          min-height: 0;
          padding: 0;
          background: transparent;
          border: none;
          border-radius: 0;
          box-shadow: none;
          line-height: 1.35;
          opacity: 0.95;
        }

        .placeholder {
          opacity: 0.55;
        }
.metaCard {
  width: 100%;
  padding: 18px 22px;
  border-radius: 16px;
  background: #F4EEE9; /* ✅ solo color */
  border: 2px solid rgba(214, 176, 94, 0.34);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 14px 34px rgba(0, 0, 0, 0.18);
}

.metaRow {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: baseline;
  padding: 10px 0;

  /* ✅ SOLO líneas más marcadas */
  border-bottom: 2px solid rgba(106, 56, 46, 0.28);
}

.metaRow {
  display: flex;
  justify-content: space-between;
  gap: 20px;

  /* ✅ SOLO esto: evita que el texto caiga sobre la línea */
  align-items: center;        /* antes: baseline */
  padding: 14px 0 18px;       /* antes: 10px 0 */

  border-bottom: 1px solid rgba(106, 56, 46, 0.18);
}

.metaLabel {
  font-size: 32px;
  letter-spacing: 2.6px;     /* más parecido al ejemplo */
  text-transform: uppercase;
  opacity: 0.92;
  color: #6A382E;

  /* look serif/impreso */
  font-family: "Cinzel", "Trajan Pro", "Times New Roman", Georgia, serif;
  font-weight: 800;
  line-height: 1.05;
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.18);
  -webkit-text-stroke: 0.35px rgba(106, 56, 46, 0.55);
  paint-order: stroke fill;
}

.metaValueText {
  font-size: 32px;
  letter-spacing: 0.9px;     /* un poco más “serio” como el ejemplo */
  opacity: 0.95;
  text-align: right;
  color: #6A382E;

  /* mismo estilo impreso */
  font-family: "Cinzel", "Trajan Pro", "Times New Roman", Georgia, serif;
  font-weight: 700;
  line-height: 1.05;
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.14);
  -webkit-text-stroke: 0.25px rgba(106, 56, 46, 0.45);
  paint-order: stroke fill;
}


        .table {
  margin-top: 22px;
  width: 100%;

  /* ✅ Beige más dorado */
  border: 4px solid #C9B48A;

  border-radius: 18px;
  overflow: hidden;
  position: relative;

  /* ✅ Papel con tinte dorado */
  background: linear-gradient(
    180deg,
    #FBFAFA,
    #F1E3C6
  );

  /* ✅ Delineado elegante (doble borde visual) SIN romper el radius */
  box-shadow:
    0 0 0 2px rgba(214, 176, 94, 0.35),   /* delineado externo sutil */
    inset 0 0 0 1px rgba(255, 255, 255, 0.55), /* brillo interno fino */
    0 28px 80px rgba(0, 0, 0, 0.42),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);

  color: #6A382E;
}

.table::before {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(
    1200px 500px at 50% 0%,
    rgba(214, 176, 94, 0.18), /* ✅ toque dorado suave */
    transparent 60%
  );
  pointer-events: none;
}

.thead,
.trow,
.tfoot {
  display: grid;
  grid-template-columns: 2.8fr 1.1fr 1.2fr 1.2fr;
  position: relative;
  z-index: 1;
}

.thead {
  /* ✅ Encabezado más dorado */
  background: linear-gradient(
    180deg,
    #EFE1C3,
    #FBFAFA
  );
  border-bottom: 3px solid #C9B48A;
}

.cell {
  padding: 24px 26px;
  border-right: 2px solid #C9B48A;
  min-height: 92px;
  font-size: 33px;
  font-weight: 500;
}

.cell:last-child {
  border-right: none;
}

.head {
  font-size: 40px;
  letter-spacing: 4px;
  text-transform: uppercase;
  color: #6A382E;
  text-shadow: 0 10px 20px rgba(0, 0, 0, 0.12);
  font-weight: 800;
}

.headCenter {
  text-align: center;
}

/* 1) Líneas del detalle (horizontales entre filas) en gris claro */
.trow {
  border-bottom: 1px solid rgba(0, 0, 0, 0.10); /* gris claro */
  background: #FBFAFA;
}

.trow:nth-child(even) {
  background: #F5F0EE;
}


.prodName {
  font-size: 33px;
  letter-spacing: 0.6px;
  font-weight: 600;
}

.num {
  text-align: right;
  font-weight: 600;
}

.trow.big {
  min-height: 820px;
  background: #FBFAFA;
}

/* 2) Fondo del TOTAL (tfoot) más claro */
.tfoot {
  border-top: 3px solid #C9B48A;
  background: #F7EEDB; /* beige más claro */
}

.totalLabel {
  text-align: center;
  color: #6A382E;
  font-weight: 800;
  letter-spacing: 3px;
  font-size: 40px;
}

.totalValue {
  text-align: right;
  color: #6A382E;
  font-weight: 900;
  font-size: 42px;
  letter-spacing: 1px;
}

        .below {
          margin-top: 26px;
          padding-top: 10px;
        }

      .note {
  margin-top: 0;
  font-size: 30px;
  opacity: 0.92;
  color: #6A382E;

  /* ✅ SOLO esto: más robusta tipo impreso */
  font-weight: 700;
  -webkit-text-stroke: 0.35px #6A382E;
  paint-order: stroke fill;
}

        .star {
          opacity: 0.7;
        }

        .bottomRule {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 95px;
          height: 10px;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(214, 176, 94, 0.95),
            rgba(235, 206, 140, 0.9),
            rgba(214, 176, 94, 0.95),
            transparent
          );
          opacity: 0.9;
        }
      `}</style>
    </div>
  );
}
