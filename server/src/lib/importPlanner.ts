/**
 * Pure (DB-free) import planning. Takes parsed sheet rows + existing items and returns a PREVIEW:
 * what would be created / updated / skipped, what is duplicated, missing or invalid.
 * Nothing here writes anything; the commit service applies a plan only after user confirmation.
 */
import { parseNumber, parseBool } from './excel';
import { buildMatcher, normKey, looseKey, Candidate } from './matching';

export interface ExistingItem {
  id: string; name: string; code?: string | null; priority: 'TOP' | 'NORMAL'; currentStock: number;
  targetStock?: number | null; reorderLevel?: number | null; reorderPct?: number | null; supplierId?: string | null;
}
export type Field = 'name' | 'code' | 'supplier' | 'currentStock' | 'targetStock' | 'reorderLevel' | 'reorderPct' | 'priority' | 'category';
export type ColumnMapping = Partial<Record<Field, number | null>>;
export type Resolution = { action: 'LINK'; itemId: string } | { action: 'CREATE' } | { action: 'SKIP' } | { action: 'USE' };
export interface SheetInput { rows: any[][]; firstRowNum: number; bold: Set<number> }

export interface MasterOptions {
  headerRow: number;                 // 0-based index into rows
  forcePriority?: boolean | null;    // true: every row in this file becomes TOP PRIORITY
  blankStockAsZero?: boolean;        // blank stock cell => 0
  useBoldCategories?: boolean;       // bold rows with no numbers are category headers, not items
  fuzzyThreshold?: number;
}
export type RowKind = 'NEW' | 'EXISTING' | 'DUP_IN_FILE' | 'POSSIBLE_DUP' | 'INVALID' | 'CATEGORY';
export interface RowValues {
  name: string; code?: string; category?: string; supplierName?: string; supplierId?: string | null;
  currentStock?: number | null; targetStock?: number | null; reorderLevel?: number | null; reorderPct?: number | null; priority?: boolean | null;
}
export interface PlanRow {
  rowNum: number; kind: RowKind; action: 'CREATE' | 'UPDATE' | 'SKIP' | 'REVIEW'; values: RowValues;
  matchType?: string; matchItemId?: string; matchItemName?: string; sameAsRow?: number;
  suggestions: Candidate[]; flags: string[]; errors: string[];
}
export interface MasterPlan {
  rows: PlanRow[];
  summary: { totalRows: number; newItems: number; existingItems: number; duplicatesInFile: number; possibleDuplicates: number; categoryHeaders: number;
    missingCriteria: number; missingSupplier: number; unknownSupplier: number; invalidQuantities: number; invalidRows: number; negativeStock: number; unresolved: number; willCreate: number; willUpdate: number; willSkip: number };
}

const cell = (r: any[], idx?: number | null) => (idx === null || idx === undefined ? undefined : r[idx]);
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());

export function planMasterImport(sheet: SheetInput, mapping: ColumnMapping, existing: ExistingItem[], supplierIdByName: Map<string, string>,
  opts: MasterOptions, resolutions: Record<number, Resolution> = {}): MasterPlan {
  const matcher = buildMatcher(existing, { fuzzyThreshold: opts.fuzzyThreshold });
  const byId = new Map(existing.map(e => [e.id, e]));
  const rows: PlanRow[] = [];
  const seenExact = new Map<string, number>(); const seenLoose = new Map<string, { row: number; key: string }>();
  let category: string | undefined;

  for (let i = opts.headerRow + 1; i < sheet.rows.length; i++) {
    const r = sheet.rows[i] || []; const rowNum = sheet.firstRowNum + i;
    if (r.every(c => c === null || c === undefined || String(c).trim() === '')) continue;
    const name = text(cell(r, mapping.name));
    const row: PlanRow = { rowNum, kind: 'NEW', action: 'CREATE', values: { name }, suggestions: [], flags: [], errors: [] };
    if (!name) { row.kind = 'INVALID'; row.action = 'SKIP'; row.errors.push('Missing item name'); rows.push(row); continue; }

    // numbers
    const num = (f: Field) => { const p = parseNumber(cell(r, mapping[f])); if (!p.ok) { row.errors.push(`Invalid ${f}: "${p.raw}"`); row.flags.push('INVALID_QTY'); return undefined; } return p.value; };
    let stock = num('currentStock'); const target = num('targetStock'); const level = num('reorderLevel'); const pct = num('reorderPct');

    // category header rows (bold, no numbers)
    if (opts.useBoldCategories && sheet.bold.has(rowNum) && stock == null && target == null && level == null && !row.errors.length) {
      category = name; row.kind = 'CATEGORY'; row.action = 'SKIP'; rows.push(row); continue;
    }
    if (mapping.currentStock != null && stock == null && opts.blankStockAsZero && !row.flags.includes('INVALID_QTY')) stock = 0;
    if (typeof target === 'number' && target < 0) row.errors.push('Target stock cannot be negative');
    if (typeof level === 'number' && level < 0) row.errors.push('Reorder level cannot be negative');
    if (typeof pct === 'number' && (pct < 0 || pct > 100)) row.errors.push('Reorder % must be 0-100');
    if (typeof level === 'number' && typeof target === 'number' && target > 0 && level > target) row.errors.push('Reorder level is above target');
    if (typeof stock === 'number' && stock < 0) row.flags.push('NEGATIVE_STOCK');

    const supplierName = text(cell(r, mapping.supplier));
    const supplierId = supplierName ? supplierIdByName.get(supplierName.toLowerCase()) ?? null : null;
    if (supplierName && !supplierId) row.flags.push('UNKNOWN_SUPPLIER');
    const prio = parseBool(cell(r, mapping.priority));
    row.values = {
      name, code: text(cell(r, mapping.code)) || undefined, category: text(cell(r, mapping.category)) || category, supplierName: supplierName || undefined, supplierId,
      currentStock: stock ?? null, targetStock: target ?? null, reorderLevel: level ?? null, reorderPct: pct ?? null,
      priority: opts.forcePriority ? true : prio,
    };
    if (row.errors.length) { row.kind = 'INVALID'; row.action = 'SKIP'; rows.push(row); continue; }

    // duplicates inside the file
    const nk = normKey(name), lk = looseKey(name);
    if (seenExact.has(nk)) { row.kind = 'DUP_IN_FILE'; row.action = 'SKIP'; row.sameAsRow = seenExact.get(nk); row.flags.push('DUPLICATE_IN_FILE'); rows.push(row); continue; }
    seenExact.set(nk, rowNum);
    const prevLoose = seenLoose.get(lk);
    if (prevLoose && prevLoose.key !== nk) { row.kind = 'POSSIBLE_DUP'; row.action = 'REVIEW'; row.sameAsRow = prevLoose.row; row.matchType = 'LOOSE_IN_FILE'; rows.push(row); continue; }
    seenLoose.set(lk, { row: rowNum, key: nk });

    // match against master
    const m = matcher.match(name, row.values.code);
    if (m.item && (m.type === 'EXACT' || m.type === 'CODE')) { row.kind = 'EXISTING'; row.action = 'UPDATE'; row.matchItemId = m.item.id; row.matchItemName = m.item.name; row.matchType = m.type; }
    else if (m.type === 'LOOSE' || m.type === 'AMBIGUOUS') { row.kind = 'POSSIBLE_DUP'; row.action = 'REVIEW'; row.matchType = m.type; row.suggestions = m.type === 'LOOSE' ? [{ id: m.item!.id, name: m.item!.name, score: 0.99 }] : m.candidates; }
    else { row.suggestions = m.candidates; }
    rows.push(row);
  }

  // user resolutions override defaults
  for (const row of rows) {
    const res = resolutions[row.rowNum]; if (!res || row.kind === 'CATEGORY' || row.kind === 'INVALID') continue;
    if (res.action === 'LINK' && byId.has(res.itemId)) { row.kind = 'EXISTING'; row.action = 'UPDATE'; row.matchItemId = res.itemId; row.matchItemName = byId.get(res.itemId)!.name; row.matchType = 'MANUAL'; }
    else if (res.action === 'CREATE') { row.kind = 'NEW'; row.action = 'CREATE'; }
    else if (res.action === 'SKIP') { row.action = 'SKIP'; }
  }

  // missing-value flags (after resolution)
  for (const row of rows) {
    if (row.action !== 'CREATE' && row.action !== 'UPDATE') continue;
    const ex = row.matchItemId ? byId.get(row.matchItemId) : undefined; const v = row.values;
    const hasCriteria = (v.targetStock ?? ex?.targetStock ?? 0) > 0 || (v.reorderLevel ?? ex?.reorderLevel) != null;
    if (!hasCriteria) row.flags.push('MISSING_CRITERIA');
    if (!(v.supplierId || ex?.supplierId)) row.flags.push('MISSING_SUPPLIER');
  }

  const count = (f: (r: PlanRow) => boolean) => rows.filter(f).length;
  return {
    rows,
    summary: {
      totalRows: count(r => r.kind !== 'CATEGORY'), newItems: count(r => r.action === 'CREATE'), existingItems: count(r => r.action === 'UPDATE'),
      duplicatesInFile: count(r => r.kind === 'DUP_IN_FILE'), possibleDuplicates: count(r => r.kind === 'POSSIBLE_DUP' || (r.suggestions.length > 0 && r.action === 'CREATE')),
      categoryHeaders: count(r => r.kind === 'CATEGORY'),
      missingCriteria: count(r => r.flags.includes('MISSING_CRITERIA')), missingSupplier: count(r => r.flags.includes('MISSING_SUPPLIER')),
      unknownSupplier: count(r => r.flags.includes('UNKNOWN_SUPPLIER')), invalidQuantities: count(r => r.flags.includes('INVALID_QTY')),
      invalidRows: count(r => r.kind === 'INVALID'), negativeStock: count(r => r.flags.includes('NEGATIVE_STOCK')),
      unresolved: count(r => r.action === 'REVIEW'), willCreate: count(r => r.action === 'CREATE'), willUpdate: count(r => r.action === 'UPDATE'), willSkip: count(r => r.action === 'SKIP'),
    },
  };
}

// ------------------------------------------------------------------------------------------------
// Bulk stock-quantity update (Item Name | Quantity   or   Item Code | Quantity)
// ------------------------------------------------------------------------------------------------
export interface QtyOptions { headerRow: number; mode: 'SET' | 'ADD'; fuzzyThreshold?: number }
export type QtyBucket = 'MATCHED' | 'UNMATCHED' | 'DUPLICATE' | 'INVALID' | 'UNCHANGED';
export interface QtyRow { rowNum: number; bucket: QtyBucket; name: string; code?: string; qty?: number; itemId?: string; itemName?: string; currentStock?: number; delta?: number; newStock?: number; matchType?: string; suggestions: Candidate[]; error?: string; apply: boolean }
export interface QtyPlan { rows: QtyRow[]; summary: Record<'total' | 'matched' | 'unmatched' | 'duplicates' | 'invalid' | 'unchanged' | 'willApply', number> }

export function planQtyUpdate(sheet: SheetInput, mapping: ColumnMapping, existing: ExistingItem[], opts: QtyOptions, resolutions: Record<number, Resolution> = {}): QtyPlan {
  const matcher = buildMatcher(existing, { fuzzyThreshold: opts.fuzzyThreshold });
  const byId = new Map(existing.map(e => [e.id, e]));
  const rows: QtyRow[] = [];
  for (let i = opts.headerRow + 1; i < sheet.rows.length; i++) {
    const r = sheet.rows[i] || []; const rowNum = sheet.firstRowNum + i;
    if (r.every(c => c === null || c === undefined || String(c).trim() === '')) continue;
    const name = text(cell(r, mapping.name)); const code = text(cell(r, mapping.code)) || undefined;
    const row: QtyRow = { rowNum, bucket: 'MATCHED', name, code, suggestions: [], apply: false };
    const p = parseNumber(cell(r, mapping.currentStock));
    if (!name && !code) { row.bucket = 'INVALID'; row.error = 'Missing item name/code'; rows.push(row); continue; }
    if (!p.ok || p.value === null) { row.bucket = 'INVALID'; row.error = p.ok ? 'Quantity is blank' : `Invalid quantity "${p.raw}"`; rows.push(row); continue; }
    if (p.value < 0) { row.bucket = 'INVALID'; row.error = 'Quantity cannot be negative'; rows.push(row); continue; }
    row.qty = p.value;
    const res = resolutions[rowNum];
    let item = res?.action === 'LINK' ? byId.get(res.itemId) : undefined; let mt = item ? 'MANUAL' : undefined;
    if (!item) { const m = matcher.match(name, code); if (m.item && m.type !== 'FUZZY') { item = m.item; mt = m.type; } else { row.suggestions = m.candidates; } }
    if (!item) { row.bucket = 'UNMATCHED'; rows.push(row); continue; }
    Object.assign(row, { itemId: item.id, itemName: item.name, currentStock: item.currentStock, matchType: mt });
    row.delta = opts.mode === 'SET' ? p.value - item.currentStock : p.value; row.newStock = item.currentStock + row.delta;
    if (row.delta === 0) row.bucket = 'UNCHANGED';
    rows.push(row);
  }
  // duplicates: same matched item appearing more than once -> held back unless user picks the row to USE
  const groups = new Map<string, QtyRow[]>();
  for (const r of rows) if (r.itemId) { const g = groups.get(r.itemId) || []; g.push(r); groups.set(r.itemId, g); }
  for (const g of groups.values()) if (g.length > 1) {
    const chosen = g.find(x => resolutions[x.rowNum]?.action === 'USE');
    for (const x of g) if (x !== chosen) { x.bucket = 'DUPLICATE'; x.error = `Item appears ${g.length} times in file (rows ${g.map(y => y.rowNum).join(', ')})`; }
  }
  for (const r of rows) { if (resolutions[r.rowNum]?.action === 'SKIP') { r.apply = false; continue; } r.apply = r.bucket === 'MATCHED'; }
  const c = (b: QtyBucket) => rows.filter(r => r.bucket === b).length;
  return { rows, summary: { total: rows.length, matched: c('MATCHED'), unmatched: c('UNMATCHED'), duplicates: c('DUPLICATE'), invalid: c('INVALID'), unchanged: c('UNCHANGED'), willApply: rows.filter(r => r.apply).length } };
}
