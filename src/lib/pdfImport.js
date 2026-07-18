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

const TAX_KEYWORDS = /(IVA|IMPUESTO|PERCEPCI[OÓ]N|SELLADO|SEGURO|CARGO|INTER[EÉ]S|COMISI[OÓ]N|MANTENIMIENTO|ARANCEL)/i;

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

  // Importe al final de línea: acepta $ opcional, miles con punto, centavos con coma,
  // y un signo "-" opcional antes o después (créditos/descuentos).
  const AMOUNT_TAIL_RE = /(-?\$?\s?\d{1,3}(?:\.\d{3})*,\d{2}\s*-?)\s*$/;
  const DATE_HEAD_RE = /^(\d{2})[\/\-.](\d{2})(?:[\/\-.](\d{2,4}))?\s+(.*)$/;
  // Cuota al final de la descripción, con o sin prefijo "C.": "C.01/06", "01/06"
  const CUOTA_TAIL_RE = /(?:^|\s)(?:C\.?\s*)?(\d{1,2})\s*\/\s*(\d{1,2})\s*$/i;
  // Número de comprobante suelto (sin barra) pegado justo antes del importe
  const COMPROBANTE_TAIL_RE = /\s+(\d{3,8})\s*$/;

  lines.forEach((line, idx) => {
    const dateMatch = line.match(DATE_HEAD_RE);
    if (!dateMatch) return;
    const [, dd, mm, yy, rest] = dateMatch;
    const dayNum = parseInt(dd, 10);
    const monthNum = parseInt(mm, 10);
    if (dayNum < 1 || dayNum > 31 || monthNum < 1 || monthNum > 12) return;

    const amountMatch = rest.match(AMOUNT_TAIL_RE);
    if (!amountMatch) return;
    const rawAmount = parseArsAmount(amountMatch[1]);
    if (rawAmount === null || rawAmount === 0) return;

    let rest2 = rest.slice(0, amountMatch.index).trim();

    // Número de comprobante (si existe) justo antes del importe
    const comprobMatch = rest2.match(COMPROBANTE_TAIL_RE);
    if (comprobMatch) {
      rest2 = rest2.slice(0, comprobMatch.index).trim();
    }

    // Cuota al final de lo que queda (después de sacar el comprobante)
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

    const description = rest2.replace(/\$/g, "").replace(/[.\s]+$/, "").replace(/\s{2,}/g, " ").trim();
    if (!description) return;

    let year = yy ? (yy.length === 2 ? 2000 + parseInt(yy, 10) : parseInt(yy, 10)) : null;
    if (!year) year = monthNum > targetMonthNum ? targetYear - 1 : targetYear;

    const mm2 = String(monthNum).padStart(2, "0");
    const dd2 = String(dayNum).padStart(2, "0");
    const date = `${year}-${mm2}-${dd2}`;

    const possibleForeign = /U\$S|USD|D[OÓ]LAR/i.test(description);
    const isCharge = TAX_KEYWORDS.test(description);
    const isCredit = rawAmount < 0;

    usedLines.add(idx);
    results.push({
      rawDescription: description,
      date,
      amount: Math.abs(rawAmount),
      cuotaActual,
      cuotaTotal,
      possibleForeign,
      isCharge,
      isCredit,
    });
  });

  // Segunda pasada: líneas de impuestos/cargos que no tengan fecha al inicio
  lines.forEach((line, idx) => {
    if (usedLines.has(idx)) return;
    if (!TAX_KEYWORDS.test(line)) return;
    const amountMatch = line.match(AMOUNT_TAIL_RE);
    if (!amountMatch) return;
    const rawAmount = parseArsAmount(amountMatch[1]);
    if (rawAmount === null || rawAmount === 0) return;
    let description = line.slice(0, amountMatch.index).trim().replace(/\$/g, "").replace(/\s{2,}/g, " ").trim();
    if (!description) return;
    results.push({
      rawDescription: description,
      date: `${targetYear}-${String(targetMonthNum).padStart(2, "0")}-01`,
      amount: Math.abs(rawAmount),
      cuotaActual: null,
      cuotaTotal: null,
      possibleForeign: false,
      isCharge: true,
      isCredit: rawAmount < 0,
    });
  });

  return results;
}
