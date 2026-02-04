const ExcelJS = require("exceljs");
const prisma = require("../config/prisma");

function mustISODate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function isDateTimeLocal(s) {
  return (
    typeof s === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)
  );
}

function parseFechaInput(value) {
  if (!value) return null;
  if (mustISODate(value)) {
    return new Date(`${value}T00:00:00-06:00`);
  }
  if (isDateTimeLocal(value)) {
    return new Date(value);
  }
  return null;
}

function isUuid(s) {
  return typeof s === "string" && /^[0-9a-fA-F-]{36}$/.test(s);
}

function toNum(x) {
  if (x === null || x === undefined) return 0;
  if (typeof x === "number") return x;
  if (typeof x === "string") return Number(x);
  if (typeof x === "bigint") return Number(x);
  if (typeof x?.toNumber === "function") return x.toNumber();
  if (typeof x?.toString === "function") return Number(x.toString());
  return Number(x);
}

function fmtDateTime(d) {
  if (!d) return "";
  const dt = new Date(d);
  return dt.toISOString().replace("T", " ").slice(0, 19);
}

function qfmt(cell) {
  cell.numFmt = "#,##0.00";
}

async function resolveSucursalIdForUser(userId) {
  const user = await prisma.usuarios.findUnique({
    where: { id: userId },
    select: { sucursal_id: true },
  });

  if (user?.sucursal_id) {
    const suc = await prisma.sucursales.findUnique({
      where: { id: user.sucursal_id },
      select: { id: true },
    });
    if (suc?.id) return suc.id;
  }

  const sp = await prisma.sucursales.findFirst({
    where: { codigo: "SP" },
    select: { id: true },
  });

  return sp?.id ?? null;
}

function buildDateRange(from, to) {
  if (!from && !to) return null;
  const fromDate = from ? new Date(`${from}T00:00:00-06:00`) : null;
  const toDate = to ? new Date(`${to}T23:59:59-06:00`) : null;
  return { fromDate, toDate };
}

function buildWhere({ from, to, cajera_id, sucursal_id }) {
  const where = {};
  if (cajera_id) where.cajera_id = cajera_id;
  if (sucursal_id) where.sucursal_id = sucursal_id;
  const range = buildDateRange(from, to);
  if (range?.fromDate || range?.toDate) {
    where.fecha = {};
    if (range.fromDate) where.fecha.gte = range.fromDate;
    if (range.toDate) where.fecha.lte = range.toDate;
  }
  return where;
}

exports.listEntregas = async (req, res) => {
  try {
    const { from, to } = req.query;
    let { cajera_id, sucursal_id } = req.query;
    const roleNorm = String(req.user?.roleName ?? "").trim().toUpperCase();
    const isAdmin = roleNorm === "ADMIN";

    if (from && !mustISODate(from)) {
      return res.status(400).json({ ok: false, message: "from invalido" });
    }
    if (to && !mustISODate(to)) {
      return res.status(400).json({ ok: false, message: "to invalido" });
    }
    if (cajera_id && !isUuid(cajera_id)) {
      return res.status(400).json({ ok: false, message: "cajera_id invalido" });
    }
    if (sucursal_id && !isUuid(sucursal_id)) {
      return res
        .status(400)
        .json({ ok: false, message: "sucursal_id invalido" });
    }

    if (!isAdmin) {
      cajera_id = req.user?.userId || null;
      sucursal_id = await resolveSucursalIdForUser(req.user?.userId);
    }

    const items = await prisma.caja_chica_entregas.findMany({
      where: buildWhere({ from, to, cajera_id, sucursal_id }),
      orderBy: { fecha: "desc" },
      include: {
        cajera: { select: { id: true, nombre: true, email: true } },
        autorizado_por: { select: { id: true, nombre: true, email: true } },
        sucursales: { select: { id: true, nombre: true, codigo: true } },
      },
    });

    res.json({ ok: true, data: { items } });
  } catch (err) {
    console.error("Error listEntregas:", err);
    res.status(500).json({ ok: false, message: "Error listando entregas" });
  }
};

exports.listCambios = async (req, res) => {
  try {
    const { from, to } = req.query;
    let { cajera_id, sucursal_id } = req.query;
    const roleNorm = String(req.user?.roleName ?? "").trim().toUpperCase();
    const isAdmin = roleNorm === "ADMIN";

    if (from && !mustISODate(from)) {
      return res.status(400).json({ ok: false, message: "from invalido" });
    }
    if (to && !mustISODate(to)) {
      return res.status(400).json({ ok: false, message: "to invalido" });
    }
    if (cajera_id && !isUuid(cajera_id)) {
      return res.status(400).json({ ok: false, message: "cajera_id invalido" });
    }
    if (sucursal_id && !isUuid(sucursal_id)) {
      return res
        .status(400)
        .json({ ok: false, message: "sucursal_id invalido" });
    }

    if (!isAdmin) {
      cajera_id = req.user?.userId || null;
      sucursal_id = await resolveSucursalIdForUser(req.user?.userId);
    }

    const items = await prisma.caja_chica_gastos.findMany({
      where: buildWhere({ from, to, cajera_id, sucursal_id }),
      orderBy: { fecha: "desc" },
      include: {
        cajera: { select: { id: true, nombre: true, email: true } },
        autorizado_por: { select: { id: true, nombre: true, email: true } },
        sucursales: { select: { id: true, nombre: true, codigo: true } },
      },
    });

    res.json({ ok: true, data: { items } });
  } catch (err) {
    console.error("Error listCambios:", err);
    res.status(500).json({ ok: false, message: "Error listando cambios" });
  }
};

exports.createEntrega = async (req, res) => {
  try {
    const { sucursal_id, cajera_id, monto, motivo, fecha } = req.body || {};
    const autorizado_por_id = req.user?.userId;

    if (!autorizado_por_id) {
      return res.status(401).json({ ok: false, message: "No autenticado" });
    }
    if (!sucursal_id || !isUuid(sucursal_id)) {
      return res
        .status(400)
        .json({ ok: false, message: "sucursal_id invalido" });
    }
    if (!cajera_id || !isUuid(cajera_id)) {
      return res
        .status(400)
        .json({ ok: false, message: "cajera_id invalido" });
    }

    const montoNum = Number(monto);
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      return res.status(400).json({ ok: false, message: "monto invalido" });
    }

    let fechaValue = undefined;
    if (fecha) {
      const parsed = parseFechaInput(fecha);
      if (!parsed || Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ ok: false, message: "fecha invalida" });
      }
      fechaValue = parsed;
    }

    const created = await prisma.caja_chica_entregas.create({
      data: {
        sucursal_id,
        cajera_id,
        autorizado_por_id,
        monto: montoNum,
        motivo: motivo ? String(motivo) : null,
        ...(fechaValue ? { fecha: fechaValue } : {}),
      },
    });

    res.json({ ok: true, data: created });
  } catch (err) {
    console.error("Error createEntrega:", err);
    res.status(500).json({ ok: false, message: "Error creando entrega" });
  }
};

exports.resumenCajaChica = async (req, res) => {
  try {
    const { date } = req.query;
    const dateStr = date && mustISODate(date) ? date : null;
    if (date && !dateStr) {
      return res.status(400).json({ ok: false, message: "date invalido" });
    }
    const roleNorm = String(req.user?.roleName ?? "").trim().toUpperCase();
    const isAdmin = roleNorm === "ADMIN";
    const userId = req.user?.userId || null;
    const sucursalId = !isAdmin && userId ? await resolveSucursalIdForUser(userId) : null;

    const baseDate = dateStr
      ? new Date(`${dateStr}T00:00:00-06:00`)
      : new Date();

    const startDay = new Date(baseDate);
    startDay.setHours(0, 0, 0, 0);
    const endDay = new Date(startDay);
    endDay.setDate(endDay.getDate() + 1);

    const startMonth = new Date(startDay.getFullYear(), startDay.getMonth(), 1);
    const endMonth = new Date(startDay.getFullYear(), startDay.getMonth() + 1, 1);

    const baseWhere = !isAdmin
      ? { cajera_id: userId, sucursal_id: sucursalId }
      : {};

    const [entregasHoy, cambiosHoy, entregasMes, cambiosMes, ultimaEntrega, ultimoCambio] =
      await Promise.all([
        prisma.caja_chica_entregas.aggregate({
          where: { ...baseWhere, fecha: { gte: startDay, lt: endDay } },
          _sum: { monto: true },
        }),
        prisma.caja_chica_gastos.aggregate({
          where: { ...baseWhere, fecha: { gte: startDay, lt: endDay } },
          _sum: { monto: true },
        }),
        prisma.caja_chica_entregas.aggregate({
          where: { ...baseWhere, fecha: { gte: startMonth, lt: endMonth } },
          _sum: { monto: true },
        }),
        prisma.caja_chica_gastos.aggregate({
          where: { ...baseWhere, fecha: { gte: startMonth, lt: endMonth } },
          _sum: { monto: true },
        }),
        prisma.caja_chica_entregas.findFirst({
          where: baseWhere,
          orderBy: { fecha: "desc" },
        }),
        prisma.caja_chica_gastos.findFirst({
          where: baseWhere,
          orderBy: { fecha: "desc" },
        }),
      ]);

    const totalEntregadoHoy = toNum(entregasHoy._sum.monto);
    const totalCambiosHoy = toNum(cambiosHoy._sum.monto);
    const totalEntregadoMes = toNum(entregasMes._sum.monto);
    const totalCambiosMes = toNum(cambiosMes._sum.monto);
    const saldoMes = totalEntregadoMes - totalCambiosMes;

    res.json({
      ok: true,
      data: {
        totalEntregadoHoy,
        totalCambiosHoy,
        totalEntregadoMes,
        totalCambiosMes,
        saldoMes,
        ultimaEntrega: ultimaEntrega
          ? { fecha: ultimaEntrega.fecha, monto: toNum(ultimaEntrega.monto) }
          : null,
        ultimoCambio: ultimoCambio
          ? { fecha: ultimoCambio.fecha, monto: toNum(ultimoCambio.monto) }
          : null,
      },
    });
  } catch (err) {
    console.error("Error resumenCajaChica:", err);
    res.status(500).json({ ok: false, message: "Error cargando resumen" });
  }
};

exports.exportCajaChicaExcel = async (req, res) => {
  try {
    const { from, to } = req.query;
    let { cajera_id, sucursal_id } = req.query;
    const roleNorm = String(req.user?.roleName ?? "").trim().toUpperCase();
    const isAdmin = roleNorm === "ADMIN";

    if (from && !mustISODate(from)) {
      return res.status(400).send("from invalido");
    }
    if (to && !mustISODate(to)) {
      return res.status(400).send("to invalido");
    }
    if (cajera_id && !isUuid(cajera_id)) {
      return res.status(400).send("cajera_id invalido");
    }
    if (sucursal_id && !isUuid(sucursal_id)) {
      return res.status(400).send("sucursal_id invalido");
    }

    if (!isAdmin) {
      cajera_id = req.user?.userId || null;
      sucursal_id = await resolveSucursalIdForUser(req.user?.userId);
    }

    const where = buildWhere({ from, to, cajera_id, sucursal_id });

    const [entregas, cambios] = await Promise.all([
      prisma.caja_chica_entregas.findMany({
        where,
        orderBy: { fecha: "asc" },
        include: {
          cajera: { select: { nombre: true, email: true } },
          autorizado_por: { select: { nombre: true, email: true } },
          sucursales: { select: { nombre: true, codigo: true } },
        },
      }),
      prisma.caja_chica_gastos.findMany({
        where,
        orderBy: { fecha: "asc" },
        include: {
          cajera: { select: { nombre: true, email: true } },
          autorizado_por: { select: { nombre: true, email: true } },
          sucursales: { select: { nombre: true, codigo: true } },
        },
      }),
    ]);

    const totalEntregas = entregas.reduce((acc, e) => acc + toNum(e.monto), 0);
    const totalCambios = cambios.reduce((acc, g) => acc + toNum(g.monto), 0);
    const saldo = totalEntregas - totalCambios;

    const wb = new ExcelJS.Workbook();
    wb.creator = "Sistema Joyeria";

    const wsR = wb.addWorksheet("Resumen");
    wsR.columns = [
      { header: "Desde", key: "desde", width: 14 },
      { header: "Hasta", key: "hasta", width: 14 },
      { header: "Total entregas (Q)", key: "ent", width: 20 },
      { header: "Total cambios (Q)", key: "cam", width: 20 },
      { header: "Saldo (Q)", key: "saldo", width: 14 },
    ];
    wsR.getRow(1).font = { bold: true };
    wsR.views = [{ state: "frozen", ySplit: 1 }];
    const r1 = wsR.addRow({
      desde: from || "",
      hasta: to || "",
      ent: totalEntregas,
      cam: totalCambios,
      saldo,
    });
    qfmt(r1.getCell("ent"));
    qfmt(r1.getCell("cam"));
    qfmt(r1.getCell("saldo"));

    const wsE = wb.addWorksheet("Entregas");
    wsE.columns = [
      { header: "Fecha", key: "fecha", width: 20 },
      { header: "Cajera", key: "cajera", width: 20 },
      { header: "Sucursal", key: "sucursal", width: 18 },
      { header: "Monto (Q)", key: "monto", width: 14 },
      { header: "Motivo/Nota", key: "motivo", width: 28 },
      { header: "Autorizo", key: "autorizo", width: 20 },
    ];
    wsE.getRow(1).font = { bold: true };
    wsE.views = [{ state: "frozen", ySplit: 1 }];

    for (const e of entregas) {
      const row = wsE.addRow({
        fecha: fmtDateTime(e.fecha),
        cajera: e.cajera?.nombre || "",
        sucursal: e.sucursales?.nombre || "",
        monto: toNum(e.monto),
        motivo: e.motivo || "",
        autorizo: e.autorizado_por?.nombre || "",
      });
      qfmt(row.getCell("monto"));
    }

    const wsG = wb.addWorksheet("Cambios");
    wsG.columns = [
      { header: "Fecha", key: "fecha", width: 20 },
      { header: "Cajera", key: "cajera", width: 20 },
      { header: "Sucursal", key: "sucursal", width: 18 },
      { header: "Monto (Q)", key: "monto", width: 14 },
      { header: "Motivo/Nota", key: "motivo", width: 28 },
      { header: "Autorizo", key: "autorizo", width: 20 },
    ];
    wsG.getRow(1).font = { bold: true };
    wsG.views = [{ state: "frozen", ySplit: 1 }];

    for (const g of cambios) {
      const row = wsG.addRow({
        fecha: fmtDateTime(g.fecha),
        cajera: g.cajera?.nombre || "",
        sucursal: g.sucursales?.nombre || "",
        monto: toNum(g.monto),
        motivo: g.motivo || "",
        autorizo: g.autorizado_por?.nombre || "",
      });
      qfmt(row.getCell("monto"));
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    const fileName = `caja-chica_${from || "todo"}_a_${to || "todo"}.xlsx`;
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Error exportCajaChicaExcel:", err);
    res.status(500).send("Error generando Excel de caja chica.");
  }
};

exports.saldoCajaChica = async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, message: "No autenticado" });
    }

    const user = await prisma.usuarios.findUnique({
      where: { id: userId },
      select: { sucursal_id: true },
    });

    let sucursalId = user?.sucursal_id || null;
    if (!sucursalId) {
      const sp = await prisma.sucursales.findFirst({
        where: { codigo: "SP" },
        select: { id: true },
      });
      sucursalId = sp?.id || null;
    }

    if (!sucursalId) {
      return res.status(400).json({
        ok: false,
        message: "sucursal_id es requerido (asigna usuarios.sucursal_id o crea SP).",
      });
    }

    const now = new Date();
    const startDay = new Date(now);
    startDay.setHours(0, 0, 0, 0);
    const endDay = new Date(startDay);
    endDay.setDate(endDay.getDate() + 1);

    const [entregasHoy, cambiosHoy, ultimaEntrega, ultimoCambio] =
      await Promise.all([
        prisma.caja_chica_entregas.aggregate({
          where: {
            cajera_id: userId,
            sucursal_id: sucursalId,
            fecha: { gte: startDay, lt: endDay },
          },
          _sum: { monto: true },
        }),
        prisma.caja_chica_gastos.aggregate({
          where: {
            cajera_id: userId,
            sucursal_id: sucursalId,
            fecha: { gte: startDay, lt: endDay },
          },
          _sum: { monto: true },
        }),
        prisma.caja_chica_entregas.findFirst({
          where: { cajera_id: userId, sucursal_id: sucursalId },
          orderBy: { fecha: "desc" },
        }),
        prisma.caja_chica_gastos.findFirst({
          where: { cajera_id: userId, sucursal_id: sucursalId },
          orderBy: { fecha: "desc" },
        }),
      ]);

    const totalEntregadoHoy = toNum(entregasHoy._sum.monto);
    const totalCambiosHoy = toNum(cambiosHoy._sum.monto);
    const saldoHoy = totalEntregadoHoy - totalCambiosHoy;

    res.json({
      ok: true,
      data: {
        totalEntregadoHoy,
        totalCambiosHoy,
        saldoHoy,
        ultimaEntrega: ultimaEntrega
          ? { fecha: ultimaEntrega.fecha, monto: toNum(ultimaEntrega.monto) }
          : null,
        ultimoCambio: ultimoCambio
          ? { fecha: ultimoCambio.fecha, monto: toNum(ultimoCambio.monto) }
          : null,
      },
    });
  } catch (err) {
    console.error("Error saldoCajaChica:", err);
    res.status(500).json({ ok: false, message: "Error cargando saldo" });
  }
};
