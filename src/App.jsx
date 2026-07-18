import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend
} from "recharts";
import {
  LayoutDashboard, Receipt, Users, CreditCard, Tag, Plus, X, Pencil, Trash2,
  ChevronLeft, ChevronRight, Wallet, TrendingUp, TrendingDown, Check,
  ArrowDownCircle, ArrowUpCircle, Layers, CalendarClock
} from "lucide-react";

/* ============================================================
   HELPERS
   ============================================================ */

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const fmt = (n) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n || 0);

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
  const s = d.toLocaleDateString("es-AR", { month: "short" });
  return s.replace(".", "").charAt(0).toUpperCase() + s.replace(".", "").slice(1) + " " + String(y).slice(2);
}
function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getContribution(tx, card, targetKey) {
  if (!card) return { active: false };
  const first = keyOf(computeStatementMonth(tx.date, card.closingDay));
  const idx = monthsBetweenKeys(first, targetKey);
  const N = tx.cuotas || 1;
  if (idx >= 0 && idx < N) {
    return { active: true, cuotaNum: idx + 1, total: N, monto: tx.montoCuota, firstKey: first };
  }
  return { active: false, firstKey: first };
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

    /* Sidebar */
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

    /* Main */
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

    /* Cards / KPI */
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

    /* Ledger rows (signature element) */
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

    /* Filters */
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

    /* Modal */
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

    .ect-cardpill {
      display: flex; align-items: center; gap: 8px;
      padding: 12px 14px; border-radius: 8px;
      background: var(--surface-2); border: 1px solid var(--border);
      margin-bottom: 8px;
    }
    .ect-cardpill .name { flex: 1; font-size: 13.5px; font-weight: 500; }
    .ect-cardpill .meta { font-size: 11px; color: var(--text-dim); }

    ::-webkit-scrollbar { width: 9px; height: 9px; }
    ::-webkit-scrollbar-track { background: var(--bg); }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 10px; }
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

/* ============================================================
   TRANSACTION FORM (gasto personal o familiar)
   ============================================================ */

function TransactionForm({ initial, cards, categories, familyMembers, onSave, onClose, onAddCategory, onAddFamily }) {
  const [description, setDescription] = useState(initial?.description || "");
  const [montoTotal, setMontoTotal] = useState(initial?.montoTotal ?? "");
  const [date, setDate] = useState(initial?.date || new Date().toISOString().slice(0, 10));
  const [categoryId, setCategoryId] = useState(initial?.categoryId || categories[0]?.id || "");
  const [cardId, setCardId] = useState(initial?.cardId || cards[0]?.id || "");
  const [enCuotas, setEnCuotas] = useState((initial?.cuotas || 1) > 1);
  const [cuotas, setCuotas] = useState(initial?.cuotas || 3);
  const [esFamiliar, setEsFamiliar] = useState(!!initial?.isFamily);
  const [familyPersonId, setFamilyPersonId] = useState(initial?.familyPersonId || familyMembers[0]?.id || "");
  const [newCatName, setNewCatName] = useState("");
  const [newPersonName, setNewPersonName] = useState("");
  const [showNewCat, setShowNewCat] = useState(false);
  const [showNewPerson, setShowNewPerson] = useState(false);

  const montoCuotaPreview = enCuotas && montoTotal && cuotas ? Number(montoTotal) / Number(cuotas) : Number(montoTotal) || 0;

  const canSave = description.trim() && Number(montoTotal) > 0 && date && categoryId && cardId && (!esFamiliar || familyPersonId);

  const handleSave = () => {
    const N = enCuotas ? Math.max(1, Number(cuotas)) : 1;
    const tx = {
      id: initial?.id || uid(),
      description: description.trim(),
      montoTotal: Number(montoTotal),
      montoCuota: Math.round((Number(montoTotal) / N) * 100) / 100,
      date,
      categoryId,
      cardId,
      cuotas: N,
      isFamily: esFamiliar,
      familyPersonId: esFamiliar ? familyPersonId : null,
    };
    onSave(tx);
  };

  return (
    <Modal title={initial ? "Editar gasto" : "Nuevo gasto"} onClose={onClose}>
      <div className="ect-form-row">
        <label>Descripción</label>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ej: Supermercado, Netflix, Zapatillas..." />
      </div>
      <div className="ect-form-2col">
        <div className="ect-form-row">
          <label>Monto total</label>
          <input type="number" value={montoTotal} onChange={(e) => setMontoTotal(e.target.value)} placeholder="0" />
        </div>
        <div className="ect-form-row">
          <label>Fecha</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
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
        <div className="ect-form-2col">
          <div className="ect-form-row">
            <label>Cantidad de cuotas</label>
            <input type="number" min="2" value={cuotas} onChange={(e) => setCuotas(e.target.value)} />
          </div>
          <div className="ect-form-row">
            <label>Monto por cuota (aprox.)</label>
            <input className="ect-mono" disabled value={fmt(montoCuotaPreview)} />
          </div>
        </div>
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
        <button className="ect-btn" disabled={!canSave} style={!canSave ? { opacity: 0.5, cursor: "not-allowed" } : undefined} onClick={handleSave}>
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
          <label>Monto</label>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
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
          style={!(Number(amount) > 0) ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
          onClick={() => onSave({ id: uid(), personId: person.id, amount: Number(amount), date, note })}
        >
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
      const c = getContribution(tx, card, monthKey);
      if (c.active) total += c.monto;
    });
    return { card, total };
  }), [cards, transactions, monthKey]);

  const totalGeneral = cardTotals.reduce((a, c) => a + c.total, 0);

  const totalFamiliar = useMemo(() => {
    let t = 0;
    transactions.filter(tx => tx.isFamily).forEach(tx => {
      const card = cards.find(c => c.id === tx.cardId);
      const c = getContribution(tx, card, monthKey);
      if (c.active) t += c.monto;
    });
    return t;
  }, [transactions, cards, monthKey]);

  const totalPersonal = totalGeneral - totalFamiliar;

  const prevMonthKey = addMonthsToKey(monthKey, -1);
  const prevPersonal = useMemo(() => {
    let t = 0;
    transactions.filter(tx => !tx.isFamily).forEach(tx => {
      const card = cards.find(c => c.id === tx.cardId);
      const c = getContribution(tx, card, prevMonthKey);
      if (c.active) t += c.monto;
    });
    return t;
  }, [transactions, cards, prevMonthKey]);

  const delta = prevPersonal > 0 ? ((totalPersonal - prevPersonal) / prevPersonal) * 100 : null;

  const categoryTotals = useMemo(() => {
    const map = {};
    transactions.filter(tx => !tx.isFamily).forEach(tx => {
      const card = cards.find(c => c.id === tx.cardId);
      const c = getContribution(tx, card, monthKey);
      if (c.active) map[tx.categoryId] = (map[tx.categoryId] || 0) + c.monto;
    });
    return categories.map(cat => ({ name: cat.name, value: map[cat.id] || 0, color: cat.color })).filter(x => x.value > 0);
  }, [transactions, cards, categories, monthKey]);

  const trend = useMemo(() => {
    const out = [];
    for (let i = 5; i >= 0; i--) {
      const k = addMonthsToKey(monthKey, -i);
      let personal = 0, familiar = 0;
      transactions.forEach(tx => {
        const card = cards.find(c => c.id === tx.cardId);
        const c = getContribution(tx, card, k);
        if (c.active) { if (tx.isFamily) familiar += c.monto; else personal += c.monto; }
      });
      out.push({ month: shortLabelOfKey(k), Personal: Math.round(personal), Familiar: Math.round(familiar) });
    }
    return out;
  }, [transactions, cards, monthKey]);

  const futureCommitted = useMemo(() => {
    const out = [];
    for (let i = 1; i <= 6; i++) {
      const k = addMonthsToKey(monthKey, i);
      let total = 0;
      transactions.filter(tx => (tx.cuotas || 1) > 1).forEach(tx => {
        const card = cards.find(c => c.id === tx.cardId);
        const c = getContribution(tx, card, k);
        if (c.active) total += c.monto;
      });
      out.push({ month: shortLabelOfKey(k), total: Math.round(total) });
    }
    return out;
  }, [transactions, cards, monthKey]);

  const activeInstallments = useMemo(() => {
    return transactions.filter(tx => (tx.cuotas || 1) > 1).map(tx => {
      const card = cards.find(c => c.id === tx.cardId);
      const c = getContribution(tx, card, monthKey);
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
              {delta >= 0 ? <TrendingUp /> : <TrendingDown />}
              {Math.abs(delta).toFixed(1)}% vs. mes anterior
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
              <Tooltip
                contentStyle={{ background: "#1D2438", border: "1px solid #2A3250", borderRadius: 8, fontSize: 12 }}
                formatter={(v) => fmt(v)}
              />
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
                  <td>{tx.description}{tx.isFamily && <span className="ect-badge blue" style={{ marginLeft: 8 }}>familiar</span>}</td>
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
      const c = getContribution(tx, card, monthKey);
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
                  <td>{tx.description} {tx.isFamily && <span className="ect-badge blue" style={{ marginLeft: 6 }}>
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

function FamilyView({ data, onAddRepayment, onDeleteRepayment, onAddFamily, onDeleteTx, onAddTx, onAddCategory }) {
  const { familyMembers, transactions, repayments, cards, categories } = data;
  const [selected, setSelected] = useState(familyMembers[0]?.id || null);
  const [showRepay, setShowRepay] = useState(false);
  const [showNewTx, setShowNewTx] = useState(false);
  const [showAddPerson, setShowAddPerson] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");

  const balances = useMemo(() => familyMembers.map(p => {
    const gastos = transactions.filter(tx => tx.isFamily && tx.familyPersonId === p.id);
    const totalGastos = gastos.reduce((a, tx) => a + tx.montoTotal, 0);
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
                        {tx.cuotas > 1 && <span className="ect-badge gold">{tx.cuotas} cuotas</span>}
                        <span className="ect-ledger-meta">{fmtDate(tx.date)}</span>
                        <span className="ect-ledger-dots" />
                        <span className="ect-ledger-amt">{fmt(tx.montoTotal)}</span>
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
          const txs = transactions.filter(t => t.cardId === card.id).map(tx => ({ tx, c: getContribution(tx, card, monthKey) })).filter(x => x.c.active);
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
          style={!name.trim() ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
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

function CategoriesView({ data, onAddCategory, onDeleteCategory, onUpdateCategory }) {
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
   APP ROOT
   ============================================================ */

export default function App() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const saveTimer = useRef(null);
  const importInputRef = useRef(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("expense-tracker-data");
      setData(raw ? JSON.parse(raw) : emptyData());
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
          setData(parsed);
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
          Sueldo estimado<br /><span className="ect-mono" style={{ color: "var(--text)" }}>{fmt(2000000)}</span> / mes
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
        {tab === "familia" && (
          <FamilyView
            data={data}
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
    </div>
  );
}
