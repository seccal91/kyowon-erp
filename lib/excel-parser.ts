import * as XLSX from "xlsx";

export function cellToStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().split("T")[0];
  return String(v).trim();
}

export function cellToDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  const m = s.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
  if (/^\d{1,5}$/.test(s)) {
    const d = XLSX.SSF.parse_date_code(Number(s));
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  return null;
}

export function cellToNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

export interface ParsedSheet {
  headers: string[];
  rows: Record<string, unknown>[];
  missingRequired: string[];
}

export function parseExcelByHeader(buffer: Buffer, requiredCols: string[]): ParsedSheet {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });

  if (!raw.length) return { headers: [], rows: [], missingRequired: requiredCols };

  const headers = (raw[0] as unknown[]).map(h => String(h ?? "").trim());
  const missing = requiredCols.filter(r => !headers.includes(r));
  if (missing.length) return { headers, rows: [], missingRequired: missing };

  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i] as unknown[];
    // Skip fully empty rows
    if (r.every(v => v === null || v === undefined || v === "")) continue;
    const obj: Record<string, unknown> = {};
    headers.forEach((h, j) => { if (h) obj[h] = r[j] ?? null; });
    rows.push(obj);
  }

  return { headers, rows, missingRequired: [] };
}
