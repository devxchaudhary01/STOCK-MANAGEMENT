import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { Item, Supplier, StockTransaction, Purchase } from '../models';
import { asyncH, parse, paging } from '../lib/http';
import { authRequired, requireRole, actor } from '../middleware/auth';
import { buildItemFilter, buildSort, resolveItemFilter } from '../lib/itemQuery';
import { HttpError, bulkUpdate, derive, searchFields, keysFor, applyTransaction } from '../services/stock';
import { getSettings } from '../services/settings';

export const itemsRouter = Router();
itemsRouter.use(authRequired);
const num = z.number().finite().nonnegative().max(10_000_000);
const oid = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

itemsRouter.get('/', asyncH(async (req, res) => {
  const { limit, page, skip } = paging(req.query); const filter = await resolveItemFilter(req.query as any);
  const [items, total] = await Promise.all([
    Item.find(filter).sort(buildSort(req.query.sort as string, req.query.order as string)).skip(skip).limit(limit).populate('supplierId', 'name').lean(),
    Item.countDocuments(filter)]);
  res.json({ items, total, page, pages: Math.ceil(total / limit) });
}));
/** lightweight autocomplete for purchase entry etc. */
itemsRouter.get('/lookup', asyncH(async (req, res) => {
  const filter = await resolveItemFilter({ q: String(req.query.q || '') });
  const items = await Item.find(filter, 'name code currentStock status supplierId priority').sort({ name: 1 }).limit(15).populate('supplierId', 'name').lean(); res.json({ items });
}));
/** Is this item already in the master list? Used before adding a special item. */
itemsRouter.get('/check', asyncH(async (req, res) => {
  const name = String(req.query.name || '').trim(); if (!name) return void res.json({ exists: false, similar: [] });
  const ex = await Item.findOne({ $or: [{ nameKey: keysFor(name).nameKey }, { looseKey: keysFor(name).looseKey }] }, 'name').lean();
  const similar = ex ? [] : await Item.find(await resolveItemFilter({ q: name.split(/\s+/)[0] }), 'name').limit(5).lean();
  res.json({ exists: !!ex, item: ex ? { id: ex._id, name: ex.name } : null, similar: similar.map(s => ({ id: s._id, name: s.name })) });
}));
itemsRouter.get('/categories', asyncH(async (_q, res) => res.json({ categories: (await Item.distinct('category', { active: true })).filter(Boolean).sort() })));

itemsRouter.get('/:id', asyncH(async (req, res) => {
  const item = await Item.findById(parse(oid, req.params.id)).populate('supplierId', 'name').lean(); if (!item) throw new HttpError(404, 'Item not found');
  res.json({ item, settings: await getSettings() });
}));
itemsRouter.get('/:id/transactions', asyncH(async (req, res) => {
  const { limit, page, skip } = paging(req.query, 100); const f = { itemId: parse(oid, req.params.id) };
  const [rows, total] = await Promise.all([StockTransaction.find(f).sort({ date: -1, _id: -1 }).skip(skip).limit(limit).populate('supplierId', 'name').lean(), StockTransaction.countDocuments(f)]);
  res.json({ rows, total, page, pages: Math.ceil(total / limit) });
}));
itemsRouter.get('/:id/purchases', asyncH(async (req, res) => {
  const { limit, page, skip } = paging(req.query, 100); const f = { itemId: parse(oid, req.params.id), status: 'ACTIVE' };
  const [rows, total] = await Promise.all([Purchase.find(f).sort({ date: -1, _id: -1 }).skip(skip).limit(limit).populate('supplierId', 'name').lean(), Purchase.countDocuments(f)]);
  res.json({ rows, total, page, pages: Math.ceil(total / limit) });
}));

const criteria = {
  targetStock: num.nullable().optional(), reorderLevel: num.nullable().optional(), reorderPct: z.number().min(0).max(100).nullable().optional(),
};
const itemBody = z.object({
  name: z.string().trim().min(1).max(200), code: z.string().trim().max(80).nullable().optional(), category: z.string().trim().max(80).nullable().optional(), unit: z.string().trim().max(20).optional(),
  priority: z.enum(['TOP', 'NORMAL']).optional(), supplierId: oid.nullable().optional(), ...criteria, active: z.boolean().optional(),
});
function checkCriteria(target: number | null | undefined, level: number | null | undefined) {
  if (target != null && level != null && target > 0 && level > target) throw new HttpError(400, 'Reorder level cannot be higher than target stock');
}
async function supplierName(id?: string | null) { return id ? (await Supplier.findById(id, 'name').lean())?.name : null; }

itemsRouter.post('/', requireRole('ADMIN'), asyncH(async (req, res) => {
  const b = parse(itemBody.extend({ openingStock: z.number().finite().optional(), special: z.boolean().optional() }), req.body); checkCriteria(b.targetStock, b.reorderLevel);
  // The item list comes from Excel. A manual add is only allowed through the explicit "special item" route.
  if (b.special !== true) throw new HttpError(400, 'This item does not exist in the item list. Items are loaded from Excel; for a one-off item use "Add special item".');
  const keys = keysFor(b.name); const dup = await Item.findOne({ $or: [{ nameKey: keys.nameKey }, { looseKey: keys.looseKey }] }, 'name').lean();
  if (dup) throw new HttpError(409, `Already exists in the item list as "${dup.name}". Special item not needed.`);
  if (b.supplierId && !(await Supplier.exists({ _id: b.supplierId }))) throw new HttpError(400, 'Supplier not found');
  const s = await getSettings(); const { openingStock, ...rest } = b;
  const doc: any = { ...rest, special: true, ...keys, currentStock: 0, ...searchFields(b.name, b.code, b.category, await supplierName(b.supplierId)) };
  Object.assign(doc, derive(doc, s)); const item = await Item.create(doc);
  if (openingStock) await applyTransaction({ itemId: item._id, type: 'OPENING_STOCK', quantity: openingStock, remarks: 'Opening stock', ...actor(req) });
  res.status(201).json({ id: item.id });
}));

itemsRouter.put('/:id', requireRole('ADMIN'), asyncH(async (req, res) => {
  const id = parse(oid, req.params.id); const b = parse(itemBody.partial(), req.body);
  const it = await Item.findById(id); if (!it) throw new HttpError(404, 'Item not found');
  const next = { targetStock: b.targetStock !== undefined ? b.targetStock : it.targetStock, reorderLevel: b.reorderLevel !== undefined ? b.reorderLevel : it.reorderLevel };
  checkCriteria(next.targetStock, next.reorderLevel);
  if (b.supplierId && !(await Supplier.exists({ _id: b.supplierId }))) throw new HttpError(400, 'Supplier not found');
  const set: any = { ...b };
  if (b.name && b.name !== it.name) { Object.assign(set, keysFor(b.name)); if (await Item.exists({ nameKey: set.nameKey, _id: { $ne: id } })) throw new HttpError(409, 'Another item already has this name'); }
  Object.assign(it, set);
  it.set(derive(it, await getSettings()));
  it.set(searchFields(it.name, it.code, it.category, await supplierName(it.supplierId ? String(it.supplierId) : null)));
  await it.save(); res.json({ ok: true, item: it });
}));

/** Assign a supplier to many items at once (all items have no supplier after the first import). */
itemsRouter.post('/bulk-supplier', requireRole('ADMIN'), asyncH(async (req, res) => {
  const b = parse(z.object({ supplierId: oid, itemIds: z.array(oid).max(5000).optional(), filter: z.record(z.string(), z.any()).optional() }), req.body);
  const sup = await Supplier.findById(b.supplierId, 'name').lean(); if (!sup) throw new HttpError(400, 'Supplier not found');
  const filter = b.itemIds?.length ? { _id: { $in: b.itemIds.map(i => new Types.ObjectId(i)) } } : b.filter ? await buildItemFilter(b.filter as any) : null;
  if (!filter) throw new HttpError(400, 'Provide itemIds or a filter');
  const items = await Item.find(filter, 'name code category').lean(); if (items.length > 5000) throw new HttpError(400, 'Too many items');
  const ops = items.map(i => ({ updateOne: { filter: { _id: i._id }, update: { $set: { supplierId: new Types.ObjectId(b.supplierId), ...searchFields(i.name, i.code, i.category, sup.name) } } } }));
  await bulkUpdate(ops); res.json({ updated: ops.length });
}));
