import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend
} from "recharts";
import {
  LayoutDashboard, Receipt, Users, CreditCard, Tag, Plus, X, Pencil, Trash2,
  ChevronLeft, ChevronRight, Check, ArrowDownCircle, ArrowUpCircle, Layers,
  CalendarClock, FileDown, UploadCloud, AlertTriangle, FileText, Loader2
} from "lucide-react";
import jsPDF from "jspdf";

/* ============================================================
   HELPERS
   ============================================================ */

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const fmt = (n) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n || 0);

const fmtUSD = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n || 0);

const fmtDate = (isoStr) => {
  if (!isoStr) return "";
  const d = new Date(isoStr + "T00:00:00");
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
};

function computeStatementMonth(dateStr, closingDay) {
  const d = new Date(dateStr + "T00:00:00");
  let y = d.getFullYear();
  let m = d.getMonth() + 1;
  const day = d.getDate();
  if (day > closingDay) {
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return { y, m };
}
function keyOf({ y, m }) { return `${y}-${String(m).padStart(2, "0")}`; }
function addMonthsToKey(key, delta) {
  let [y, m] = key.split("-").map(Number);
  m += delta;
  while (m > 12) { m -= 12; y += 1; }
  while (m < 1) { m += 12; y -= 1; }
  return `${y}-${String(m).padStart(2, "0")}`;
}
function monthsBetweenKeys(aKey, bKey) {
  const [ay, am] = aKey.split("-").map(Number);
  const [by, bm] = bKey.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}
function labelOfKey(key) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  const s = d.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function shortLabelOfKey(key) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  const s = d.toLocaleDateString("es-AR", { month: "short" }).replace(".", "");
  return s.charAt(0).toUpperCase() + s.slice(1) + " " + String(y).slice(2);
}
function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/* Clave normalizada para el diccionario de descripciones aprendidas */
function normDesc(s) {
  return (s || "").trim().toUpperCase().replace(/\s+/g, " ");
}

/* Convierte "SUPERMERCADO COTO SA" en algo más legible por defecto */
function cleanupDescription(raw) {
  return (raw || "")
    .toLowerCase()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase())
    .replace(/\s{2,}/g, " ")
    .trim();
}

function ensureCargosCategory(categories) {
  if (categories.some((c) => c.id === "cargos")) return categories;
  return [...categories, { id: "cargos", name: "Impuestos y cargos tarjeta", color: "#B5793E" }];
}

/* Sugiere a qué tarjeta del usuario corresponde una sub-cuenta detectada
   en el PDF (ej. Naranja X combina "NX Virtual" y "NX Master" en un mismo
   resumen, que en la app son tarjetas separadas) */
function guessCardForSubAccount(subAccount, cards, fallbackCardId) {
  if (!subAccount) return fallbackCardId;
  const s = subAccount.toUpperCase();
  if (s.includes("MASTER")) {
    const m = cards.find((c) => /master/i.test(c.name));
    if (m) return m.id;
  }
  const n = cards.find((c) => /naranja/i.test(c.name) && !/master/i.test(c.name));
  if (n) return n.id;
  return fallbackCardId;
}

/* Conversión a ARS según la moneda original del gasto */
function rateOf(tx) { return tx.currency === "USD" ? (Number(tx.exchangeRate) || 0) : 1; }
function txTotalARS(tx) { return Math.round(tx.amount * rateOf(tx) * 100) / 100; }
function txCuotaARS(tx) { return Math.round(tx.montoCuota * rateOf(tx) * 100) / 100; }

/* Contribución de una transacción a un mes de resumen puntual (targetKey),
   usando el startMonth ya calculado/guardado en la transacción */
function getContribution(tx, targetKey) {
  const N = tx.cuotas || 1;
  const idx = monthsBetweenKeys(tx.startMonth, targetKey);
  if (idx >= 0 && idx < N) {
    return { active: true, cuotaNum: idx + 1, total: N, monto: txCuotaARS(tx) };
  }
  return { active: false };
}

/* Migra transacciones guardadas en formato viejo (sin moneda/startMonth) */
function migrateTransaction(tx, cards) {
  if (tx.amount !== undefined && tx.startMonth) return tx;
  const amount = tx.amount ?? tx.montoTotal ?? 0;
  const currency = tx.currency || "ARS";
  const exchangeRate = tx.exchangeRate ?? (currency === "USD" ? 1 : undefined);
  const cuotas = tx.cuotas || 1;
  const montoCuota = tx.montoCuota ?? Math.round((amount / cuotas) * 100) / 100;
  let startMonth = tx.startMonth;
  if (!startMonth) {
    const card = cards.find((c) => c.id === tx.cardId);
    startMonth = keyOf(computeStatementMonth(tx.date, card ? card.closingDay : 1));
  }
  return { ...tx, amount, currency, exchangeRate, cuotas, montoCuota, startMonth };
}

/* ============================================================
   SEED DATA
   ============================================================ */

const SEED_CARDS = [
  { id: "naranjax", name: "Naranja X", type: "credito", owner: "propia", closingDay: 19, color: "#C9A15D" },
  { id: "mc-naranjax", name: "Mastercard Naranja X", type: "credito", owner: "propia", closingDay: 19, color: "#8C7A5B" },
  { id: "cabal-credicoop", name: "CABAL Credicoop", type: "credito", owner: "propia", closingDay: 8, color: "#6E8FBF" },
  { id: "visa-credicoop", name: "VISA Credicoop", type: "credito", owner: "propia", closingDay: 8, color: "#BD5C48" },
  { id: "visa-bbva", name: "VISA BBVA (novia)", type: "credito", owner: "novia", closingDay: 12, color: "#7F9C6E" },
  { id: "visa-galicia", name: "VISA Galicia (novia)", type: "credito", owner: "novia", closingDay: 6, color: "#A87FBF" },
  { id: "prestamo-mp", name: "Préstamo MercadoPago", type: "prestamo", owner: "propia", closingDay: 16, color: "#5C9C6E" },
  { id: "efectivo", name: "Efectivo / Transferencia", type: "efectivo", owner: "propia", closingDay: 1, color: "#9AA1B8" },
];

const SEED_CATEGORIES = [
  { id: "comida", name: "Comida", color: "#C9A15D" },
  { id: "servicios", name: "Servicios", color: "#6E8FBF" },
  { id: "entretenimiento", name: "Entretenimiento", color: "#A87FBF" },
  { id: "transporte", name: "Transporte", color: "#7F9C6E" },
  { id: "salud", name: "Salud", color: "#BD5C48" },
  { id: "indumentaria", name: "Indumentaria", color: "#C97A8F" },
  { id: "hogar", name: "Hogar", color: "#8C7A5B" },
  { id: "suscripciones", name: "Suscripciones", color: "#5C8C9C" },
  { id: "compras", name: "Compras / Cuotas", color: "#9C8C5C" },
  { id: "otros", name: "Otros", color: "#9AA1B8" },
  { id: "cargos", name: "Impuestos y cargos tarjeta", color: "#B5793E" },
];

const SEED_FAMILY = [
  { id: "mama", name: "Mamá" },
  { id: "papa", name: "Papá" },
  { id: "hermana", name: "Hermana" },
  { id: "novia", name: "Novia" },
];

const emptyData = () => ({
  cards: SEED_CARDS,
  categories: SEED_CATEGORIES,
  familyMembers: SEED_FAMILY,
  transactions: [],
  repayments: [],
  sueldo: 2000000,
  descriptionMappings: {},
});

/* ============================================================
   STYLE
   ============================================================ */

const GlobalStyle = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap');

    .ect-root {
      --bg: #0E1320;
      --surface: #161C2C;
      --surface-2: #1D2438;
      --border: #2A3250;
      --text: #EDEAE1;
      --text-dim: #9AA1B8;
      --gold: #C9A15D;
      --green: #5C9C6E;
      --red: #BD5C48;
      --blue: #6E8FBF;
      font-family: 'Inter', sans-serif;
      background: var(--bg);
      color: var(--text);
      width: 100%;
      min-height: 100vh;
      display: flex;
      box-sizing: border-box;
    }
    .ect-root * { box-sizing: border-box; }
    .ect-mono { font-family: 'IBM Plex Mono', monospace; font-variant-numeric: tabular-nums; }
    .ect-display { font-family: 'Fraunces', serif; }

    .ect-sidebar {
      width: 232px;
      flex-shrink: 0;
      background: var(--surface);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      padding: 28px 16px;
      height: 100vh;
      position: sticky;
      top: 0;
    }
    .ect-brand {
      font-family: 'Fraunces', serif;
      font-size: 22px;
      font-weight: 600;
      letter-spacing: 0.5px;
      color: var(--gold);
      padding: 0 10px 4px;
    }
    .ect-brand-sub {
      font-size: 10.5px;
      color: var(--text-dim);
      padding: 0 10px 26px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      border-bottom: 1px dashed var(--border);
      margin-bottom: 18px;
    }
    .ect-nav-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 6px;
      color: var(--text-dim);
      font-size: 13.5px;
      font-weight: 500;
      cursor: pointer;
      margin-bottom: 2px;
      transition: background .15s, color .15s;
      border: 1px solid transparent;
    }
    .ect-nav-item:hover { background: var(--surface-2); color: var(--text); }
    .ect-nav-item.active {
      background: var(--surface-2);
      color: var(--gold);
      border-color: var(--border);
    }
    .ect-nav-item svg { width: 16px; height: 16px; flex-shrink: 0; }
    .ect-sidebar-foot {
      margin-top: auto;
      padding: 12px 10px 0;
      font-size: 11px;
      color: var(--text-dim);
      border-top: 1px dashed var(--border);
    }
    .ect-sueldo-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; }

    .ect-main {
      flex: 1;
      min-width: 0;
      padding: 28px 40px 60px;
      height: 100vh;
      overflow-y: auto;
    }
    .ect-topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 26px;
      flex-wrap: wrap;
      gap: 14px;
    }
    .ect-page-title {
      font-family: 'Fraunces', serif;
      font-size: 26px;
      font-weight: 600;
      color: var(--text);
    }
    .ect-month-nav {
      display: flex;
      align-items: center;
      gap: 10px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 6px 8px;
    }
    .ect-month-nav button.arrow {
      background: transparent;
      border: none;
      color: var(--text-dim);
      cursor: pointer;
      display: flex;
      align-items: center;
      padding: 4px;
      border-radius: 4px;
    }
    .ect-month-nav button.arrow:hover { background: var(--surface-2); color: var(--gold); }
    .ect-month-label {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 13.5px;
      letter-spacing: 0.5px;
      color: var(--gold);
      min-width: 150px;
      text-align: center;
      text-transform: capitalize;
    }

    .ect-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--gold);
      color: #1B1408;
      border: none;
      padding: 9px 16px;
      border-radius: 7px;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      transition: filter .15s, transform .1s;
      white-space: nowrap;
    }
    .ect-btn:hover { filter: brightness(1.08); }
    .ect-btn:active { transform: scale(0.98); }
    .ect-btn.secondary {
      background: var(--surface-2);
      color: var(--text);
      border: 1px solid var(--border);
    }
    .ect-btn.ghost {
      background: transparent;
      color: var(--text-dim);
      border: 1px solid var(--border);
      padding: 7px 12px;
    }
    .ect-btn.danger { background: var(--red); color: #fff; }
    .ect-btn.sm { padding: 6px 11px; font-size: 12px; }
    .ect-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .ect-grid { display: grid; gap: 18px; }
    .ect-kpis { grid-template-columns: repeat(4, 1fr); margin-bottom: 22px; }
    .ect-panel {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 20px 22px;
      position: relative;
    }
    .ect-panel::before {
      content: "";
      position: absolute;
      top: 0; left: 18px; right: 18px;
      height: 1px;
      background: repeating-linear-gradient(90deg, var(--border) 0 6px, transparent 6px 12px);
    }
    .ect-kpi-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      color: var(--text-dim);
      margin-bottom: 10px;
    }
    .ect-kpi-value {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 25px;
      font-weight: 600;
      color: var(--text);
    }
    .ect-kpi-value.gold { color: var(--gold); }
    .ect-kpi-value.red { color: var(--red); }
    .ect-kpi-value.green { color: var(--green); }
    .ect-kpi-delta {
      margin-top: 8px;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 4px;
      color: var(--text-dim);
    }
    .ect-kpi-delta svg { width: 13px; height: 13px; }
    .ect-kpi-delta.up { color: var(--red); }
    .ect-kpi-delta.down { color: var(--green); }

    .ect-section-title {
      font-family: 'Fraunces', serif;
      font-size: 15px;
      font-weight: 600;
      color: var(--text);
      margin: 0 0 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .ect-section-title .tag {
      font-family: 'Inter', sans-serif;
      font-size: 10px;
      color: var(--text-dim);
      font-weight: 500;
      background: var(--surface-2);
      border: 1px solid var(--border);
      padding: 2px 7px;
      border-radius: 20px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .ect-ledger-row {
      display: flex;
      align-items: baseline;
      gap: 8px;
      padding: 9px 2px;
      border-bottom: 1px solid var(--border);
      font-size: 13px;
    }
    .ect-ledger-row:last-child { border-bottom: none; }
    .ect-ledger-desc { color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ect-ledger-dots {
      flex: 1;
      border-bottom: 1px dotted var(--border);
      margin-bottom: 4px;
      min-width: 20px;
    }
    .ect-ledger-amt {
      font-family: 'IBM Plex Mono', monospace;
      font-weight: 600;
      color: var(--text);
      white-space: nowrap;
    }
    .ect-ledger-meta { font-size: 11px; color: var(--text-dim); white-space: nowrap; }

    .ect-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; display: inline-block; }
    .ect-badge {
      font-size: 10.5px;
      font-family: 'IBM Plex Mono', monospace;
      background: var(--surface-2);
      border: 1px solid var(--border);
      padding: 1px 7px;
      border-radius: 20px;
      color: var(--text-dim);
      white-space: nowrap;
    }
    .ect-badge.gold { color: var(--gold); border-color: #4a3d20; }
    .ect-badge.blue { color: var(--blue); border-color: #263349; }
    .ect-badge.green { color: var(--green); border-color: #24402c; }

    table.ect-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    table.ect-table thead th {
      text-align: left;
      font-size: 10.5px;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: var(--text-dim);
      font-weight: 600;
      padding: 0 10px 10px;
      border-bottom: 1px solid var(--border);
    }
    table.ect-table td {
      padding: 11px 10px;
      border-bottom: 1px solid var(--border);
      color: var(--text);
      vertical-align: middle;
    }
    table.ect-table tbody tr:hover { background: var(--surface-2); }
    table.ect-table td.amt { font-family: 'IBM Plex Mono', monospace; font-weight: 600; text-align: right; }
    table.ect-table .row-actions { display: flex; gap: 6px; justify-content: flex-end; }
    .ect-icon-btn {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-dim);
      width: 26px; height: 26px;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      flex-shrink: 0;
    }
    .ect-icon-btn:hover { color: var(--gold); border-color: var(--gold); }
    .ect-icon-btn.del:hover { color: var(--red); border-color: var(--red); }

    .ect-empty {
      color: var(--text-dim);
      font-size: 13px;
      padding: 30px 10px;
      text-align: center;
      border: 1px dashed var(--border);
      border-radius: 8px;
    }

    .ect-filters { display: flex; gap: 10px; margin-bottom: 18px; flex-wrap: wrap; }
    .ect-select, .ect-input {
      background: var(--surface-2);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 12px;
      border-radius: 7px;
      font-size: 13px;
      font-family: 'Inter', sans-serif;
    }
    .ect-select:focus, .ect-input:focus { outline: 1px solid var(--gold); }

    .ect-modal-overlay {
      position: fixed; inset: 0;
      background: rgba(6,8,14,0.7);
      display: flex; align-items: center; justify-content: center;
      z-index: 100;
      backdrop-filter: blur(2px);
    }
    .ect-modal {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      width: 480px;
      max-width: 92vw;
      max-height: 88vh;
      overflow-y: auto;
      padding: 26px 26px 22px;
    }
    .ect-modal-head {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 18px;
    }
    .ect-modal-title { font-family: 'Fraunces', serif; font-size: 18px; font-weight: 600; }
    .ect-form-row { margin-bottom: 14px; }
    .ect-form-row label {
      display: block;
      font-size: 11.5px;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--text-dim);
      margin-bottom: 6px;
    }
    .ect-form-row input, .ect-form-row select {
      width: 100%;
      background: var(--surface-2);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 9px 11px;
      border-radius: 7px;
      font-size: 13.5px;
      font-family: 'Inter', sans-serif;
    }
    .ect-form-row input:focus, .ect-form-row select:focus { outline: 1px solid var(--gold); }
    .ect-form-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .ect-form-3col { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
    .ect-form-hint { font-size: 11.5px; color: var(--text-dim); margin-top: 6px; }
    .ect-toggle-row {
      display: flex; align-items: center; justify-content: space-between;
      background: var(--surface-2);
      border: 1px solid var(--border);
      padding: 10px 13px;
      border-radius: 8px;
      margin-bottom: 14px;
    }
    .ect-toggle-row span { font-size: 13px; color: var(--text); }
    .ect-switch {
      width: 38px; height: 21px; border-radius: 20px;
      background: var(--border);
      position: relative; cursor: pointer; flex-shrink: 0;
      transition: background .15s;
    }
    .ect-switch.on { background: var(--gold); }
    .ect-switch .knob {
      position: absolute; top: 2px; left: 2px;
      width: 17px; height: 17px; border-radius: 50%;
      background: var(--text); transition: left .15s;
    }
    .ect-switch.on .knob { left: 19px; background: #1B1408; }
    .ect-modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
    .ect-inline-add { display: flex; gap: 8px; margin-top: 8px; }
    .ect-color-swatch {
      width: 30px; height: 30px; border-radius: 7px; border: 1px solid var(--border); cursor: pointer; flex-shrink: 0;
    }

    .ect-family-grid { grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); margin-bottom: 24px; }
    .ect-person-card { cursor: pointer; transition: border-color .15s; }
    .ect-person-card:hover { border-color: var(--gold); }
    .ect-person-card.active { border-color: var(--gold); }
    .ect-person-name { font-family: 'Fraunces', serif; font-size: 16px; font-weight: 600; margin-bottom: 10px; }
    .ect-person-balance { font-family: 'IBM Plex Mono', monospace; font-size: 21px; font-weight: 600; }

    .ect-dropzone {
      border: 1.5px dashed var(--border);
      border-radius: 10px;
      padding: 46px 20px;
      text-align: center;
      color: var(--text-dim);
      cursor: pointer;
      transition: border-color .15s, background .15s;
    }
    .ect-dropzone:hover, .ect-dropzone.drag { border-color: var(--gold); background: var(--surface-2); color: var(--text); }
    .ect-dropzone input { display: none; }

    .ect-import-row {
      border: 1px solid var(--border);
      border-radius: 9px;
      padding: 12px 14px;
      margin-bottom: 10px;
      background: var(--surface-2);
    }
    .ect-import-row.excluded { opacity: 0.45; }
    .ect-import-row-top {
      display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap;
    }
    .ect-import-row-orig {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 11px;
      color: var(--text-dim);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      max-width: 320px;
    }
    .ect-import-row-grid {
      display: grid;
      grid-template-columns: 1.3fr 1fr 1fr 0.75fr 0.9fr 1fr 1.15fr;
      gap: 10px;
      align-items: end;
    }
    .ect-import-row-grid label {
      display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
      color: var(--text-dim); margin-bottom: 4px;
    }
    .ect-import-row-grid input, .ect-import-row-grid select {
      width: 100%; background: var(--surface); border: 1px solid var(--border); color: var(--text);
      padding: 7px 9px; border-radius: 6px; font-size: 12.5px; font-family: 'Inter', sans-serif;
    }
    .ect-import-summary-bar {
      position: sticky; bottom: 0;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px 18px;
      display: flex; align-items: center; justify-content: space-between;
      margin-top: 14px;
    }

    ::-webkit-scrollbar { width: 9px; height: 9px; }
    ::-webkit-scrollbar-track { background: var(--bg); }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 10px; }
    .ect-spin { animation: ect-spin-kf 0.9s linear infinite; }
    @keyframes ect-spin-kf { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  `}</style>
);

/* ============================================================
   GENERIC UI PIECES
   ============================================================ */

function Modal({ title, onClose, children, width }) {
  return (
    <div className="ect-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ect-modal" style={width ? { width } : undefined}>
        <div className="ect-modal-head">
          <div className="ect-modal-title">{title}</div>
          <button className="ect-icon-btn" onClick={onClose}><X size={15} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Switch({ on, onClick }) {
  return (
    <div className={`ect-switch ${on ? "on" : ""}`} onClick={onClick}>
      <div className="knob" />
    </div>
  );
}

function MonthNav({ monthKey, setMonthKey }) {
  return (
    <div className="ect-month-nav">
      <button className="arrow" onClick={() => setMonthKey(addMonthsToKey(monthKey, -1))}><ChevronLeft size={16} /></button>
      <span className="ect-month-label">{labelOfKey(monthKey)}</span>
      <button className="arrow" onClick={() => setMonthKey(addMonthsToKey(monthKey, 1))}><ChevronRight size={16} /></button>
    </div>
  );
}

function CurrencyTag({ tx }) {
  if (tx.currency !== "USD") return null;
  return <span className="ect-badge blue" title={`USD ${tx.amount.toFixed(2)} · TC ${tx.exchangeRate}`}>USD</span>;
}

/* ============================================================
   TRANSACTION FORM (gasto personal o familiar)
   ============================================================ */

function TransactionForm({ initial, cards, categories, familyMembers, allTransactions, defaultMonthKey, onSave, onClose, onAddCategory, onAddFamily }) {
  const [description, setDescription] = useState(initial?.description || "");
  const [currency, setCurrency] = useState(initial?.currency || "ARS");
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [exchangeRate, setExchangeRate] = useState(initial?.exchangeRate ?? "");
  const [date, setDate] = useState(initial?.date || new Date().toISOString().slice(0, 10));
  const [categoryId, setCategoryId] = useState(initial?.categoryId || categories[0]?.id || "");
  const [cardId, setCardId] = useState(initial?.cardId || cards[0]?.id || "");
  const [enCuotas, setEnCuotas] = useState((initial?.cuotas || 1) > 1);
  const [cuotasTotal, setCuotasTotal] = useState(initial?.cuotas && initial.cuotas > 1 ? initial.cuotas : 3);
  const [mesResumen, setMesResumen] = useState(defaultMonthKey || currentMonthKey());
  const [cuotaActual, setCuotaActual] = useState(() => {
    if (initial?.cuotas > 1 && initial?.startMonth) {
      const base = defaultMonthKey || currentMonthKey();
      const idx = monthsBetweenKeys(initial.startMonth, base) + 1;
      return Math.min(Math.max(1, idx), initial.cuotas);
    }
    return 1;
  });
  const [esFamiliar, setEsFamiliar] = useState(!!initial?.isFamily);
  const [familyPersonId, setFamilyPersonId] = useState(initial?.familyPersonId || familyMembers[0]?.id || "");
  const [newCatName, setNewCatName] = useState("");
  const [newPersonName, setNewPersonName] = useState("");
  const [showNewCat, setShowNewCat] = useState(false);
  const [showNewPerson, setShowNewPerson] = useState(false);

  const uniqueDescriptions = useMemo(() => {
    const seen = new Map();
    [...allTransactions].sort((a, b) => new Date(b.date) - new Date(a.date)).forEach((t) => {
      const key = t.description.trim().toLowerCase();
      if (!seen.has(key)) seen.set(key, t);
    });
    return Array.from(seen.values());
  }, [allTransactions]);

  const handleDescriptionChange = (val) => {
    setDescription(val);
    const match = uniqueDescriptions.find((t) => t.description.trim().toLowerCase() === val.trim().toLowerCase());
    if (match) {
      setCategoryId(match.categoryId);
      setCardId(match.cardId);
    }
  };

  const amountNum = Number(amount) || 0;
  const rateNum = currency === "USD" ? (Number(exchangeRate) || 0) : 1;
  const totalARS = Math.round(amountNum * rateNum * 100) / 100;
  const cuotaOriginal = enCuotas && amountNum && cuotasTotal ? amountNum / Number(cuotasTotal) : amountNum;
  const cuotaARS = Math.round(cuotaOriginal * rateNum * 100) / 100;

  const cuotasValid = !enCuotas || (Number(cuotasTotal) >= 2 && Number(cuotaActual) >= 1 && Number(cuotaActual) <= Number(cuotasTotal));
  const canSave = description.trim() && amountNum > 0 && date && categoryId && cardId &&
    (!esFamiliar || familyPersonId) && (currency !== "USD" || rateNum > 0) && cuotasValid;

  const handleSave = () => {
    const N = enCuotas ? Math.max(1, Number(cuotasTotal)) : 1;
    let startMonth;
    if (enCuotas) {
      const cA = Math.min(Math.max(1, Number(cuotaActual)), N);
      startMonth = addMonthsToKey(mesResumen, -(cA - 1));
    } else {
      const card = cards.find((c) => c.id === cardId);
      startMonth = keyOf(computeStatementMonth(date, card ? card.closingDay : 1));
    }
    const tx = {
      id: initial?.id || uid(),
      description: description.trim(),
      amount: amountNum,
      currency,
      exchangeRate: currency === "USD" ? rateNum : undefined,
      montoCuota: Math.round((amountNum / N) * 100) / 100,
      date,
      categoryId,
      cardId,
      cuotas: N,
      startMonth,
      isFamily: esFamiliar,
      familyPersonId: esFamiliar ? familyPersonId : null,
    };
    onSave(tx);
  };

  return (
    <Modal title={initial ? "Editar gasto" : "Nuevo gasto"} onClose={onClose}>
      <div className="ect-form-row">
        <label>Descripción</label>
        <input
          list="ect-desc-suggestions"
          value={description}
          onChange={(e) => handleDescriptionChange(e.target.value)}
          placeholder="Ej: Supermercado, Netflix, Zapatillas..."
        />
        <datalist id="ect-desc-suggestions">
          {uniqueDescriptions.map((t) => <option key={t.id} value={t.description} />)}
        </datalist>
      </div>

      <div className="ect-form-2col">
        <div className="ect-form-row">
          <label>Moneda</label>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="ARS">Pesos (ARS)</option>
            <option value="USD">Dólares (USD)</option>
          </select>
        </div>
        <div className="ect-form-row">
          <label>Monto {currency === "USD" ? "(USD)" : "(ARS)"}</label>
          <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </div>
      </div>

      {currency === "USD" && (
        <div className="ect-form-row">
          <label>Tipo de cambio (ARS por USD, al momento de la compra)</label>
          <input type="number" step="0.01" min="0" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} placeholder="Ej: 1250.00" />
          {amountNum > 0 && rateNum > 0 && (
            <div className="ect-form-hint">Equivale a {fmt(totalARS)}</div>
          )}
        </div>
      )}

      <div className="ect-form-row">
        <label>Fecha de la compra</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div className="ect-form-row">
        <label>Medio de pago</label>
        <select value={cardId} onChange={(e) => setCardId(e.target.value)}>
          {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="ect-form-row">
        <label>Categoría</label>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {!showNewCat ? (
          <button type="button" className="ect-btn ghost sm" style={{ marginTop: 8 }} onClick={() => setShowNewCat(true)}>
            <Plus size={13} /> Nueva categoría
          </button>
        ) : (
          <div className="ect-inline-add">
            <input placeholder="Nombre de categoría" value={newCatName} onChange={(e) => setNewCatName(e.target.value)} />
            <button className="ect-btn sm" onClick={() => {
              if (!newCatName.trim()) return;
              const cat = onAddCategory(newCatName.trim());
              setCategoryId(cat.id);
              setNewCatName(""); setShowNewCat(false);
            }}>Agregar</button>
          </div>
        )}
      </div>

      <div className="ect-toggle-row">
        <span>¿Es en cuotas?</span>
        <Switch on={enCuotas} onClick={() => setEnCuotas(!enCuotas)} />
      </div>
      {enCuotas && (
        <>
          <div className="ect-form-3col">
            <div className="ect-form-row">
              <label>Cuotas totales</label>
              <input type="number" min="2" value={cuotasTotal} onChange={(e) => setCuotasTotal(e.target.value)} />
            </div>
            <div className="ect-form-row">
              <label>Cuota actual</label>
              <input type="number" min="1" max={cuotasTotal} value={cuotaActual} onChange={(e) => setCuotaActual(e.target.value)} />
            </div>
            <div className="ect-form-row">
              <label>Mes de este resumen</label>
              <input type="month" value={mesResumen} onChange={(e) => setMesResumen(e.target.value)} />
            </div>
          </div>
          <div className="ect-form-hint" style={{ marginTop: -8, marginBottom: 14 }}>
            Cuota por período: {fmt(cuotaARS)}{currency === "USD" ? ` (USD ${cuotaOriginal.toFixed(2)})` : ""}
          </div>
        </>
      )}

      <div className="ect-toggle-row">
        <span>¿Es un gasto familiar? (mamá, papá, hermana, novia...)</span>
        <Switch on={esFamiliar} onClick={() => setEsFamiliar(!esFamiliar)} />
      </div>
      {esFamiliar && (
        <div className="ect-form-row">
          <label>Persona</label>
          <select value={familyPersonId} onChange={(e) => setFamilyPersonId(e.target.value)}>
            {familyMembers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {!showNewPerson ? (
            <button type="button" className="ect-btn ghost sm" style={{ marginTop: 8 }} onClick={() => setShowNewPerson(true)}>
              <Plus size={13} /> Agregar persona
            </button>
          ) : (
            <div className="ect-inline-add">
              <input placeholder="Nombre" value={newPersonName} onChange={(e) => setNewPersonName(e.target.value)} />
              <button className="ect-btn sm" onClick={() => {
                if (!newPersonName.trim()) return;
                const p = onAddFamily(newPersonName.trim());
                setFamilyPersonId(p.id);
                setNewPersonName(""); setShowNewPerson(false);
              }}>Agregar</button>
            </div>
          )}
        </div>
      )}

      <div className="ect-modal-actions">
        <button className="ect-btn secondary" onClick={onClose}>Cancelar</button>
        <button className="ect-btn" disabled={!canSave} onClick={handleSave}>
          <Check size={14} /> Guardar
        </button>
      </div>
    </Modal>
  );
}

function RepaymentForm({ person, onSave, onClose }) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  return (
    <Modal title={`Registrar devolución — ${person.name}`} onClose={onClose} width={420}>
      <div className="ect-form-2col">
        <div className="ect-form-row">
          <label>Monto (ARS)</label>
          <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </div>
        <div className="ect-form-row">
          <label>Fecha</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div className="ect-form-row">
        <label>Nota (opcional)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej: transferencia, efectivo..." />
      </div>
      <div className="ect-modal-actions">
        <button className="ect-btn secondary" onClick={onClose}>Cancelar</button>
        <button
          className="ect-btn"
          disabled={!(Number(amount) > 0)}
          onClick={() => onSave({ id: uid(), personId: person.id, amount: Math.round(Number(amount) * 100) / 100, date, note })}
        >
          <Check size={14} /> Guardar
        </button>
      </div>
    </Modal>
  );
}

function EditSalaryModal({ current, onSave, onClose }) {
  const [value, setValue] = useState(current);
  return (
    <Modal title="Editar sueldo mensual" onClose={onClose} width={360}>
      <div className="ect-form-row">
        <label>Monto (ARS)</label>
        <input type="number" step="0.01" min="0" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      </div>
      <div className="ect-modal-actions">
        <button className="ect-btn secondary" onClick={onClose}>Cancelar</button>
        <button className="ect-btn" disabled={!(Number(value) > 0)} onClick={() => onSave(Number(value))}>
          <Check size={14} /> Guardar
        </button>
      </div>
    </Modal>
  );
}

/* ============================================================
   DASHBOARD VIEW
   ============================================================ */

function Dashboard({ data, monthKey, setMonthKey }) {
  const { cards, categories, transactions } = data;

  const cardTotals = useMemo(() => cards.map((card) => {
    let total = 0;
    transactions.filter(t => t.cardId === card.id).forEach(tx => {
      const c = getContribution(tx, monthKey);
      if (c.active) total += c.monto;
    });
    return { card, total };
  }), [cards, transactions, monthKey]);

  const totalGeneral = cardTotals.reduce((a, c) => a + c.total, 0);

  const totalFamiliar = useMemo(() => {
    let t = 0;
    transactions.filter(tx => tx.isFamily).forEach(tx => {
      const c = getContribution(tx, monthKey);
      if (c.active) t += c.monto;
    });
    return t;
  }, [transactions, monthKey]);

  const totalPersonal = totalGeneral - totalFamiliar;

  const prevMonthKey = addMonthsToKey(monthKey, -1);
  const prevPersonal = useMemo(() => {
    let t = 0;
    transactions.filter(tx => !tx.isFamily).forEach(tx => {
      const c = getContribution(tx, prevMonthKey);
      if (c.active) t += c.monto;
    });
    return t;
  }, [transactions, prevMonthKey]);

  const delta = prevPersonal > 0 ? ((totalPersonal - prevPersonal) / prevPersonal) * 100 : null;

  const categoryTotals = useMemo(() => {
    const map = {};
    transactions.filter(tx => !tx.isFamily).forEach(tx => {
      const c = getContribution(tx, monthKey);
      if (c.active) map[tx.categoryId] = (map[tx.categoryId] || 0) + c.monto;
    });
    return categories.map(cat => ({ name: cat.name, value: map[cat.id] || 0, color: cat.color })).filter(x => x.value > 0);
  }, [transactions, categories, monthKey]);

  const trend = useMemo(() => {
    const out = [];
    for (let i = 5; i >= 0; i--) {
      const k = addMonthsToKey(monthKey, -i);
      let personal = 0, familiar = 0;
      transactions.forEach(tx => {
        const c = getContribution(tx, k);
        if (c.active) { if (tx.isFamily) familiar += c.monto; else personal += c.monto; }
      });
      out.push({ month: shortLabelOfKey(k), Personal: Math.round(personal), Familiar: Math.round(familiar) });
    }
    return out;
  }, [transactions, monthKey]);

  const futureCommitted = useMemo(() => {
    const out = [];
    for (let i = 1; i <= 6; i++) {
      const k = addMonthsToKey(monthKey, i);
      let total = 0;
      transactions.filter(tx => (tx.cuotas || 1) > 1).forEach(tx => {
        const c = getContribution(tx, k);
        if (c.active) total += c.monto;
      });
      out.push({ month: shortLabelOfKey(k), total: Math.round(total) });
    }
    return out;
  }, [transactions, monthKey]);

  const activeInstallments = useMemo(() => {
    return transactions.filter(tx => (tx.cuotas || 1) > 1).map(tx => {
      const card = cards.find(c => c.id === tx.cardId);
      const c = getContribution(tx, monthKey);
      return { tx, card, c };
    }).filter(x => x.c.active);
  }, [transactions, cards, monthKey]);

  return (
    <div>
      <div className="ect-topbar">
        <div className="ect-page-title">Panel general</div>
        <MonthNav monthKey={monthKey} setMonthKey={setMonthKey} />
      </div>

      <div className="ect-grid ect-kpis">
        <div className="ect-panel">
          <div className="ect-kpi-label">Total en tarjetas (mes)</div>
          <div className="ect-kpi-value gold">{fmt(totalGeneral)}</div>
        </div>
        <div className="ect-panel">
          <div className="ect-kpi-label">Mi gasto real</div>
          <div className="ect-kpi-value">{fmt(totalPersonal)}</div>
          {delta !== null && (
            <div className={`ect-kpi-delta ${delta >= 0 ? "up" : "down"}`}>
              {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}% vs. mes anterior
            </div>
          )}
        </div>
        <div className="ect-panel">
          <div className="ect-kpi-label">Gasto familiar (a cobrar)</div>
          <div className="ect-kpi-value red">{fmt(totalFamiliar)}</div>
        </div>
        <div className="ect-panel">
          <div className="ect-kpi-label">Cuotas activas este mes</div>
          <div className="ect-kpi-value">{activeInstallments.length}</div>
        </div>
      </div>

      <div className="ect-grid" style={{ gridTemplateColumns: "1.3fr 1fr", marginBottom: 22 }}>
        <div className="ect-panel">
          <div className="ect-section-title">Tendencia — últimos 6 meses <span className="tag">personal vs. familiar</span></div>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2A3250" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: "#9AA1B8", fontSize: 11 }} axisLine={{ stroke: "#2A3250" }} tickLine={false} />
              <YAxis tick={{ fill: "#9AA1B8", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ background: "#1D2438", border: "1px solid #2A3250", borderRadius: 8, fontSize: 12 }} formatter={(v) => fmt(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Personal" stackId="a" fill="#C9A15D" radius={[0, 0, 0, 0]} />
              <Bar dataKey="Familiar" stackId="a" fill="#BD5C48" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="ect-panel">
          <div className="ect-section-title">Gasto por categoría <span className="tag">sin familiares</span></div>
          {categoryTotals.length === 0 ? (
            <div className="ect-empty">Sin gastos personales cargados este mes</div>
          ) : (
            <ResponsiveContainer width="100%" height={230}>
              <PieChart>
                <Pie data={categoryTotals} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={80} paddingAngle={2}>
                  {categoryTotals.map((entry, i) => <Cell key={i} fill={entry.color} stroke="#161C2C" strokeWidth={2} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "#1D2438", border: "1px solid #2A3250", borderRadius: 8, fontSize: 12 }} formatter={(v) => fmt(v)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="ect-grid" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 22 }}>
        <div className="ect-panel">
          <div className="ect-section-title">Resumen por tarjeta <span className="tag">{labelOfKey(monthKey)}</span></div>
          {cardTotals.filter(c => c.total > 0).length === 0 ? (
            <div className="ect-empty">No hay movimientos en este mes de resumen</div>
          ) : cardTotals.filter(c => c.total > 0).sort((a, b) => b.total - a.total).map(({ card, total }) => (
            <div className="ect-ledger-row" key={card.id}>
              <span className="ect-dot" style={{ background: card.color }} />
              <span className="ect-ledger-desc">{card.name}</span>
              <span className="ect-ledger-dots" />
              <span className="ect-ledger-amt">{fmt(total)}</span>
            </div>
          ))}
        </div>

        <div className="ect-panel">
          <div className="ect-section-title"><CalendarClock size={15} /> Cuotas comprometidas — próximos 6 meses</div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={futureCommitted}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2A3250" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: "#9AA1B8", fontSize: 11 }} axisLine={{ stroke: "#2A3250" }} tickLine={false} />
              <YAxis tick={{ fill: "#9AA1B8", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ background: "#1D2438", border: "1px solid #2A3250", borderRadius: 8, fontSize: 12 }} formatter={(v) => fmt(v)} />
              <Line type="monotone" dataKey="total" stroke="#C9A15D" strokeWidth={2} dot={{ fill: "#C9A15D", r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="ect-panel">
        <div className="ect-section-title"><Layers size={15} /> Cuotas activas este mes</div>
        {activeInstallments.length === 0 ? (
          <div className="ect-empty">No tenés cuotas activas en {labelOfKey(monthKey)}</div>
        ) : (
          <table className="ect-table">
            <thead>
              <tr><th>Descripción</th><th>Tarjeta</th><th>Cuota</th><th style={{ textAlign: "right" }}>Monto</th></tr>
            </thead>
            <tbody>
              {activeInstallments.map(({ tx, card, c }) => (
                <tr key={tx.id}>
                  <td>{tx.description} <CurrencyTag tx={tx} /> {tx.isFamily && <span className="ect-badge blue" style={{ marginLeft: 6 }}>familiar</span>}</td>
                  <td><span className="ect-dot" style={{ background: card.color, marginRight: 6 }} />{card.name}</td>
                  <td><span className="ect-badge gold">{c.cuotaNum}/{c.total}</span></td>
                  <td className="amt">{fmt(c.monto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   EXPENSES VIEW
   ============================================================ */

function ExpensesView({ data, monthKey, setMonthKey, onAdd, onEdit, onDelete, onAddCategory, onAddFamily }) {
  const { cards, categories, transactions, familyMembers } = data;
  const [filterCard, setFilterCard] = useState("all");
  const [filterCat, setFilterCat] = useState("all");
  const [filterFamily, setFilterFamily] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const rows = useMemo(() => {
    return transactions.map(tx => {
      const card = cards.find(c => c.id === tx.cardId);
      const cat = categories.find(c => c.id === tx.categoryId);
      const c = getContribution(tx, monthKey);
      return { tx, card, cat, c };
    }).filter(r => r.c.active)
      .filter(r => filterCard === "all" || r.tx.cardId === filterCard)
      .filter(r => filterCat === "all" || r.tx.categoryId === filterCat)
      .filter(r => filterFamily === "all" || (filterFamily === "familiar" ? r.tx.isFamily : !r.tx.isFamily))
      .sort((a, b) => new Date(b.tx.date) - new Date(a.tx.date));
  }, [transactions, cards, categories, monthKey, filterCard, filterCat, filterFamily]);

  const total = rows.reduce((a, r) => a + r.c.monto, 0);

  return (
    <div>
      <div className="ect-topbar">
        <div className="ect-page-title">Gastos</div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <MonthNav monthKey={monthKey} setMonthKey={setMonthKey} />
          <button className="ect-btn" onClick={() => { setEditing(null); setShowForm(true); }}><Plus size={15} /> Nuevo gasto</button>
        </div>
      </div>

      <div className="ect-filters">
        <select className="ect-select" value={filterCard} onChange={(e) => setFilterCard(e.target.value)}>
          <option value="all">Todas las tarjetas</option>
          {cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="ect-select" value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
          <option value="all">Todas las categorías</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="ect-select" value={filterFamily} onChange={(e) => setFilterFamily(e.target.value)}>
          <option value="all">Personales y familiares</option>
          <option value="personal">Solo personales</option>
          <option value="familiar">Solo familiares</option>
        </select>
        <div className="ect-badge gold" style={{ marginLeft: "auto", padding: "8px 14px", fontSize: 13 }}>
          Total filtrado: {fmt(total)}
        </div>
      </div>

      <div className="ect-panel">
        {rows.length === 0 ? (
          <div className="ect-empty">No hay gastos que coincidan con el filtro en {labelOfKey(monthKey)}</div>
        ) : (
          <table className="ect-table">
            <thead>
              <tr>
                <th>Fecha</th><th>Descripción</th><th>Tarjeta</th><th>Categoría</th><th>Cuota</th>
                <th style={{ textAlign: "right" }}>Monto</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ tx, card, cat, c }) => (
                <tr key={tx.id}>
                  <td className="ect-mono" style={{ color: "var(--text-dim)" }}>{fmtDate(tx.date)}</td>
                  <td>{tx.description} <CurrencyTag tx={tx} /> {tx.isFamily && <span className="ect-badge blue" style={{ marginLeft: 6 }}>
                    {familyMembers.find(f => f.id === tx.familyPersonId)?.name || "familiar"}
                  </span>}</td>
                  <td><span className="ect-dot" style={{ background: card?.color, marginRight: 6 }} />{card?.name}</td>
                  <td><span className="ect-dot" style={{ background: cat?.color, marginRight: 6 }} />{cat?.name || "Sin categoría"}</td>
                  <td>{tx.cuotas > 1 ? <span className="ect-badge gold">{c.cuotaNum}/{c.total}</span> : <span className="ect-badge">contado</span>}</td>
                  <td className="amt">{fmt(c.monto)}</td>
                  <td>
                    <div className="row-actions">
                      <button className="ect-icon-btn" onClick={() => { setEditing(tx); setShowForm(true); }}><Pencil size={13} /></button>
                      <button className="ect-icon-btn del" onClick={() => onDelete(tx.id)}><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showForm && (
        <TransactionForm
          initial={editing}
          cards={cards}
          categories={categories}
          familyMembers={familyMembers}
          allTransactions={transactions}
          defaultMonthKey={monthKey}
          onAddCategory={onAddCategory}
          onAddFamily={onAddFamily}
          onClose={() => setShowForm(false)}
          onSave={(tx) => { editing ? onEdit(tx) : onAdd(tx); setShowForm(false); }}
        />
      )}
    </div>
  );
}

/* ============================================================
   FAMILY VIEW
   ============================================================ */

function generateFamilyPDF(person, gastos, devs, balance) {
  const doc = new jsPDF();
  const marginX = 14;
  const rightX = 196;
  let y = 20;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(`Reporte de gastos — ${person.name}`, marginX, y);
  y += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Generado el ${new Date().toLocaleDateString("es-AR")}`, marginX, y);
  doc.setTextColor(0);
  y += 12;

  const ensureSpace = (needed) => {
    if (y + needed > 285) { doc.addPage(); y = 20; }
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Gastos", marginX, y);
  y += 7;
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text("Fecha", marginX, y);
  doc.text("Descripción", marginX + 24, y);
  doc.text("Cuotas", marginX + 128, y);
  doc.text("Monto", rightX, y, { align: "right" });
  doc.setTextColor(0);
  y += 2;
  doc.setDrawColor(200);
  doc.line(marginX, y, rightX, y);
  y += 6;
  doc.setFont("helvetica", "normal");

  const sortedGastos = [...gastos].sort((a, b) => new Date(a.date) - new Date(b.date));
  if (sortedGastos.length === 0) {
    doc.setTextColor(140);
    doc.text("Sin gastos cargados.", marginX, y);
    doc.setTextColor(0);
    y += 8;
  }
  sortedGastos.forEach((tx) => {
    ensureSpace(8);
    doc.text(fmtDate(tx.date), marginX, y);
    const desc = tx.description.length > 48 ? tx.description.slice(0, 48) + "…" : tx.description;
    doc.text(desc + (tx.currency === "USD" ? ` (USD ${tx.amount.toFixed(2)})` : ""), marginX + 24, y);
    doc.text(tx.cuotas > 1 ? `${tx.cuotas} cuotas` : "contado", marginX + 128, y);
    doc.text(fmt(txTotalARS(tx)), rightX, y, { align: "right" });
    y += 6;
  });

  y += 3;
  ensureSpace(10);
  doc.setDrawColor(200);
  doc.line(marginX, y, rightX, y);
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.text(`Total gastos: ${fmt(gastos.reduce((a, tx) => a + txTotalARS(tx), 0))}`, marginX, y);
  y += 14;

  ensureSpace(20);
  doc.setFontSize(12);
  doc.text("Devoluciones", marginX, y);
  y += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text("Fecha", marginX, y);
  doc.text("Nota", marginX + 24, y);
  doc.text("Monto", rightX, y, { align: "right" });
  doc.setTextColor(0);
  y += 2;
  doc.setDrawColor(200);
  doc.line(marginX, y, rightX, y);
  y += 6;

  const sortedDevs = [...devs].sort((a, b) => new Date(a.date) - new Date(b.date));
  if (sortedDevs.length === 0) {
    doc.setTextColor(140);
    doc.text("Sin devoluciones registradas.", marginX, y);
    doc.setTextColor(0);
    y += 8;
  }
  sortedDevs.forEach((r) => {
    ensureSpace(8);
    doc.text(fmtDate(r.date), marginX, y);
    doc.text(r.note || "-", marginX + 24, y);
    doc.text(fmt(r.amount), rightX, y, { align: "right" });
    y += 6;
  });

  y += 3;
  ensureSpace(14);
  doc.setDrawColor(200);
  doc.line(marginX, y, rightX, y);
  y += 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(`Saldo pendiente: ${fmt(balance)}`, marginX, y);

  doc.save(`gastos-${person.name.replace(/\s+/g, "_").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.pdf`);
}

function FamilyView({ data, monthKey, onAddRepayment, onDeleteRepayment, onAddFamily, onDeleteTx, onAddTx, onAddCategory }) {
  const { familyMembers, transactions, repayments, cards, categories } = data;
  const [selected, setSelected] = useState(familyMembers[0]?.id || null);
  const [showRepay, setShowRepay] = useState(false);
  const [showNewTx, setShowNewTx] = useState(false);
  const [showAddPerson, setShowAddPerson] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");

  const balances = useMemo(() => familyMembers.map(p => {
    const gastos = transactions.filter(tx => tx.isFamily && tx.familyPersonId === p.id);
    const totalGastos = gastos.reduce((a, tx) => a + txTotalARS(tx), 0);
    const devs = repayments.filter(r => r.personId === p.id);
    const totalDevs = devs.reduce((a, r) => a + r.amount, 0);
    return { person: p, gastos, devs, totalGastos, totalDevs, balance: totalGastos - totalDevs };
  }), [familyMembers, transactions, repayments]);

  const totalAdeudado = balances.reduce((a, b) => a + b.balance, 0);
  const current = balances.find(b => b.person.id === selected);

  return (
    <div>
      <div className="ect-topbar">
        <div className="ect-page-title">Familia</div>
        <div className="ect-badge gold" style={{ padding: "8px 14px", fontSize: 13 }}>
          Total que me deben: {fmt(totalAdeudado)}
        </div>
      </div>

      <div className="ect-grid ect-family-grid">
        {balances.map(b => (
          <div
            key={b.person.id}
            className={`ect-panel ect-person-card ${selected === b.person.id ? "active" : ""}`}
            onClick={() => setSelected(b.person.id)}
          >
            <div className="ect-person-name">{b.person.name}</div>
            <div className="ect-person-balance" style={{ color: b.balance > 0 ? "var(--red)" : "var(--green)" }}>
              {fmt(b.balance)}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 8 }}>
              {b.gastos.length} gasto(s) · {b.devs.length} devolución(es)
            </div>
          </div>
        ))}
        <div className="ect-panel ect-person-card" style={{ display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setShowAddPerson(true)}>
          <span style={{ color: "var(--text-dim)", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}><Plus size={15} /> Agregar persona</span>
        </div>
      </div>

      {current && (
        <>
          <div className="ect-topbar" style={{ marginTop: 6 }}>
            <div className="ect-section-title" style={{ margin: 0 }}>{current.person.name} — detalle</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="ect-btn secondary" onClick={() => generateFamilyPDF(current.person, current.gastos, current.devs, current.balance)}>
                <FileDown size={14} /> Descargar PDF
              </button>
              <button className="ect-btn secondary" onClick={() => setShowNewTx(true)}><Plus size={14} /> Nuevo gasto</button>
              <button className="ect-btn" onClick={() => setShowRepay(true)}><ArrowDownCircle size={14} /> Registrar devolución</button>
            </div>
          </div>

          <div className="ect-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="ect-panel">
              <div className="ect-section-title">Gastos hechos con mi tarjeta <span className="tag">{current.gastos.length}</span></div>
              {current.gastos.length === 0 ? <div className="ect-empty">Sin gastos cargados</div> : (
                <div>
                  {current.gastos.sort((a, b) => new Date(b.date) - new Date(a.date)).map(tx => {
                    const card = cards.find(c => c.id === tx.cardId);
                    return (
                      <div className="ect-ledger-row" key={tx.id}>
                        <span className="ect-dot" style={{ background: card?.color }} />
                        <span className="ect-ledger-desc">{tx.description}</span>
                        <CurrencyTag tx={tx} />
                        {tx.cuotas > 1 && <span className="ect-badge gold">{tx.cuotas} cuotas</span>}
                        <span className="ect-ledger-meta">{fmtDate(tx.date)}</span>
                        <span className="ect-ledger-dots" />
                        <span className="ect-ledger-amt">{fmt(txTotalARS(tx))}</span>
                        <button className="ect-icon-btn del" onClick={() => onDeleteTx(tx.id)}><Trash2 size={12} /></button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="ect-panel">
              <div className="ect-section-title">Devoluciones recibidas <span className="tag">{current.devs.length}</span></div>
              {current.devs.length === 0 ? <div className="ect-empty">Todavía no registraste devoluciones</div> : (
                <div>
                  {current.devs.sort((a, b) => new Date(b.date) - new Date(a.date)).map(r => (
                    <div className="ect-ledger-row" key={r.id}>
                      <ArrowUpCircle size={14} color="var(--green)" />
                      <span className="ect-ledger-desc">{r.note || "Devolución"}</span>
                      <span className="ect-ledger-meta">{fmtDate(r.date)}</span>
                      <span className="ect-ledger-dots" />
                      <span className="ect-ledger-amt" style={{ color: "var(--green)" }}>{fmt(r.amount)}</span>
                      <button className="ect-icon-btn del" onClick={() => onDeleteRepayment(r.id)}><Trash2 size={12} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {showRepay && current && (
        <RepaymentForm person={current.person} onClose={() => setShowRepay(false)} onSave={(r) => { onAddRepayment(r); setShowRepay(false); }} />
      )}

      {showNewTx && current && (
        <TransactionForm
          initial={{ isFamily: true, familyPersonId: current.person.id }}
          cards={cards}
          categories={categories}
          familyMembers={familyMembers}
          allTransactions={transactions}
          defaultMonthKey={monthKey}
          onAddCategory={onAddCategory}
          onAddFamily={onAddFamily}
          onClose={() => setShowNewTx(false)}
          onSave={(tx) => { onAddTx(tx); setShowNewTx(false); }}
        />
      )}

      {showAddPerson && (
        <Modal title="Agregar persona" onClose={() => setShowAddPerson(false)} width={380}>
          <div className="ect-form-row">
            <label>Nombre</label>
            <input value={newPersonName} onChange={(e) => setNewPersonName(e.target.value)} placeholder="Ej: Tío Carlos" />
          </div>
          <div className="ect-modal-actions">
            <button className="ect-btn secondary" onClick={() => setShowAddPerson(false)}>Cancelar</button>
            <button className="ect-btn" onClick={() => {
              if (!newPersonName.trim()) return;
              const p = onAddFamily(newPersonName.trim());
              setSelected(p.id);
              setNewPersonName(""); setShowAddPerson(false);
            }}>Agregar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ============================================================
   CARDS VIEW
   ============================================================ */

const OWNER_LABEL = { propia: "Propia", novia: "De mi novia" };
const TYPE_LABEL = { credito: "Crédito", efectivo: "Efectivo/Transf.", prestamo: "Préstamo" };

function CardsView({ data, monthKey, setMonthKey, onUpdateCard, onAddCard, onDeleteCard }) {
  const { cards, transactions } = data;
  const [editingCard, setEditingCard] = useState(null);
  const [showNew, setShowNew] = useState(false);

  return (
    <div>
      <div className="ect-topbar">
        <div className="ect-page-title">Tarjetas y medios de pago</div>
        <div style={{ display: "flex", gap: 12 }}>
          <MonthNav monthKey={monthKey} setMonthKey={setMonthKey} />
          <button className="ect-btn" onClick={() => setShowNew(true)}><Plus size={14} /> Agregar</button>
        </div>
      </div>

      <div className="ect-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        {cards.map(card => {
          const txs = transactions.filter(t => t.cardId === card.id).map(tx => ({ tx, c: getContribution(tx, monthKey) })).filter(x => x.c.active);
          const total = txs.reduce((a, x) => a + x.c.monto, 0);
          return (
            <div className="ect-panel" key={card.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span className="ect-dot" style={{ background: card.color, width: 12, height: 12 }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14.5 }}>{card.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
                      {TYPE_LABEL[card.type]} · {OWNER_LABEL[card.owner]} · cierre día {card.closingDay}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="ect-icon-btn" onClick={() => setEditingCard(card)}><Pencil size={13} /></button>
                  <button className="ect-icon-btn del" onClick={() => onDeleteCard(card.id)}><Trash2 size={13} /></button>
                </div>
              </div>
              <div className="ect-kpi-value" style={{ fontSize: 20, marginBottom: 10 }}>{fmt(total)}</div>
              {txs.length === 0 ? (
                <div className="ect-empty" style={{ padding: 14 }}>Sin movimientos en {labelOfKey(monthKey)}</div>
              ) : (
                <div>
                  {txs.sort((a, b) => new Date(b.tx.date) - new Date(a.tx.date)).slice(0, 6).map(({ tx, c }) => (
                    <div className="ect-ledger-row" key={tx.id}>
                      <span className="ect-ledger-desc">{tx.description}</span>
                      <CurrencyTag tx={tx} />
                      {tx.cuotas > 1 && <span className="ect-badge gold">{c.cuotaNum}/{c.total}</span>}
                      <span className="ect-ledger-dots" />
                      <span className="ect-ledger-amt">{fmt(c.monto)}</span>
                    </div>
                  ))}
                  {txs.length > 6 && <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 6 }}>+{txs.length - 6} más — ver en Gastos</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {(editingCard || showNew) && (
        <CardForm
          initial={editingCard}
          onClose={() => { setEditingCard(null); setShowNew(false); }}
          onSave={(card) => { editingCard ? onUpdateCard(card) : onAddCard(card); setEditingCard(null); setShowNew(false); }}
        />
      )}
    </div>
  );
}

function CardForm({ initial, onSave, onClose }) {
  const [name, setName] = useState(initial?.name || "");
  const [type, setType] = useState(initial?.type || "credito");
  const [owner, setOwner] = useState(initial?.owner || "propia");
  const [closingDay, setClosingDay] = useState(initial?.closingDay || 1);
  const [color, setColor] = useState(initial?.color || "#C9A15D");

  return (
    <Modal title={initial ? "Editar medio de pago" : "Nuevo medio de pago"} onClose={onClose} width={420}>
      <div className="ect-form-row">
        <label>Nombre</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: VISA Santander" />
      </div>
      <div className="ect-form-2col">
        <div className="ect-form-row">
          <label>Tipo</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="credito">Tarjeta de crédito</option>
            <option value="efectivo">Efectivo / Transferencia</option>
            <option value="prestamo">Préstamo</option>
          </select>
        </div>
        <div className="ect-form-row">
          <label>Titular</label>
          <select value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="propia">Propia</option>
            <option value="novia">De mi novia</option>
          </select>
        </div>
      </div>
      <div className="ect-form-2col">
        <div className="ect-form-row">
          <label>Día de cierre del resumen</label>
          <input type="number" min="1" max="31" value={closingDay} onChange={(e) => setClosingDay(e.target.value)} />
        </div>
        <div className="ect-form-row">
          <label>Color</label>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ height: 38, padding: 4 }} />
        </div>
      </div>
      <div className="ect-modal-actions">
        <button className="ect-btn secondary" onClick={onClose}>Cancelar</button>
        <button
          className="ect-btn"
          disabled={!name.trim()}
          onClick={() => onSave({ id: initial?.id || uid(), name: name.trim(), type, owner, closingDay: Number(closingDay), color })}
        >
          <Check size={14} /> Guardar
        </button>
      </div>
    </Modal>
  );
}

/* ============================================================
   CATEGORIES VIEW
   ============================================================ */

function CategoriesView({ data, onAddCategory, onDeleteCategory }) {
  const { categories, transactions } = data;
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#C9A15D");

  const usage = (catId) => transactions.filter(t => t.categoryId === catId).length;

  return (
    <div>
      <div className="ect-topbar">
        <div className="ect-page-title">Categorías</div>
      </div>

      <div className="ect-panel" style={{ marginBottom: 18 }}>
        <div className="ect-section-title">Nueva categoría</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input className="ect-input" style={{ flex: 1 }} placeholder="Nombre de la categoría" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className="ect-color-swatch" />
          <button className="ect-btn" onClick={() => { if (newName.trim()) { onAddCategory(newName.trim(), newColor); setNewName(""); } }}>
            <Plus size={14} /> Agregar
          </button>
        </div>
      </div>

      <div className="ect-panel">
        <table className="ect-table">
          <thead><tr><th>Categoría</th><th>Gastos cargados</th><th></th></tr></thead>
          <tbody>
            {categories.map(cat => (
              <tr key={cat.id}>
                <td><span className="ect-dot" style={{ background: cat.color, marginRight: 8 }} />{cat.name}</td>
                <td className="ect-mono">{usage(cat.id)}</td>
                <td>
                  <div className="row-actions">
                    <button className="ect-icon-btn del" onClick={() => onDeleteCategory(cat.id)}><Trash2 size={13} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============================================================
   IMPORT PDF VIEW
   ============================================================ */

function ImportRow({ row, cards, categories, familyMembers, onChange, onRemove }) {
  const update = (patch) => onChange({ ...row, ...patch });
  return (
    <div className={`ect-import-row ${row.include ? "" : "excluded"}`}>
      <div className="ect-import-row-top">
        <input type="checkbox" checked={row.include} onChange={(e) => update({ include: e.target.checked })} />
        <span className="ect-import-row-orig" title={row.rawDescription}>Original: “{row.rawDescription}”</span>
        {row.subAccount && <span className="ect-badge">{row.subAccount}</span>}
        {row.isCharge && <span className="ect-badge gold">impuesto / cargo</span>}
        {row.isCredit && (
          <span className="ect-badge green" title="Detectamos un signo negativo en el importe original — probablemente un descuento o crédito, no un gasto. Revisá el monto antes de incluirlo.">
            <AlertTriangle size={11} style={{ verticalAlign: "-2px", marginRight: 3 }} />posible crédito/descuento
          </span>
        )}
        {row.possibleForeign && (
          <span className="ect-badge blue" title="El texto original menciona dólares — revisá si el monto ya viene convertido a pesos">
            <AlertTriangle size={11} style={{ verticalAlign: "-2px", marginRight: 3 }} />posible USD
          </span>
        )}
        {row.needsReview && (
          <span className="ect-badge green" title="Parece una cancelación anticipada de cuotas de una compra ya cargada antes, no un gasto nuevo. Revisá antes de incluirlo.">
            <AlertTriangle size={11} style={{ verticalAlign: "-2px", marginRight: 3 }} />revisar: cancelación de cuotas
          </span>
        )}
        <button className="ect-icon-btn del" style={{ marginLeft: "auto" }} onClick={onRemove}><Trash2 size={13} /></button>
      </div>
      <div className="ect-import-row-grid">
        <div>
          <label>Descripción</label>
          <input value={row.description} onChange={(e) => update({ description: e.target.value })} />
        </div>
        <div>
          <label>Tarjeta</label>
          <select value={row.cardId} onChange={(e) => update({ cardId: e.target.value })}>
            {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label>Categoría</label>
          <select value={row.categoryId} onChange={(e) => update({ categoryId: e.target.value })}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label>Fecha</label>
          <input type="date" value={row.date} onChange={(e) => update({ date: e.target.value })} />
        </div>
        <div>
          <label>Moneda / Monto</label>
          <div style={{ display: "flex", gap: 4 }}>
            <select style={{ width: 62 }} value={row.currency} onChange={(e) => update({ currency: e.target.value })}>
              <option value="ARS">ARS</option>
              <option value="USD">USD</option>
            </select>
            <input type="number" step="0.01" value={row.amount} onChange={(e) => update({ amount: e.target.value })} />
          </div>
          {row.currency === "USD" && (
            <input
              style={{ marginTop: 4 }}
              type="number" step="0.01" placeholder="Tipo de cambio ARS/USD"
              value={row.exchangeRate} onChange={(e) => update({ exchangeRate: e.target.value })}
            />
          )}
        </div>
        <div>
          <label>Cuotas</label>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input type="checkbox" checked={row.enCuotas} onChange={(e) => update({ enCuotas: e.target.checked })} />
            {row.enCuotas ? (
              <>
                <input type="number" min="1" style={{ width: 46 }} value={row.cuotaActual} onChange={(e) => update({ cuotaActual: e.target.value })} title="Cuota actual" />
                <span style={{ color: "var(--text-dim)" }}>/</span>
                <input type="number" min="2" style={{ width: 46 }} value={row.cuotasTotal} onChange={(e) => update({ cuotasTotal: e.target.value })} title="Cuotas totales" />
              </>
            ) : <span style={{ fontSize: 11.5, color: "var(--text-dim)" }}>contado</span>}
          </div>
        </div>
        <div>
          <label>Familiar</label>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input type="checkbox" checked={row.isFamily} onChange={(e) => update({ isFamily: e.target.checked })} />
            {row.isFamily ? (
              <select value={row.familyPersonId} onChange={(e) => update({ familyPersonId: e.target.value })}>
                {familyMembers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            ) : <span style={{ fontSize: 11.5, color: "var(--text-dim)" }}>mío</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function ImportView({ data, onImportTx, onLearnMapping, lookupMapping }) {
  const { cards, categories, familyMembers } = data;
  const [step, setStep] = useState("select");
  const [cardId, setCardId] = useState(cards[0]?.id || "");
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [importedCount, setImportedCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const fileInputRef = useRef(null);

  const handleFileSelected = (f) => {
    if (!f) return;
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
      setError("El archivo tiene que ser un PDF.");
      return;
    }
    setError(null);
    setFile(f);
  };

  const handleProcess = async () => {
    if (!file || !cardId) return;
    setLoading(true);
    setError(null);
    try {
      const { extractLinesFromPdf, parseStatementLines } = await import("./lib/pdfImport.js");
      const lines = await extractLinesFromPdf(file);
      const parsed = parseStatementLines(lines, monthKey);
      if (parsed.length === 0) {
        setError("No pude detectar gastos en este PDF. Puede que el formato de esta tarjeta no sea compatible, o que el PDF sea una imagen escaneada sin texto seleccionable (probá abrirlo y ver si podés seleccionar el texto con el mouse).");
        setLoading(false);
        return;
      }
      const builtRows = parsed.map((p) => {
        const mapping = lookupMapping(p.rawDescription);
        return {
          id: uid(),
          include: !p.isCredit && !p.needsReview,
          rawDescription: p.rawDescription,
          description: mapping?.description || cleanupDescription(p.rawDescription),
          date: p.date,
          cardId: guessCardForSubAccount(p.subAccount, cards, cardId),
          categoryId: mapping?.categoryId || (p.isCharge ? "cargos" : (categories[0]?.id || "otros")),
          currency: p.currency || "ARS",
          amount: p.amount,
          exchangeRate: "",
          enCuotas: !!(p.cuotaActual && p.cuotaTotal && p.cuotaTotal > 1),
          cuotasTotal: p.cuotaTotal || 1,
          cuotaActual: p.cuotaActual || 1,
          isFamily: mapping?.isFamily || false,
          familyPersonId: mapping?.familyPersonId || familyMembers[0]?.id || "",
          possibleForeign: p.possibleForeign,
          isCharge: p.isCharge,
          isCredit: p.isCredit,
          needsReview: p.needsReview,
          subAccount: p.subAccount,
        };
      });
      setRows(builtRows);
      setStep("review");
    } catch (e) {
      console.error(e);
      setError("Ocurrió un error leyendo el PDF. Verificá que sea un archivo válido y no esté dañado o protegido con contraseña.");
    } finally {
      setLoading(false);
    }
  };

  const updateRow = (updated) => setRows((rs) => rs.map((r) => (r.id === updated.id ? updated : r)));
  const removeRow = (id) => setRows((rs) => rs.filter((r) => r.id !== id));
  const toggleAll = (value) => setRows((rs) => rs.map((r) => ({ ...r, include: value })));

  const includedRows = rows.filter((r) => r.include);
  const totalIncluded = includedRows.reduce((a, r) => a + (Number(r.amount) || 0) * (r.currency === "USD" ? (Number(r.exchangeRate) || 0) : 1), 0);

  const handleConfirm = () => {
    let imported = 0;
    let skipped = 0;
    includedRows.forEach((r) => {
      const card = cards.find((c) => c.id === r.cardId);
      const N = r.enCuotas ? Math.max(1, Number(r.cuotasTotal)) : 1;
      let startMonth;
      if (r.enCuotas) {
        const cA = Math.min(Math.max(1, Number(r.cuotaActual)), N);
        startMonth = addMonthsToKey(monthKey, -(cA - 1));
      } else if (r.isCharge) {
        startMonth = monthKey;
      } else {
        startMonth = keyOf(computeStatementMonth(r.date, card ? card.closingDay : 1));
      }

      // Evita duplicar un gasto que ya se importó antes (típico en compras en
      // cuotas: el mismo consumo aparece en el resumen de cada mes, avanzando
      // de cuota). Si ya existe una transacción con la misma tarjeta, el mismo
      // mes de inicio de cuota, el mismo total de cuotas y el mismo nombre
      // original, se omite en vez de crear un duplicado.
      const isDuplicate = data.transactions.some((t) =>
        t.cardId === r.cardId &&
        t.startMonth === startMonth &&
        (t.cuotas || 1) === N &&
        normDesc(t.rawDescription || t.description) === normDesc(r.rawDescription)
      );
      if (isDuplicate) { skipped++; return; }

      const amountNum = Number(r.amount) || 0;
      const rate = r.currency === "USD" ? (Number(r.exchangeRate) || 0) : 1;
      const finalDescription = r.description.trim() || r.rawDescription;
      const tx = {
        id: uid(),
        description: finalDescription,
        rawDescription: r.rawDescription,
        amount: amountNum,
        currency: r.currency,
        exchangeRate: r.currency === "USD" ? rate : undefined,
        montoCuota: Math.round((amountNum / N) * 100) / 100,
        date: r.date,
        categoryId: r.categoryId,
        cardId: r.cardId,
        cuotas: N,
        startMonth,
        isFamily: r.isFamily,
        familyPersonId: r.isFamily ? r.familyPersonId : null,
      };
      onImportTx(tx);
      onLearnMapping(r.rawDescription, {
        description: finalDescription,
        categoryId: r.categoryId,
        isFamily: r.isFamily,
        familyPersonId: r.isFamily ? r.familyPersonId : null,
      });
      imported++;
    });
    setImportedCount(imported);
    setSkippedCount(skipped);
    setStep("done");
  };

  const resetAll = () => {
    setStep("select"); setFile(null); setRows([]); setError(null); setImportedCount(0); setSkippedCount(0);
  };

  return (
    <div>
      <div className="ect-topbar">
        <div className="ect-page-title">Importar resumen (PDF)</div>
      </div>

      {step === "select" && (
        <div className="ect-panel" style={{ maxWidth: 620 }}>
          <div className="ect-section-title">1. Elegí la tarjeta y el mes de resumen</div>
          <div className="ect-form-2col" style={{ marginBottom: 18 }}>
            <div className="ect-form-row">
              <label>Tarjeta</label>
              <select value={cardId} onChange={(e) => setCardId(e.target.value)}>
                {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="ect-form-row">
              <label>Mes de este resumen</label>
              <input type="month" value={monthKey} onChange={(e) => setMonthKey(e.target.value)} />
            </div>
          </div>

          <div className="ect-section-title">2. Subí el PDF del resumen</div>
          <div
            className="ect-dropzone"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleFileSelected(e.dataTransfer.files?.[0]); }}
          >
            <FileText size={26} style={{ marginBottom: 8 }} />
            <div>{file ? file.name : "Arrastrá el PDF acá o hacé clic para elegirlo"}</div>
            <input ref={fileInputRef} type="file" accept="application/pdf" onChange={(e) => handleFileSelected(e.target.files?.[0])} />
          </div>

          {error && (
            <div className="ect-form-hint" style={{ color: "var(--red)", marginTop: 12 }}>
              <AlertTriangle size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />{error}
            </div>
          )}

          <div className="ect-modal-actions" style={{ marginTop: 20 }}>
            <button className="ect-btn" disabled={!file || !cardId || loading} onClick={handleProcess}>
              {loading ? <><Loader2 size={14} className="ect-spin" /> Leyendo PDF...</> : <><UploadCloud size={14} /> Procesar PDF</>}
            </button>
          </div>

          <div className="ect-form-hint" style={{ marginTop: 16 }}>
            La lectura es automática pero heurística: cada banco imprime su resumen distinto,
            así que en el paso siguiente vas a poder revisar y corregir cada gasto antes de confirmarlo.
            Funciona con PDFs con texto seleccionable (la gran mayoría de los resúmenes digitales);
            no funciona con PDFs escaneados como imagen.
          </div>
        </div>
      )}

      {step === "review" && (
        <div>
          <div className="ect-filters" style={{ alignItems: "center" }}>
            <span className="ect-badge gold" style={{ padding: "8px 14px", fontSize: 13 }}>
              {rows.length} gasto(s) detectado(s) — {cards.find((c) => c.id === cardId)?.name} · {labelOfKey(monthKey)}
            </span>
            <button className="ect-btn ghost sm" onClick={() => toggleAll(true)}>Marcar todos</button>
            <button className="ect-btn ghost sm" onClick={() => toggleAll(false)}>Desmarcar todos</button>
            <button className="ect-btn ghost sm" style={{ marginLeft: "auto" }} onClick={resetAll}>Empezar de nuevo</button>
          </div>

          {rows.map((row) => (
            <ImportRow
              key={row.id}
              row={row}
              cards={cards}
              categories={categories}
              familyMembers={familyMembers}
              onChange={updateRow}
              onRemove={() => removeRow(row.id)}
            />
          ))}

          <div className="ect-import-summary-bar">
            <div>
              <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{includedRows.length} de {rows.length} seleccionados para importar</div>
              <div className="ect-kpi-value gold" style={{ fontSize: 19 }}>{fmt(totalIncluded)}</div>
            </div>
            <button className="ect-btn" disabled={includedRows.length === 0} onClick={handleConfirm}>
              <Check size={14} /> Confirmar importación ({includedRows.length})
            </button>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="ect-panel" style={{ maxWidth: 520, textAlign: "center", padding: "40px 30px" }}>
          <Check size={30} color="var(--green)" style={{ marginBottom: 10 }} />
          <div className="ect-section-title" style={{ justifyContent: "center" }}>¡Listo!</div>
          <div style={{ color: "var(--text-dim)", fontSize: 13.5, marginBottom: 20 }}>
            Se importaron {importedCount} gasto(s) al resumen de {labelOfKey(monthKey)}.
            {skippedCount > 0 && <> Se omitieron {skippedCount} porque ya estaban cargados (misma tarjeta, mismo gasto y misma cuota).</>}
            {" "}Las descripciones que hayas cambiado ya quedaron aprendidas para la próxima vez.
          </div>
          <button className="ect-btn" onClick={resetAll}><UploadCloud size={14} /> Importar otro resumen</button>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   APP ROOT
   ============================================================ */

export default function App() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [showSalaryModal, setShowSalaryModal] = useState(false);
  const saveTimer = useRef(null);
  const importInputRef = useRef(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("expense-tracker-data");
      if (raw) {
        const parsed = JSON.parse(raw);
        const migrated = {
          ...emptyData(),
          ...parsed,
          categories: ensureCargosCategory(parsed.categories || SEED_CATEGORIES),
          transactions: (parsed.transactions || []).map((tx) => migrateTransaction(tx, parsed.cards || SEED_CARDS)),
          sueldo: parsed.sueldo ?? 2000000,
          descriptionMappings: parsed.descriptionMappings || {},
        };
        setData(migrated);
      } else {
        setData(emptyData());
      }
    } catch (e) {
      setData(emptyData());
    }
  }, []);

  useEffect(() => {
    if (!data) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try { localStorage.setItem("expense-tracker-data", JSON.stringify(data)); } catch (e) { /* noop */ }
    }, 300);
  }, [data]);

  if (!data) {
    return (
      <div className="ect-root" style={{ alignItems: "center", justifyContent: "center" }}>
        <GlobalStyle />
        <div style={{ color: "var(--text-dim)", fontFamily: "'IBM Plex Mono', monospace" }}>Cargando...</div>
      </div>
    );
  }

  const addTx = (tx) => setData(d => ({ ...d, transactions: [...d.transactions, tx] }));
  const editTx = (tx) => setData(d => ({ ...d, transactions: d.transactions.map(t => t.id === tx.id ? tx : t) }));
  const deleteTx = (id) => setData(d => ({ ...d, transactions: d.transactions.filter(t => t.id !== id) }));

  const addCategory = (name, color) => {
    const cat = { id: uid(), name, color: color || "#9AA1B8" };
    setData(d => ({ ...d, categories: [...d.categories, cat] }));
    return cat;
  };
  const deleteCategory = (id) => setData(d => ({ ...d, categories: d.categories.filter(c => c.id !== id) }));

  const addFamily = (name) => {
    const p = { id: uid(), name };
    setData(d => ({ ...d, familyMembers: [...d.familyMembers, p] }));
    return p;
  };

  const addRepayment = (r) => setData(d => ({ ...d, repayments: [...d.repayments, r] }));
  const deleteRepayment = (id) => setData(d => ({ ...d, repayments: d.repayments.filter(r => r.id !== id) }));

  const updateCard = (card) => setData(d => ({ ...d, cards: d.cards.map(c => c.id === card.id ? card : c) }));
  const addCard = (card) => setData(d => ({ ...d, cards: [...d.cards, card] }));
  const deleteCard = (id) => setData(d => ({ ...d, cards: d.cards.filter(c => c.id !== id) }));

  const updateSalary = (val) => setData(d => ({ ...d, sueldo: val }));

  const lookupMapping = (rawDescription) => data.descriptionMappings[normDesc(rawDescription)] || null;
  const upsertMapping = (rawDescription, info) => {
    const key = normDesc(rawDescription);
    if (!key) return;
    setData(d => ({ ...d, descriptionMappings: { ...d.descriptionMappings, [key]: info } }));
  };

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `el-cierre-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importBackup = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (parsed && parsed.cards && parsed.transactions) {
          setData({
            ...emptyData(),
            ...parsed,
            categories: ensureCargosCategory(parsed.categories || SEED_CATEGORIES),
            transactions: (parsed.transactions || []).map((tx) => migrateTransaction(tx, parsed.cards || SEED_CARDS)),
            sueldo: parsed.sueldo ?? 2000000,
            descriptionMappings: parsed.descriptionMappings || {},
          });
          alert("Backup importado correctamente.");
        } else {
          alert("El archivo no tiene el formato esperado.");
        }
      } catch {
        alert("No se pudo leer el archivo.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const NAV = [
    { id: "dashboard", label: "Panel general", icon: LayoutDashboard },
    { id: "gastos", label: "Gastos", icon: Receipt },
    { id: "importar", label: "Importar PDF", icon: UploadCloud },
    { id: "familia", label: "Familia", icon: Users },
    { id: "tarjetas", label: "Tarjetas", icon: CreditCard },
    { id: "categorias", label: "Categorías", icon: Tag },
  ];

  return (
    <div className="ect-root">
      <GlobalStyle />
      <div className="ect-sidebar">
        <div className="ect-brand">El Cierre</div>
        <div className="ect-brand-sub">Control de gastos</div>
        {NAV.map(item => (
          <div key={item.id} className={`ect-nav-item ${tab === item.id ? "active" : ""}`} onClick={() => setTab(item.id)}>
            <item.icon /> {item.label}
          </div>
        ))}
        <div className="ect-sidebar-foot">
          <div className="ect-sueldo-row">
            <div>
              Sueldo estimado<br /><span className="ect-mono" style={{ color: "var(--text)" }}>{fmt(data.sueldo)}</span> / mes
            </div>
            <button className="ect-icon-btn" onClick={() => setShowSalaryModal(true)}><Pencil size={12} /></button>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
            <button className="ect-btn ghost sm" style={{ flex: 1 }} onClick={exportBackup}>Exportar</button>
            <button className="ect-btn ghost sm" style={{ flex: 1 }} onClick={() => importInputRef.current?.click()}>Importar</button>
            <input ref={importInputRef} type="file" accept="application/json" style={{ display: "none" }} onChange={importBackup} />
          </div>
        </div>
      </div>

      <div className="ect-main">
        {tab === "dashboard" && <Dashboard data={data} monthKey={monthKey} setMonthKey={setMonthKey} />}
        {tab === "gastos" && (
          <ExpensesView
            data={data} monthKey={monthKey} setMonthKey={setMonthKey}
            onAdd={addTx} onEdit={editTx} onDelete={deleteTx}
            onAddCategory={addCategory} onAddFamily={addFamily}
          />
        )}
        {tab === "importar" && (
          <ImportView data={data} onImportTx={addTx} onLearnMapping={upsertMapping} lookupMapping={lookupMapping} />
        )}
        {tab === "familia" && (
          <FamilyView
            data={data} monthKey={monthKey}
            onAddRepayment={addRepayment} onDeleteRepayment={deleteRepayment}
            onAddFamily={addFamily} onDeleteTx={deleteTx} onAddTx={addTx}
            onAddCategory={addCategory}
          />
        )}
        {tab === "tarjetas" && (
          <CardsView
            data={data} monthKey={monthKey} setMonthKey={setMonthKey}
            onUpdateCard={updateCard} onAddCard={addCard} onDeleteCard={deleteCard}
          />
        )}
        {tab === "categorias" && (
          <CategoriesView data={data} onAddCategory={addCategory} onDeleteCategory={deleteCategory} />
        )}
      </div>

      {showSalaryModal && (
        <EditSalaryModal
          current={data.sueldo}
          onClose={() => setShowSalaryModal(false)}
          onSave={(val) => { updateSalary(val); setShowSalaryModal(false); }}
        />
      )}
    </div>
  );
}
