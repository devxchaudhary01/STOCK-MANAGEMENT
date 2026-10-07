import { Types } from 'mongoose';
import { Item, ImportLog, Supplier, StockTransaction } from '../models';
import { planMasterImport, planQtyUpdate, ExistingItem, ColumnMapping, MasterOptions, QtyOptions, Resolution, SheetInput } from '../lib/importPlanner';
import { getSettings } from './settings';
import { derive, searchFields, keysFor, recomputeItem, HttpError, bulkUpdate } from './stock';

const chunks = <T,>(a: T[], n = 250): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const dbg = (m: string) => { if (process.env.IMPORT_DEBUG) console.log('[import]', new Date().toISOString().slice(17, 23), m); };
export interface Actor { userId?: string; userName?: string }
type ItemLean = { _id: Types.ObjectId; name: string; code?: string | null; priority: 'TOP' | 'NORMAL'; currentStock: number; targetStock?: number | null; reorderLevel?: number | null; reorderPct?: number | null; supplierId?: Types.ObjectId | null; category?: string | null; txnCount?: number };

async function loadExisting() {
  const items = (await Item.find({}, 'name code priority currentStock targetStock reorderLevel reorderPct supplierId category txnCount').lean()) as unknown as ItemLean[];
  const existing: ExistingItem[] = items.map(i => ({ id: String(i._id), name: i.name, code: i.code, priority: i.priority, currentStock: i.currentStock, targetStock: i.targetStock, reorderLevel: i.reorderLevel, reorderPct: i.reorderPct, supplierId: i.supplierId ? String(i.supplierId) : null }));
  return { items, existing, byId: new Map(items.map(i => [String(i._id), i])) };
}
async function supplierLookup() { const s = await Supplier.find({ active: true }, 'name').lean(); return { byName: new Map(s.map(x => [x.name.toLowerCase(), String(x._id)])), nameById: new Map(s.map(x => [String(x._id), x.name])) }; }

export async function previewMaster(sheet: SheetInput, mapping: ColumnMapping, opts: MasterOptions, resolutions: Record<number, Resolution> = {}) {
  const { existing } = await loadExisting(); const { byName } = await supplierLookup();
  return planMasterImport(sheet, mapping, existing, byName, opts, resolutions);
}

export async function commitMaster(sheet: SheetInput, mapping: ColumnMapping, opts: MasterOptions, resolutions: Record<number, Resolution>, meta: { fileName?: string; storageKey?: string; sheetName?: string; logId?: string }, actor: Actor) {
  const { existing, byId } = await loadExisting(); const { byName, nameById } = await supplierLookup(); const settings = await getSettings();
  const plan = planMasterImport(sheet, mapping, existing, byName, opts, resolutions);
  if (plan.summary.unresolved > 0) throw new HttpError(409, `${plan.summary.unresolved} row(s) still need a duplicate decision. Resolve them before importing.`);
    dbg('plan done');
const log = meta.logId ? await ImportLog.findById(meta.logId) : null;
  if (log && log.status === 'APPLIED') throw new HttpError(409, 'This import was already applied');
  const logDoc = log ?? new ImportLog({ kind: 'MASTER', fileName: meta.fileName, storageKey: meta.storageKey });
  logDoc.set({ sheetName: meta.sheetName, userId: actor.userId, userName: actor.userName, options: opts, mapping }); if (!logDoc.id) await logDoc.save();
  dbg('log saved');
  const importId = logDoc._id as Types.ObjectId;
  const now = new Date(); const changes: any[] = []; const itemOps: any[] = []; const newItems: any[] = []; const txns: any[] = []; let created = 0, updated = 0, failed = 0;

  for (const row of plan.rows) {
    const v = row.values;
    if (row.action === 'CREATE') {
      const id = new Types.ObjectId(); const stock = v.currentStock ?? 0;
      const doc: any = { _id: id, name: v.name, ...keysFor(v.name), code: v.code, category: v.category, priority: v.priority ? 'TOP' : 'NORMAL', supplierId: v.supplierId || null, targetStock: v.targetStock, reorderLevel: v.reorderLevel, reorderPct: v.reorderPct,
        currentStock: stock, txnCount: stock !== 0 ? 1 : 0, ...searchFields(v.name, v.code, v.category, v.supplierId ? nameById.get(v.supplierId) : null), active: true, createdAt: now, updatedAt: now };
      Object.assign(doc, derive(doc, settings)); newItems.push(doc); changes.push({ itemId: id, created: true });
      if (stock !== 0) txns.push({ itemId: id, type: 'OPENING_STOCK', quantity: stock, balanceAfter: stock, date: now, importId, userId: actor.userId, userName: actor.userName, remarks: `Imported from ${meta.fileName || 'Excel'}`, createdAt: now, updatedAt: now });
      created++;
    } else if (row.action === 'UPDATE' && row.matchItemId) {
      const cur = byId.get(row.matchItemId); if (!cur) { failed++; continue; }
      const set: any = {}; const before: any = { priority: cur.priority, targetStock: cur.targetStock ?? null, reorderLevel: cur.reorderLevel ?? null, reorderPct: cur.reorderPct ?? null, supplierId: cur.supplierId ?? null, code: cur.code ?? null, category: cur.category ?? null };
      if (v.priority === true) set.priority = 'TOP'; else if (v.priority === false && mapping.priority != null) set.priority = 'NORMAL';
      if (v.targetStock != null) set.targetStock = v.targetStock;
      if (v.reorderLevel != null) set.reorderLevel = v.reorderLevel;
      if (v.reorderPct != null) set.reorderPct = v.reorderPct;
      if (v.supplierId) set.supplierId = v.supplierId;
      if (v.code && !cur.code) set.code = v.code;
      if (v.category && !cur.category) set.category = v.category;
      const delta = v.currentStock != null ? v.currentStock - cur.currentStock : 0; const newStock = cur.currentStock + delta;
      Object.assign(set, derive({ currentStock: newStock, targetStock: set.targetStock ?? cur.targetStock, reorderLevel: set.reorderLevel ?? cur.reorderLevel, reorderPct: set.reorderPct ?? cur.reorderPct }, settings));
      if (set.code || set.category || set.supplierId) Object.assign(set, searchFields(cur.name, set.code ?? cur.code, set.category ?? cur.category, (set.supplierId ?? cur.supplierId) ? nameById.get(String(set.supplierId ?? cur.supplierId)) : null));
      const upd: any = { $set: set }; if (delta !== 0) upd.$inc = { currentStock: delta, txnCount: 1 };
      itemOps.push({ updateOne: { filter: { _id: cur._id }, update: upd } }); changes.push({ itemId: cur._id, created: false, before });
      if (delta !== 0) txns.push({ itemId: cur._id, type: (cur.txnCount ?? 0) === 0 ? 'OPENING_STOCK' : 'ADJUSTMENT', quantity: delta, balanceAfter: newStock, date: now, importId, userId: actor.userId, userName: actor.userName, remarks: `Imported from ${meta.fileName || 'Excel'}`, createdAt: now, updatedAt: now });
      updated++;
    }
  }
  dbg('rows built');
  for (const c of chunks(newItems)) await Item.insertMany(c, { ordered: false });
  dbg('items inserted');
  dbg('items inserted');
  await bulkUpdate(itemOps);
  dbg('item ops done');
  for (const c of chunks(txns)) await StockTransaction.insertMany(c, { ordered: false });
  logDoc.set({ status: 'APPLIED', appliedAt: now, changes, counts: { total: plan.summary.totalRows, created, updated, skipped: plan.summary.willSkip, failed: failed + plan.summary.invalidRows } });
  await logDoc.save();
  return { importId, counts: logDoc.counts, summary: plan.summary };
}

// ---------------- bulk quantity update ----------------
export async function previewQty(sheet: SheetInput, mapping: ColumnMapping, opts: QtyOptions, resolutions: Record<number, Resolution> = {}) {
  const { existing } = await loadExisting(); return planQtyUpdate(sheet, mapping, existing, opts, resolutions);
}
export async function commitQty(sheet: SheetInput, mapping: ColumnMapping, opts: QtyOptions, resolutions: Record<number, Resolution>, meta: { fileName?: string; storageKey?: string; sheetName?: string; logId?: string }, actor: Actor) {
  const { existing, byId } = await loadExisting(); const settings = await getSettings();
  const plan = planQtyUpdate(sheet, mapping, existing, opts, resolutions);
  const log = meta.logId ? await ImportLog.findById(meta.logId) : null; if (log?.status === 'APPLIED') throw new HttpError(409, 'This import was already applied');
  const logDoc = log ?? new ImportLog({ kind: 'STOCK_QTY', fileName: meta.fileName, storageKey: meta.storageKey });
  logDoc.set({ sheetName: meta.sheetName, userId: actor.userId, userName: actor.userName, options: opts, mapping }); if (!logDoc.id) await logDoc.save();
  const importId = logDoc._id as Types.ObjectId; const now = new Date(); const ops: any[] = []; const txns: any[] = []; const changes: any[] = [];
  for (const r of plan.rows) {
    if (!r.apply || !r.itemId || !r.delta) continue; const cur = byId.get(r.itemId)!;
    const newStock = cur.currentStock + r.delta;
    ops.push({ updateOne: { filter: { _id: cur._id }, update: { $inc: { currentStock: r.delta, txnCount: 1 }, $set: derive({ currentStock: newStock, targetStock: cur.targetStock, reorderLevel: cur.reorderLevel, reorderPct: cur.reorderPct }, settings) } } });
    txns.push({ itemId: cur._id, type: (cur.txnCount ?? 0) === 0 ? 'OPENING_STOCK' : 'ADJUSTMENT', quantity: r.delta, balanceAfter: newStock, date: now, importId, userId: actor.userId, userName: actor.userName, remarks: `Bulk stock update (${opts.mode === 'SET' ? 'set to ' + r.qty : 'add ' + r.qty}) from ${meta.fileName || 'Excel'}`, createdAt: now, updatedAt: now });
    changes.push({ itemId: cur._id, created: false });
  }
  await bulkUpdate(ops);
  for (const c of chunks(txns)) await StockTransaction.insertMany(c, { ordered: false });
  logDoc.set({ status: 'APPLIED', appliedAt: now, changes, counts: { total: plan.summary.total, created: 0, updated: ops.length, skipped: plan.summary.unmatched + plan.summary.duplicates + plan.summary.unchanged, failed: plan.summary.invalid } });
  await logDoc.save(); return { importId, counts: logDoc.counts, summary: plan.summary };
}

/** Undo an applied import: remove created items (if untouched since), restore edited criteria, and add compensating ADJUSTMENT transactions. */
export async function rollbackImport(importId: string, actor: Actor) {
  const log = await ImportLog.findById(importId); if (!log) throw new HttpError(404, 'Import not found');
  if (log.status !== 'APPLIED') throw new HttpError(409, 'Only applied imports can be rolled back');
  const now = new Date(); let removed = 0, restored = 0, kept = 0;
  for (const ch of log.changes) {
    const mine = await StockTransaction.aggregate([{ $match: { importId: log._id, itemId: ch.itemId } }, { $group: { _id: null, sum: { $sum: '$quantity' } } }]);
    const sum = mine[0]?.sum ?? 0;
    if (ch.created) {
      const others = await StockTransaction.countDocuments({ itemId: ch.itemId, importId: { $ne: log._id } });
      if (others === 0) { await StockTransaction.deleteMany({ itemId: ch.itemId }); await Item.deleteOne({ _id: ch.itemId }); removed++; }
      else { await Item.updateOne({ _id: ch.itemId }, { $set: { active: false } }); kept++; }
    } else {
      const set = (ch.before as any) || {}; if (Object.keys(set).length) await Item.updateOne({ _id: ch.itemId }, { $set: set });
      if (sum !== 0) {
        const it = await Item.findOneAndUpdate({ _id: ch.itemId }, { $inc: { currentStock: -sum, txnCount: 1 } }, { new: true });
        if (it) await StockTransaction.create({ itemId: it._id, type: 'ADJUSTMENT', quantity: -sum, balanceAfter: it.currentStock, date: now, importId: log._id, userId: actor.userId, userName: actor.userName, remarks: `Rollback of import ${log.fileName || log.id}` });
      }
      await recomputeItem(ch.itemId as any); restored++;
    }
  }
  log.status = 'ROLLED_BACK'; log.rolledBackAt = now; await log.save();
  return { removed, restored, keptInactive: kept };
}

// ---------------- Excel -> daily entries (sale / purchase / rejection). Same recordLine() path as manual entry. ----------------
export interface EntryMeta { type: 'SALE' | 'PURCHASE' | 'REJECTION'; date: Date; supplierId?: string; party?: string; docNo?: string; docType?: 'INVOICE' | 'CHALLAN'; direction?: 'IN' | 'OUT'; remarks?: string }
export async function commitEntries(sheet: SheetInput, mapping: ColumnMapping, opts: { headerRow: number }, resolutions: Record<number, Resolution>, entry: EntryMeta, meta: { fileName?: string; storageKey?: string; sheetName?: string; logId?: string }, who: Required<Actor>) {
  const { recordLine } = await import('./entries');
  const { existing } = await loadExisting(); const plan = planQtyUpdate(sheet, mapping, existing, { headerRow: opts.headerRow, mode: 'ADD' }, resolutions);
  const log = meta.logId ? await ImportLog.findById(meta.logId) : null; if (log?.status === 'APPLIED') throw new HttpError(409, 'This file was already imported');
  const logDoc = log ?? new ImportLog({ kind: 'ENTRY', fileName: meta.fileName, storageKey: meta.storageKey });
  let ok = 0; const errors: { row: number; name: string; message: string }[] = [];
  for (const r of plan.rows) {
    if (!r.apply || !r.itemId || !r.qty) continue;
    try { await recordLine(entry.type, r.itemId, r.qty, { ...who, date: entry.date, remarks: entry.remarks, docNo: entry.docNo, party: entry.party, supplierId: entry.supplierId, docType: entry.docType, direction: entry.direction }); ok++; }
    catch (e: any) { errors.push({ row: r.rowNum, name: r.itemName || r.name, message: e.message }); }
  }
  logDoc.set({ sheetName: meta.sheetName, userId: who.userId, userName: who.userName, options: entry, mapping, status: 'APPLIED', appliedAt: new Date(), counts: { total: plan.summary.total, created: ok, updated: 0, skipped: plan.summary.unmatched + plan.summary.duplicates, failed: plan.summary.invalid + errors.length } });
  await logDoc.save(); return { importId: logDoc._id, counts: logDoc.counts, summary: plan.summary, errors };
}
