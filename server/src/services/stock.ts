import { Types } from 'mongoose';
import { Item, StockTransaction, Supplier, TXN_TYPES } from '../models';
import { evaluateStock, StockSettings } from '../lib/stockLogic';
import { getSettings } from './settings';
import { looseKey, normKey } from '../lib/matching';

/** Batched bulkWrite for updates: small batches keep every round-trip fast and predictable on any MongoDB-compatible server. */
export async function bulkUpdate(ops: any[], size = 25) { for (let i = 0; i < ops.length; i += size) await Item.bulkWrite(ops.slice(i, i + size), { ordered: false }); }

export class HttpError extends Error { constructor(public status: number, message: string, public details?: unknown) { super(message); } }

const RANK = { OUT_OF_STOCK: 0, ORDER_REQUIRED: 1, LOW: 2, NOT_SET: 3, GOOD: 4 } as const;

/** Derived fields for an item given its current inputs. The ONLY place status is turned into DB fields. */
export function derive(i: { currentStock: number; targetStock?: number | null; reorderLevel?: number | null; reorderPct?: number | null }, s: StockSettings) {
  const e = evaluateStock(i, s);
  return { status: e.status, statusRank: RANK[e.status], ruleUsed: e.ruleUsed, effectiveReorderPct: e.effectiveReorderPct, effectiveReorderLevel: e.effectiveReorderLevel, suggestedOrderQty: e.suggestedOrderQty };
}
export const buildSearchText = (name: string, code?: string | null, category?: string | null, supplier?: string | null) =>
  [name, code, category, supplier].filter(Boolean).join(' ').toLowerCase();
/** searchText (contains-search fallback) + tokens (indexed prefix search). Always set both together. */
export function searchFields(name: string, code?: string | null, category?: string | null, supplier?: string | null) {
  const searchText = buildSearchText(name, code, category, supplier);
  return { searchText, tokens: [...new Set(searchText.split(/[^a-z0-9]+/).filter(Boolean))] };
}
export const keysFor = (name: string) => ({ nameKey: normKey(name), looseKey: looseKey(name) });

export const POSITIVE_TYPES = ['OPENING_STOCK', 'PURCHASE', 'RETURN'];
export interface TxnInput {
  itemId: string | Types.ObjectId; type: (typeof TXN_TYPES)[number]; quantity: number;   // quantity is a magnitude for typed rows; signed for ADJUSTMENT
  date?: Date; supplierId?: string | Types.ObjectId | null; reference?: string; invoiceId?: string | Types.ObjectId | null;
  purchaseId?: Types.ObjectId; importId?: Types.ObjectId; party?: string; reversalOf?: Types.ObjectId; guardNegative?: boolean; userId?: string | Types.ObjectId; userName?: string; remarks?: string;
}
/** Sign rules: PURCHASE/OPENING_STOCK/RETURN add, STOCK_OUT subtracts, ADJUSTMENT keeps the sign given. */
export const signedQty = (type: string, q: number) => (type === 'STOCK_OUT' || type === 'SALE' ? -Math.abs(q) : type === 'ADJUSTMENT' || type === 'REJECTION' ? q : Math.abs(q));

/**
 * The ONLY path that changes an item's stock. Atomically $inc's the item, writes the transaction (with balanceAfter),
 * then refreshes derived status. If the transaction insert fails the increment is rolled back.
 */
export async function applyTransaction(t: TxnInput) {
  const qty = signedQty(t.type, t.quantity);
  if (!Number.isFinite(qty) || qty === 0) throw new HttpError(400, 'Quantity must be a non-zero number');
  const settings = await getSettings();
  const inc: Record<string, number> = { currentStock: qty, txnCount: 1 };
  const filter: Record<string, unknown> = { _id: t.itemId };
  if (t.guardNegative && qty < 0) filter.currentStock = { $gte: -qty };          // atomic: stock can never go below 0 even with two people booking at once
  const item = await Item.findOneAndUpdate(filter, { $inc: inc }, { new: true });
  if (!item) { const ex = await Item.findById(t.itemId, 'name currentStock').lean(); if (!ex) throw new HttpError(404, 'Item not found'); throw new HttpError(409, `Not enough stock for ${ex.name}: only ${ex.currentStock} available`); }
  const date = t.date ?? new Date();
  let txn;
  try {
    txn = await StockTransaction.create({ itemId: item._id, supplierId: t.supplierId || undefined, type: t.type, quantity: qty, balanceAfter: item.currentStock, date,
      reference: t.reference, invoiceId: t.invoiceId || undefined, purchaseId: t.purchaseId, importId: t.importId, party: t.party, reversalOf: t.reversalOf, userId: t.userId, userName: t.userName, remarks: t.remarks });
  } catch (e) { await Item.updateOne({ _id: item._id }, { $inc: { currentStock: -qty, txnCount: -1 } }); throw e; }
  const set: Record<string, unknown> = derive(item, settings);
  if (t.type === 'PURCHASE' && (!item.lastPurchaseDate || date >= item.lastPurchaseDate)) { set.lastPurchaseDate = date; set.lastPurchaseQty = Math.abs(qty); }
  await Item.updateOne({ _id: item._id }, { $set: set });
  return { txn, item: { ...item.toObject(), ...set } };
}

export async function recomputeItem(id: string | Types.ObjectId) {
  const s = await getSettings(); const it = await Item.findById(id); if (!it) return null;
  await Item.updateOne({ _id: id }, { $set: derive(it, s) }); return it;
}
/** Re-derive every item (after the default % / boundary settings change). Batched bulkWrite. */
export async function recomputeAll(settings?: StockSettings) {
  const s = settings ?? (await getSettings()); let n = 0; let ops: any[] = [];
  const flush = async () => { if (ops.length) { await bulkUpdate(ops); n += ops.length; ops = []; } };
  for await (const it of Item.find({}, 'currentStock targetStock reorderLevel reorderPct').lean().cursor()) {
    ops.push({ updateOne: { filter: { _id: it._id }, update: { $set: derive(it as any, s) } } });
    if (ops.length >= 500) await flush();
  }
  await flush(); return n;
}
/** Safety net: rebuild currentStock from the transaction ledger and report/fix drift. */
export async function reconcile(fix = false) {
  const sums = await StockTransaction.aggregate([{ $group: { _id: '$itemId', total: { $sum: '$quantity' }, n: { $sum: 1 } } }]);
  const map = new Map(sums.map(s => [String(s._id), s]));
  const drift: { itemId: string; name: string; stored: number; ledger: number }[] = [];
  for await (const it of Item.find({}, 'name currentStock txnCount').lean().cursor()) {
    const s = map.get(String(it._id)); const ledger = s?.total ?? 0;
    if (ledger !== it.currentStock && (s || it.currentStock !== 0)) drift.push({ itemId: String(it._id), name: it.name, stored: it.currentStock, ledger });
  }
  if (fix && drift.length) {
    for (const d of drift) { const cnt = map.get(d.itemId)?.n ?? 0; await Item.updateOne({ _id: d.itemId }, { $set: { currentStock: d.ledger, txnCount: cnt } }); await recomputeItem(d.itemId); }
  }
  return { checked: map.size, drift };
}
export async function supplierNameMap() { const s = await Supplier.find({}, 'name').lean(); return new Map(s.map(x => [String(x._id), x.name])); }
