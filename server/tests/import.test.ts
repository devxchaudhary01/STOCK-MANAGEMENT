import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { planMasterImport, planQtyUpdate, ExistingItem } from '../src/lib/importPlanner';
import { parseNumber, readWorkbook, detectHeaderRow, suggestMapping, buildExcel } from '../src/lib/excel';
import { matchOcrLines } from '../src/lib/ocr/match';
import { parseModelJson } from '../src/lib/ocr';
import * as XLSX from 'xlsx';

const sheet = (rows: any[][], bold: number[] = []) => ({ rows, firstRowNum: 1, bold: new Set(bold) });
const M = { name: 0, currentStock: 1, targetStock: 2 } as const;
const ex = (id: string, name: string, stock = 0, extra: Partial<ExistingItem> = {}): ExistingItem => ({ id, name, priority: 'NORMAL', currentStock: stock, ...extra });
const O = { headerRow: 0, blankStockAsZero: true, useBoldCategories: true };

describe('master import planner', () => {
  it('10. detects duplicate items inside the file', () => {
    const p = planMasterImport(sheet([['ITEM', 'QTY'], ['BTJNL 2525 M15', 5], ['btjnl  2525 m15 ', 7]]), M, [], new Map(), O);
    expect(p.summary.duplicatesInFile).toBe(1); expect(p.rows[0].action).toBe('CREATE'); expect(p.rows[1].action).toBe('SKIP');
  });
  it('10b. punctuation-only differences (the Ø case) are held for review, never silently merged', () => {
    const p = planMasterImport(sheet([['ITEM', 'QTY'], ['EMR-6R-50-22-4T', 1], ['EMR-6R-Ø50-22-4T', 2]]), M, [], new Map(), O);
    expect(p.summary.unresolved).toBe(1);
    const r = planMasterImport(sheet([['ITEM', 'QTY'], ['EMR-6R-50-22-4T', 1], ['EMR-6R-Ø50-22-4T', 2]]), M, [], new Map(), O, { 3: { action: 'SKIP' } });
    expect(r.summary.unresolved).toBe(0);
  });
  it('detects items that already exist and unknown/new ones', () => {
    const p = planMasterImport(sheet([['ITEM', 'QTY'], ['TNMG 160408', 5], ['NEW THING 1', 3]]), M, [ex('a', 'TNMG 160408', 1)], new Map(), O);
    expect(p.rows[0].kind).toBe('EXISTING'); expect(p.rows[1].kind).toBe('NEW'); expect(p.summary.existingItems).toBe(1); expect(p.summary.newItems).toBe(1);
  });
  it('11. unknown fuzzy-similar name is only a suggestion, user decides', () => {
    const p = planMasterImport(sheet([['ITEM', 'QTY'], ['SNR 16/10 Q11 T-35', 1]]), M, [ex('a', 'SNR 16/10 11 T-35')], new Map(), O);
    expect(p.rows[0].action).toBe('CREATE'); expect(p.rows[0].suggestions[0]?.id).toBe('a');
    const linked = planMasterImport(sheet([['ITEM', 'QTY'], ['SNR 16/10 Q11 T-35', 1]]), M, [ex('a', 'SNR 16/10 11 T-35')], new Map(), O, { 2: { action: 'LINK', itemId: 'a' } });
    expect(linked.rows[0].action).toBe('UPDATE'); expect(linked.rows[0].matchItemId).toBe('a');
  });
  it('12. invalid quantities are rejected, blanks become 0 only when allowed', () => {
    const p = planMasterImport(sheet([['ITEM', 'QTY'], ['A', 'abc'], ['B', null], ['C', '1,200']]), M, [], new Map(), O);
    expect(p.summary.invalidQuantities).toBe(1); expect(p.rows[0].kind).toBe('INVALID'); expect(p.rows[1].values.currentStock).toBe(0); expect(p.rows[2].values.currentStock).toBe(1200);
    expect(parseNumber('NO ORDER').ok).toBe(false);
  });
  it('flags missing criteria and missing supplier', () => {
    const p = planMasterImport(sheet([['ITEM', 'QTY', 'CRITERIA'], ['A', 1, 50], ['B', 2, null]]), M, [], new Map(), O);
    expect(p.rows[0].flags).toContain('MISSING_SUPPLIER'); expect(p.rows[0].flags).not.toContain('MISSING_CRITERIA'); expect(p.rows[1].flags).toContain('MISSING_CRITERIA');
  });
  it('bold rows without numbers are categories, not items', () => {
    const p = planMasterImport(sheet([['ITEM', 'QTY'], ['B CLAMP', null], ['ITEM 1', 4]], [2]), M, [], new Map(), O);
    expect(p.summary.categoryHeaders).toBe(1); expect(p.rows[1].values.category).toBe('B CLAMP'); expect(p.summary.newItems).toBe(1);
  });
  it('force priority marks every row TOP', () => { const p = planMasterImport(sheet([['ITEM', 'QTY'], ['A', 1]]), M, [], new Map(), { ...O, forcePriority: true }); expect(p.rows[0].values.priority).toBe(true); });
});

describe('bulk quantity update planner', () => {
  const items = [ex('1', 'BTJNL 2525 M15', 10, { code: 'C-1' }), ex('2', 'TNMG 160408', 5)];
  const m = { name: 0, currentStock: 1 } as const;
  it('buckets: matched / unmatched / duplicate / invalid', () => {
    const p = planQtyUpdate(sheet([['Item', 'Qty'], ['BTJNL 2525 M15', 20], ['TNMG 160408', 50], ['Boring Bar ABC', 10], ['TNMG 160408', 7], ['X', -3], ['Y', 'zz']]), m, items, { headerRow: 0, mode: 'SET' });
    expect(p.summary).toMatchObject({ matched: 1, unmatched: 1, duplicates: 2, invalid: 2 });
    expect(p.rows[0].delta).toBe(10); expect(p.rows[0].newStock).toBe(20); expect(p.rows[2].apply).toBe(false);
  });
  it('ADD mode adds, and matches by item code', () => {
    const p = planQtyUpdate(sheet([['Code', 'Qty'], ['C-1', 5]]), { code: 0, currentStock: 1 }, items, { headerRow: 0, mode: 'ADD' });
    expect(p.rows[0].itemId).toBe('1'); expect(p.rows[0].newStock).toBe(15);
  });
});

describe('invoice OCR matching', () => {
  const items = [{ id: '1', name: 'BTJNL 2525 M15' }, { id: '2', name: 'TNMG 160408' }];
  it('13. matched item is MATCHED', () => { const r = matchOcrLines([{ rawName: 'btjnl 2525  m15', quantity: 20 }], items); expect(r[0].status).toBe('MATCHED'); expect(r[0].itemId).toBe('1'); });
  it('14. unknown item is UNMATCHED; near miss is only SUGGESTED', () => {
    expect(matchOcrLines([{ rawName: 'Completely Different Thing', quantity: 3 }], items)[0].status).toBe('UNMATCHED');
    expect(matchOcrLines([{ rawName: 'BTJNL 2525 M16', quantity: 3 }], items)[0].status).toBe('SUGGESTED');
  });
  it('parses provider JSON safely, even inside markdown fences', () => {
    expect(parseModelJson('```json\n[{"name":"A 1","quantity":5},{"name":"B","quantity":null}]\n```')).toEqual([{ rawName: 'A 1', quantity: 5 }, { rawName: 'B', quantity: null }]);
    expect(() => parseModelJson('sorry no table')).toThrow();
  });
});

describe('Excel read / export', () => {
  it('16. export produces a real, formatted xlsx', async () => {
    const buf = await buildExcel('Order Required', 'Order Required Report', [{ header: 'Item', key: 'n', width: 30 }, { header: 'Qty', key: 'q', type: 'number' }], [{ n: 'A', q: 5 }, { n: 'B', q: 7 }]);
    const wb = XLSX.read(buf, { type: 'buffer' }); const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['Order Required'], { header: 1 });
    expect(rows[0][0]).toBe('Order Required Report'); expect(rows[2]).toEqual(['Item', 'Qty']); expect(rows[3]).toEqual(['A', 5]);
  });
  const dataDir = path.resolve(__dirname, '../../data');
  it.skipIf(!fs.existsSync(path.join(dataDir, 'STOCK_CRITERIA.xlsx')))('REAL FILES: 158 priority items, 1,942 stock rows, 27 categories, 141 matches', async () => {
    const wb1 = await readWorkbook(fs.readFileSync(path.join(dataDir, 'STOCK_CRITERIA.xlsx'))); const s3 = wb1.find(s => s.name === 'Sheet3')!;
    const h1 = detectHeaderRow(s3.rows); const m1: any = suggestMapping(s3.rows[h1]); m1.currentStock = null;
    const p1 = planMasterImport(s3, m1, [], new Map(), { headerRow: h1, forcePriority: true });
    expect(p1.summary.willCreate).toBe(158); expect(p1.summary.missingCriteria).toBe(0);
    const existing = p1.rows.map((r, i) => ex('p' + i, r.values.name, 0, { priority: 'TOP', targetStock: r.values.targetStock }));
    const s2 = (await readWorkbook(fs.readFileSync(path.join(dataDir, 'SALES_01-07_TO_30-09.xlsx'))))[0]; const m2: any = suggestMapping(s2.rows[detectHeaderRow(s2.rows)]);
    const p2 = planMasterImport(s2, m2, existing, new Map(), { headerRow: detectHeaderRow(s2.rows), blankStockAsZero: true, useBoldCategories: true });
    expect(p2.summary).toMatchObject({ totalRows: 1942, categoryHeaders: 27, existingItems: 141, unresolved: 2 });
  });
});
