import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.js?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

/* ============================================================
   Extracción de texto del PDF, reconstruyendo líneas por
   posición (Y) para no perder el orden de las columnas.
   ============================================================ */
export async function extractLinesFromPdf(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const allLines = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const rows = new Map();

    content.items.forEach((item) => {
      if (!item.str || !item.str.trim()) return;
      const y = Math.round(item.transform[5]);
      const x = item.transform[4];
      // Agrupamos con tolerancia de 2 unidades por si hay pequeñas
      // diferencias de línea base entre glifos de la misma fila.
      let bucketKey = y;
      for (const key of rows.keys()) {
        if (Math.abs(key - y) <= 2) { bucketKey = key; break; }
      }
      if (!rows.has(bucketKey)) rows.set(bucketKey, []);
      rows.get(bucketKey).push({ x, str: item.str });
    });

    const sortedYs = Array.from(rows.keys()).sort((a, b) => b - a);
    sortedYs.forEach((y) => {
      const items = rows.get(y).sort((a, b) => a.x - b.x);
      const line = items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
      if (line) allLines.push(line);
    });
  }
  return allLines;
}

/* ============================================================
   Parseo heurístico de líneas de resumen de tarjeta.
   Formato típico argentino: FECHA  DESCRIPCIÓN  [CUOTA]  IMPORTE
   ============================================================ */

const TAX_KEYWORDS = /(IVA|IMPUESTO|PERCEPCI[OÓ]N|SELLADO|SEGURO|CARGO|INTER[EÉ]S|COMISI[OÓ]N|MANTENIMIENTO|ARANCEL|\bRG\.?\s*\d|%BI)/i;

/* Líneas que no son gastos reales sino movimientos administrativos
   del resumen (pagos ya realizados, saldo anterior, remanentes) */
const SKIP_KEYWORDS = /^(SU PAGO|SALDO ANTERIOR|REMANENTE\s+SDO|REMANENTE\s+SALDO|PAGO EN (PESOS|D[OÓ]LARES)|PAGO VENCIMIENTO|NOTA CREDITO PESOS)/i;

/* Cancelación anticipada de cuotas restantes (Naranja X): no es un gasto
   nuevo, es un pago que salda cuotas de una compra ya cargada antes */
const EARLY_CANCEL_RE = /CUOTA\s*\d+\s*A\s*\d+/i;

/* Códigos de país/moneda que Naranja X imprime pegados al importe en
   dólares, sin columna separada (ej: "NETFLIX.COM USA -9,99") */
const COUNTRY_CODE_TAIL_RE = /\s+(USA|SWE|GBR|IRL|LUX|NLD|DEU|FRA|ESP|ITA|CHE|CAN|MEX|BRA|URY|CHL|COL|PER|CHN|JPN|KOR|AUS|BEL|PRT|POL|CZE|AUT|DNK|FIN|NOR)\s*$/i;

/* Distintos guiones "raros" que usan los generadores de PDF de bancos
   (minus sign, en dash, etc.) se normalizan a un guion común "-" */
function normalizeDashes(line) {
  return line.replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-");
}

function parseArsAmount(str) {
  const cleaned = str.replace(/\$/g, "").replace(/\s/g, "").trim();
  const negative = /^-/.test(cleaned) || /-$/.test(cleaned);
  const numeric = cleaned.replace(/^-|-$/g, "").replace(/\./g, "").replace(",", ".");
  const val = parseFloat(numeric);
  if (isNaN(val)) return null;
  return negative ? -val : val;
}

const AMOUNT_NUM = `-?\\$?\\s?\\d{1,3}(?:\\.\\d{3})*,\\d{2}\\s*-?`;
const AMOUNT_TAIL_RE = new RegExp(`(${AMOUNT_NUM})\\s*$`);
const DOUBLE_AMOUNT_TAIL_RE = new RegExp(`(${AMOUNT_NUM})\\s+(${AMOUNT_NUM})\\s*$`);
const DATE_HEAD_RE = /^(\d{2})[\/\-.](\d{2})(?:[\/\-.](\d{2,4}))?\s+(.*)$/;
// Cuota al final: "C.01/06", "cta 04/06", o "01/06" a secas
const CUOTA_TAIL_RE = /(?:\b(?:c\.?|cta\.?)\s*)?(\d{1,2})\s*\/\s*(\d{1,2})\s*$/i;
// Número de comprobante suelto (sin barra), 3 a 8 dígitos
const COMPROBANTE_TAIL_RE = /\s+(\d{3,8})\s*$/;
const COMPROBANTE_HEAD_RE = /^(\d{3,8})\s+(.*)$/;
// Formato Naranja X: FECHA [NX Virtual|NX Master|Naranja X] CUPON DETALLE...
const NARANJA_CARD_HEAD_RE = /^(NX\s+\w+|Naranja\s*X)\s+(\d{1,8})\s+(.*)$/i;
// Naranja X marca "contado" como un número de plan suelto de 2 dígitos (ej. "01"), sin barra
const NARANJA_PLAN_TAIL_RE = /\s+(\d{2})\s*$/;
const NARANJA_ZETA_TAIL_RE = /\s+Zeta\s*$/i;

function extractAmount(rest) {
  const doubleMatch = rest.match(DOUBLE_AMOUNT_TAIL_RE);
  if (doubleMatch) {
    const pesos = parseArsAmount(doubleMatch[1]);
    const dolares = parseArsAmount(doubleMatch[2]);
    if (pesos !== null && dolares !== null) {
      let amount, currency, isForeign;
      if (Math.abs(dolares) > 0 && Math.abs(pesos) === 0) {
        amount = dolares; currency = "USD"; isForeign = true;
      } else {
        amount = pesos; currency = "ARS"; isForeign = false;
      }
      if (amount !== 0) {
        return { index: doubleMatch.index, amount, currency, isForeign };
      }
    }
  }
  const singleMatch = rest.match(AMOUNT_TAIL_RE);
  if (singleMatch) {
    const amount = parseArsAmount(singleMatch[1]);
    if (amount !== null && amount !== 0) {
      return { index: singleMatch.index, amount, currency: "ARS", isForeign: false };
    }
  }
  return null;
}

/**
 * Recibe las líneas de texto del PDF y el mes de resumen objetivo
 * (para inferir el año de las fechas dd/mm) y devuelve una lista de
 * gastos candidatos para revisar antes de importar.
 */
export function parseStatementLines(rawLines, targetMonthKey) {
  const [targetYear, targetMonthNum] = targetMonthKey.split("-").map(Number);
  const lines = rawLines.map(normalizeDashes);
  const results = [];
  const usedLines = new Set();

  lines.forEach((line, idx) => {
    const dateMatch = line.match(DATE_HEAD_RE);
    if (!dateMatch) return;
    const [, dd, mm, yy, restRaw] = dateMatch;
    const dayNum = parseInt(dd, 10);
    const monthNum = parseInt(mm, 10);
    if (dayNum < 1 || dayNum > 31 || monthNum < 1 || monthNum > 12) return;

    let rest = restRaw;
    let subAccount = null;

    // Formato Naranja X: "NX Virtual 44 WWW.SAMSUNG.COM ..."
    const naranjaMatch = rest.match(NARANJA_CARD_HEAD_RE);
    if (naranjaMatch) {
      subAccount = naranjaMatch[1].replace(/\s+/g, " ").trim();
      rest = naranjaMatch[3];
    } else {
      // Comprobante al inicio (formato CABAL: FECHA COMP.NRO DETALLE ... IMPORTE)
      const headMatch = rest.match(COMPROBANTE_HEAD_RE);
      if (headMatch) rest = headMatch[2];
    }

    const amountInfo = extractAmount(rest);
    if (!amountInfo) return;

    let rest2 = rest.slice(0, amountInfo.index).trim();
    let currency = amountInfo.currency;
    let isForeign = amountInfo.isForeign;

    // Comprobante al final (formato VISA: FECHA DETALLE [CUOTA] COMP.NRO IMPORTE)
    const comprobMatch = rest2.match(COMPROBANTE_TAIL_RE);
    if (comprobMatch) rest2 = rest2.slice(0, comprobMatch.index).trim();

    let cuotaActual = null;
    let cuotaTotal = null;
    const cuotaMatch = rest2.match(CUOTA_TAIL_RE);
    if (cuotaMatch) {
      const ca = parseInt(cuotaMatch[1], 10);
      const ct = parseInt(cuotaMatch[2], 10);
      if (ct >= ca && ct >= 1 && ct <= 60) {
        cuotaActual = ca; cuotaTotal = ct;
        rest2 = rest2.slice(0, cuotaMatch.index).trim();
      }
    }

    const earlyCancelDetected = EARLY_CANCEL_RE.test(rest2);

    if (subAccount && !earlyCancelDetected) {
      // Moneda extranjera marcada con código de país pegado al importe
      if (currency === "ARS") {
        const countryMatch = rest2.match(COUNTRY_CODE_TAIL_RE);
        if (countryMatch) {
          rest2 = rest2.slice(0, countryMatch.index).trim();
          currency = "USD";
          isForeign = true;
        }
      }
      // "Contado" en Naranja X se marca con un número de plan suelto (ej. "01"), sin cuotas
      if (!cuotaTotal) {
        const planMatch = rest2.match(NARANJA_PLAN_TAIL_RE);
        if (planMatch) rest2 = rest2.slice(0, planMatch.index).trim();
        else {
          const zetaMatch = rest2.match(NARANJA_ZETA_TAIL_RE);
          if (zetaMatch) rest2 = rest2.slice(0, zetaMatch.index).trim();
        }
      }
    }

    const description = rest2.replace(/\$/g, "").replace(/[.\s]+$/, "").replace(/\s{2,}/g, " ").trim();
    if (!description) return;
    if (SKIP_KEYWORDS.test(description)) { usedLines.add(idx); return; }

    let year = yy ? (yy.length === 2 ? 2000 + parseInt(yy, 10) : parseInt(yy, 10)) : null;
    if (!year) year = monthNum > targetMonthNum ? targetYear - 1 : targetYear;

    const mm2 = String(monthNum).padStart(2, "0");
    const dd2 = String(dayNum).padStart(2, "0");
    const date = `${year}-${mm2}-${dd2}`;

    const possibleForeign = isForeign || /U\$S|USD|D[OÓ]LAR/i.test(description);
    const isCharge = TAX_KEYWORDS.test(description);
    const isCredit = amountInfo.amount < 0;
    const needsReview = earlyCancelDetected;

    usedLines.add(idx);
    results.push({
      rawDescription: description,
      date,
      amount: Math.abs(amountInfo.amount),
      currency,
      cuotaActual,
      cuotaTotal,
      possibleForeign,
      isCharge,
      isCredit,
      needsReview,
      subAccount,
    });
  });

  // Segunda pasada: líneas de impuestos/cargos que no tengan fecha al inicio
  lines.forEach((line, idx) => {
    if (usedLines.has(idx)) return;
    if (!TAX_KEYWORDS.test(line)) return;
    const amountInfo = extractAmount(line);
    if (!amountInfo) return;
    let description = line.slice(0, amountInfo.index).trim().replace(/\$/g, "").replace(/\s{2,}/g, " ").trim();
    if (!description) return;
    if (SKIP_KEYWORDS.test(description)) return;
    results.push({
      rawDescription: description,
      date: `${targetYear}-${String(targetMonthNum).padStart(2, "0")}-01`,
      amount: Math.abs(amountInfo.amount),
      currency: amountInfo.currency,
      cuotaActual: null,
      cuotaTotal: null,
      possibleForeign: amountInfo.isForeign,
      isCharge: true,
      isCredit: amountInfo.amount < 0,
      needsReview: false,
      subAccount: null,
    });
  });

  return results;
}
