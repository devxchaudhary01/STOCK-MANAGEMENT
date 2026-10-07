/**
 * One-shot migration of the two company Excel files into the master database.
 *   npm run import:initial -- --criteria ../data/STOCK_CRITERIA.xlsx --stock ../data/SALES_01-07_TO_30-09.xlsx            (DRY RUN – prints the preview)
 *   npm run import:initial -- ... --apply                                                                                 (writes to MongoDB)
 * Step 1: Sheet3 of the criteria file  -> 158 TOP PRIORITY items + fixed target stock (the stale 22-06 stock column is NOT imported)
 * Step 2: Stock Summary file           -> remaining items + current stock (blank qty = 0), bold rows become categories
 * The same logic is available in the app under Import > Master Data (with a visual preview + duplicate resolution).
 */
import fs from 'fs';
import mongoose from 'mongoose';
import { config } from '../config';
import { readWorkbook, detectHeaderRow, suggestMapping } from '../lib/excel';
import { previewMaster, commitMaster } from '../services/importService';
import { seed } from './seed';
import { User } from '../models';

const arg = (k: string) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : undefined; };
(async () => {
  const apply = process.argv.includes('--apply'); const crit = arg('criteria'); const stock = arg('stock'); const sheetName = arg('priority-sheet') || 'Sheet3';
  if (!crit || !stock) throw new Error('Usage: --criteria <xlsx> --stock <xlsx> [--priority-sheet Sheet3] [--apply]');
  await mongoose.connect(config.mongoUri); if (apply) await seed();
  const admin = await User.findOne({ role: 'ADMIN' }).lean(); const actor = { userId: admin ? String(admin._id) : undefined, userName: admin?.name || 'import-script' };

  const steps: { label: string; file: string; sheet?: string; force: boolean; blankZero: boolean; skipStock: boolean }[] = [
    { label: 'STEP 1 priority list', file: crit, sheet: sheetName, force: true, blankZero: false, skipStock: true },
    { label: 'STEP 2 stock summary', file: stock, force: false, blankZero: true, skipStock: false }];
  for (const s of steps) {
    const sheets = await readWorkbook(fs.readFileSync(s.file)); const sheet = s.sheet ? sheets.find(x => x.name === s.sheet) : sheets[0]; if (!sheet) throw new Error(`Sheet ${s.sheet} not found in ${s.file}`);
    const headerRow = detectHeaderRow(sheet.rows); const mapping = suggestMapping(sheet.rows[headerRow]); if (s.skipStock) mapping.currentStock = null;
    const opts = { headerRow, forcePriority: s.force, blankStockAsZero: s.blankZero, useBoldCategories: true };
    const plan = await previewMaster(sheet, mapping as any, opts);
    console.log(`\n== ${s.label} (${sheet.name}) ==`); console.table(plan.summary);
    const dups = plan.rows.filter(r => r.action === 'REVIEW'); if (dups.length) console.log('Needs a duplicate decision (auto-resolved to CREATE in this script):', dups.map(r => `row ${r.rowNum} "${r.values.name}"`));
    if (apply) {
      const res: any = {}; for (const d of dups) res[d.rowNum] = { action: 'CREATE' };
      const out = await commitMaster(sheet, mapping as any, opts, res, { fileName: s.file.split('/').pop(), sheetName: sheet.name }, actor); console.log('APPLIED', out.counts);
    }
  }
  if (!apply) console.log('\nDRY RUN only. Re-run with --apply to write. (Recommended: use Import > Master Data in the app to review the 17 unmatched priority items first.)');
  await mongoose.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
