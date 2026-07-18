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
export function parseStatementLines(lines, targetMonthKey) {
  const [targetYear, targetMonthNum] = targetMonthKey.split("-").map(Number);
  const results = [];
  const usedLines = new Set();

  const AMOUNT_TAIL_RE = /(-?\$?\s?\d{1,3}(?:\.\d{3})*,\d{2})\s*-?\s*$/;
  const DATE_HEAD_RE = /^(\d{2})[\/\-.](\d{2})(?:[\/\-.](\d{2,4}))?\s+(.*)$/;
  const CUOTA_TAIL_RE = /(?:^|\s)(?:C\.?\s*)?(\d{1,2})\s*\/\s*(\d{1,2})\s*$/i;

  lines.forEach((line, idx) => {
    const dateMatch = line.match(DATE_HEAD_RE);
    if (!dateMatch) return;
    const [, dd, mm, yy, rest] = dateMatch;
    const dayNum = parseInt(dd, 10);
    const monthNum = parseInt(mm, 10);
    if (dayNum < 1 || dayNum > 31 || monthNum < 1 || monthNum > 12) return;

    const amountMatch = rest.match(AMOUNT_TAIL_RE);
    if (!amountMatch) return;
    const amount = parseArsAmount(amountMatch[1]);
    if (amount === null || amount === 0) return;

    let description = rest.slice(0, amountMatch.index).trim();
    let cuotaActual = null;
    let cuotaTotal = null;
    const cuotaMatch = description.match(CUOTA_TAIL_RE);
    if (cuotaMatch) {
      cuotaActual = parseInt(cuotaMatch[1], 10);
      cuotaTotal = parseInt(cuotaMatch[2], 10);
      if (cuotaTotal >= cuotaActual && cuotaTotal <= 60) {
        description = description.slice(0, cuotaMatch.index).trim();
      } else {
        cuotaActual = null; cuotaTotal = null;
      }
    }
    description = description.replace(/\s{2,}/g, " ").trim();
    if (!description) return;

    let year = yy ? (yy.length === 2 ? 2000 + parseInt(yy, 10) : parseInt(yy, 10)) : null;
    if (!year) year = monthNum > targetMonthNum ? targetYear - 1 : targetYear;

    const mm2 = String(monthNum).padStart(2, "0");
    const dd2 = String(dayNum).padStart(2, "0");
    const date = `${year}-${mm2}-${dd2}`;

    const possibleForeign = /U\$S|USD|D[OÓ]LAR/i.test(description);

    usedLines.add(idx);
    results.push({
      rawDescription: description,
      date,
      amount: Math.abs(amount),
      cuotaActual,
      cuotaTotal,
      possibleForeign,
      isCharge: false,
    });
  });

  // Segunda pasada: líneas de impuestos/cargos sin fecha al inicio
  lines.forEach((line, idx) => {
    if (usedLines.has(idx)) return;
    if (!TAX_KEYWORDS.test(line)) return;
    const amountMatch = line.match(AMOUNT_TAIL_RE);
    if (!amountMatch) return;
    const amount = parseArsAmount(amountMatch[1]);
    if (amount === null || amount === 0) return;
    let description = line.slice(0, amountMatch.index).trim().replace(/\s{2,}/g, " ");
    if (!description) return;
    results.push({
      rawDescription: description,
      date: `${targetYear}-${String(targetMonthNum).padStart(2, "0")}-01`,
      amount: Math.abs(amount),
      cuotaActual: null,
      cuotaTotal: null,
      possibleForeign: false,
      isCharge: true,
    });
  });

  return results;
}
