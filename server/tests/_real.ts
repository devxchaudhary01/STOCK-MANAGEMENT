import fs from 'fs';
import { readWorkbook, detectHeaderRow, suggestMapping } from '/home/claude/ssct-stock/server/src/lib/excel';
import { planMasterImport, ExistingItem } from '/home/claude/ssct-stock/server/src/lib/importPlanner';
(async () => {
  const d = '/home/claude/ssct-stock/data/';
  // 1) priority sheet
  const wb1 = await readWorkbook(fs.readFileSync(d + 'STOCK_CRITERIA.xlsx'));
  const s3 = wb1.find(s => s.name === 'Sheet3')!; const h1 = detectHeaderRow(s3.rows); const m1 = suggestMapping(s3.rows[h1]);
  console.log('Sheet3 header row idx', h1, 'mapping', m1);
  m1.currentStock = null; // stale 22-06 stock, do not import
  const p1 = planMasterImport(s3, m1 as any, [], new Map(), { headerRow: h1, forcePriority: true, blankStockAsZero: false, useBoldCategories: false });
  console.log('FILE1', p1.summary);
  const existing: ExistingItem[] = p1.rows.filter(r => r.action === 'CREATE').map((r, i) => ({ id: 'p' + i, name: r.values.name, priority: 'TOP', currentStock: 0, targetStock: r.values.targetStock }));
  // 2) second file
  const wb2 = await readWorkbook(fs.readFileSync(d + 'SALES_01-07_TO_30-09.xlsx'));
  const s = wb2[0]; const h2 = detectHeaderRow(s.rows); const m2 = suggestMapping(s.rows[h2]);
  console.log('File2 header', h2, m2, 'bold rows', s.bold.size);
  const t = Date.now();
  const p2 = planMasterImport(s, m2 as any, existing, new Map(), { headerRow: h2, blankStockAsZero: true, useBoldCategories: true });
  console.log('FILE2', p2.summary, 'ms', Date.now() - t);
  console.log('POSSIBLE_DUP rows:', p2.rows.filter(r => r.kind === 'POSSIBLE_DUP').map(r => [r.rowNum, r.values.name, r.matchType, r.sameAsRow]));
  console.log('fuzzy suggestions on new rows:', p2.rows.filter(r => r.suggestions.length && r.action === 'CREATE').length);
  console.log('priority rows matched exact:', p2.rows.filter(r => r.kind === 'EXISTING').length);
  const nm = p1.rows.filter(r => !p2.rows.some(x => x.matchItemName === r.values.name)).length; console.log('priority items with no exact match in file2:', nm);
  console.log('Distinct total after both:', existing.length + p2.summary.willCreate);
})();
