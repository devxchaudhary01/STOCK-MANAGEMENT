import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';

export interface SheetData { name: string; rows: any[][]; firstRowNum: number; bold: Set<number> }

export const FIELD_SYNONYMS: Record<string, string[]> = {
  name: ['ITEM NAME', 'ITEM', 'NAME', 'DESCRIPTION', 'PRODUCT', 'PARTICULARS', 'ITEM DESCRIPTION'],
  code: ['ITEM CODE', 'CODE', 'SKU', 'PART NO', 'PART NO.', 'PART NUMBER'],
  supplier: ['SUPPLIER', 'VENDOR', 'PARTY', 'SUPPLIER NAME'],
  currentStock: ['QTY', 'QUANTITY', 'OUR STOCK', 'STOCK', 'CURRENT STOCK', 'CLOSING STOCK', 'BALANCE'],
  targetStock: ['CRITERIA', 'NK SIR CRITERIA', 'TARGET', 'TARGET STOCK', 'REQUIRED', 'REQUIRED STOCK', 'REQUIREMENT', 'TARGET/REQUIRED'],
  reorderLevel: ['REORDER LEVEL', 'REORDER', 'MIN', 'MINIMUM', 'MIN QTY', 'MIN STOCK', 'MINIMUM STOCK'],
  reorderPct: ['REORDER %', 'REORDER PERCENT', 'REORDER PERCENTAGE', '%', 'PERCENT'],
  priority: ['PRIORITY', 'TOP PRIORITY'],
  category: ['CATEGORY', 'GROUP', 'TYPE'],
};

export async function readWorkbook(buf: Buffer): Promise<SheetData[]> {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const boldBySheet = await boldRows(buf, wb.SheetNames).catch(() => new Map<string, Set<number>>());
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    if (!ws || !ws['!ref']) return { name, rows: [], firstRowNum: 1, bold: new Set<number>() };
    const range = XLSX.utils.decode_range(ws['!ref']);
    const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null, blankrows: true, raw: true });
    return { name, rows, firstRowNum: range.s.r + 1, bold: boldBySheet.get(name) || new Set<number>() };
  });
}

const attr = (tag: string, n: string) => new RegExp(`\\b${n}="([^"]*)"`).exec(tag)?.[1];

/** SheetJS CE does not expose fonts, so read bold flags straight from the XLSX XML (column A only). Used to spot category header rows. */
async function boldRows(buf: Buffer, names: string[]) {
  const out = new Map<string, Set<number>>();
  const zip = await JSZip.loadAsync(buf);
  const wbXml = await zip.file('xl/workbook.xml')?.async('string'); const rels = await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
  const styles = await zip.file('xl/styles.xml')?.async('string');
  if (!wbXml || !rels || !styles) return out;
  const fontsBlock = /<fonts\b[\s\S]*?<\/fonts>/.exec(styles)?.[0] || '';
  const boldFont = (fontsBlock.match(/<font\b[^>]*?(?:\/>|>[\s\S]*?<\/font>)/g) || []).map(f => /<b\s*\/>|<b\s+val="(1|true)"\s*\/>/.test(f));
  const xfBlock = /<cellXfs\b[\s\S]*?<\/cellXfs>/.exec(styles)?.[0] || '';
  const xfBold = (xfBlock.match(/<xf\b[^>]*>/g) || []).map(x => !!boldFont[Number(attr(x, 'fontId') ?? 0)]);
  const relTarget = new Map<string, string>();
  for (const r of rels.match(/<Relationship\b[^>]*>/g) || []) relTarget.set(attr(r, 'Id')!, attr(r, 'Target')!);
  for (const s of wbXml.match(/<sheet\b[^>]*>/g) || []) {
    const name = attr(s, 'name')!.replace(/&amp;/g, '&'); const rid = /r:id="([^"]*)"/.exec(s)?.[1]; const t = rid && relTarget.get(rid);
    if (!t || !names.includes(name)) continue;
    const path = t.startsWith('/') ? t.slice(1) : 'xl/' + t;
    const xml = await zip.file(path)?.async('string'); if (!xml) continue;
    const set = new Set<number>();
    for (const m of xml.matchAll(/<c\s+r="A(\d+)"([^>]*)>/g)) { const sIdx = Number(attr(m[2], 's') ?? 0); if (xfBold[sIdx]) set.add(Number(m[1])); }
    out.set(name, set);
  }
  return out;
}

/** Finds the header row (best match among the top 15 rows). Returns 0-based index into rows. */
export function detectHeaderRow(rows: any[][]): number {
  const all = new Set(Object.values(FIELD_SYNONYMS).flat());
  let best = 0, bestScore = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const score = (rows[i] || []).filter(c => typeof c === 'string' && all.has(c.trim().toUpperCase())).length;
    if (score > bestScore) { best = i; bestScore = score; }
  }
  return best;
}
/** Suggested mapping field -> column index. Exact-name match only, so 'OUR REQ' is never mistaken for the target. */
export function suggestMapping(header: any[]): Record<string, number | null> {
  const m: Record<string, number | null> = {};
  for (const [field, syns] of Object.entries(FIELD_SYNONYMS)) {
    const idx = header.findIndex(h => typeof h === 'string' && syns.includes(h.trim().toUpperCase()));
    m[field] = idx >= 0 ? idx : null;
  }
  return m;
}

export type NumParse = { ok: true; value: number | null } | { ok: false; raw: string };
/** blank -> ok/null; numbers and '1,200' ok; text such as 'NO ORDER' -> invalid. */
export function parseNumber(v: unknown): NumParse {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return { ok: true, value: null };
  if (typeof v === 'number') return Number.isFinite(v) ? { ok: true, value: v } : { ok: false, raw: String(v) };
  const t = String(v).replace(/,/g, '').trim();
  return /^-?\d+(\.\d+)?$/.test(t) ? { ok: true, value: Number(t) } : { ok: false, raw: String(v) };
}
export const parseBool = (v: unknown): boolean | null => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const t = String(v).trim().toUpperCase();
  if (['YES', 'Y', 'TRUE', '1', 'TOP', 'TOP PRIORITY'].includes(t)) return true;
  if (['NO', 'N', 'FALSE', '0', 'NORMAL'].includes(t)) return false;
  return null;
};

// ---------- Export (exceljs gives real formatting: header style, widths, freeze panes, filter) ----------
export interface ExportColumn { header: string; key: string; width?: number; type?: 'text' | 'number' | 'date' }
export async function buildExcel(sheetName: string, title: string, columns: ExportColumn[], rows: Record<string, any>[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook(); wb.creator = 'SSCT Stock Management'; wb.created = new Date();
  const ws = wb.addWorksheet(sheetName.slice(0, 31));
  ws.addRow([title]).font = { bold: true, size: 14, name: 'Arial' };
  ws.addRow([`Generated: ${new Date().toLocaleString('en-IN')}`]).font = { italic: true, size: 9, name: 'Arial', color: { argb: 'FF666666' } };
  const hdr = ws.addRow(columns.map(c => c.header));
  hdr.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 10 }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } }; c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; });
  columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width ?? Math.max(12, c.header.length + 4); });
  for (const r of rows) {
    const row = ws.addRow(columns.map(c => r[c.key] ?? ''));
    row.eachCell((cell, n) => { const t = columns[n - 1].type; cell.font = { name: 'Arial', size: 10 }; if (t === 'number') { cell.alignment = { horizontal: 'right' }; cell.numFmt = '#,##0.##'; } if (t === 'date') cell.numFmt = 'dd-mmm-yyyy'; });
  }
  ws.views = [{ state: 'frozen', ySplit: 3 }];
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: columns.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
