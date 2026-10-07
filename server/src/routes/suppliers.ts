import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { Supplier, Item, Purchase } from '../models';
import { asyncH, parse, paging } from '../lib/http';
import { authRequired, requireRole } from '../middleware/auth';
import { HttpError, searchFields, bulkUpdate } from '../services/stock';
import { normKey } from '../lib/matching';
import { ORDER_STATUSES } from '../lib/stockLogic';

export const suppliersRouter = Router();
suppliersRouter.use(authRequired);
suppliersRouter.use((req, _res, next) => (req.user!.role === 'ADMIN' ? next() : next(Object.assign(new Error('Admin access required'), { status: 403 }))));
const body = z.object({ name: z.string().trim().min(1).max(80), phone: z.string().trim().max(40).optional(), notes: z.string().trim().max(500).optional(), active: z.boolean().optional() });

/** List with live "items to order" count per supplier. */
suppliersRouter.get('/', asyncH(async (req, res) => {
  const f: any = req.query.all === 'true' ? {} : { active: true };
  const [suppliers, toOrder, itemCounts] = await Promise.all([
    Supplier.find(f).sort({ name: 1 }).lean(),
    Item.aggregate([{ $match: { active: true, status: { $in: ORDER_STATUSES } } }, { $group: { _id: '$supplierId', items: { $sum: 1 }, qty: { $sum: '$suggestedOrderQty' } } }]),
    Item.aggregate([{ $match: { active: true } }, { $group: { _id: '$supplierId', items: { $sum: 1 } } }])]);
  const o = new Map(toOrder.map(x => [String(x._id), x])); const c = new Map(itemCounts.map(x => [String(x._id), x.items]));
  res.json({ suppliers: suppliers.map(s => ({ ...s, itemsAssigned: c.get(String(s._id)) || 0, itemsToOrder: o.get(String(s._id))?.items || 0, qtyToOrder: o.get(String(s._id))?.qty || 0 })), unassigned: { itemsAssigned: c.get('null') || 0, itemsToOrder: o.get('null')?.items || 0, qtyToOrder: o.get('null')?.qty || 0 } });
}));
suppliersRouter.post('/', requireRole('ADMIN'), asyncH(async (req, res) => {
  const b = parse(body, req.body); if (await Supplier.exists({ nameKey: normKey(b.name) })) throw new HttpError(409, 'Supplier already exists');
  const s = await Supplier.create({ ...b, nameKey: normKey(b.name) }); res.status(201).json({ id: s.id });
}));
suppliersRouter.put('/:id', requireRole('ADMIN'), asyncH(async (req, res) => {
  const b = parse(body.partial(), req.body); const s = await Supplier.findById(req.params.id); if (!s) throw new HttpError(404, 'Supplier not found');
  if (b.name && normKey(b.name) !== s.nameKey) { if (await Supplier.exists({ nameKey: normKey(b.name), _id: { $ne: s._id } })) throw new HttpError(409, 'Supplier already exists'); s.nameKey = normKey(b.name); }
  Object.assign(s, b); await s.save();
  if (b.name) { const items = await Item.find({ supplierId: s._id }, 'name code category').lean(); if (items.length) await bulkUpdate(items.map(i => ({ updateOne: { filter: { _id: i._id }, update: { $set: { ...searchFields(i.name, i.code, i.category, s.name) } } } })), ); }
  res.json({ ok: true });
}));
/** Supplier history: totals + items purchased + recent purchases (simple, no analytics). */
suppliersRouter.get('/:id', asyncH(async (req, res) => {
  if (!Types.ObjectId.isValid(req.params.id)) throw new HttpError(400, 'Invalid id');
  const s = await Supplier.findById(req.params.id).lean(); if (!s) throw new HttpError(404, 'Supplier not found'); const sid = s._id;
  const [perItem, recent, lastP] = await Promise.all([
    Purchase.aggregate([{ $match: { supplierId: sid, status: 'ACTIVE' } }, { $group: { _id: '$itemId', qty: { $sum: '$quantity' } } }]),   // one row per distinct item
    Purchase.find({ supplierId: sid, status: 'ACTIVE' }).sort({ date: -1, _id: -1 }).limit(20).populate('itemId', 'name').lean(),
    Purchase.findOne({ supplierId: sid, status: 'ACTIVE' }).sort({ date: -1 }).select('date').lean()]);
  const byItem = [...perItem].sort((a, b) => b.qty - a.qty).slice(0, 25);
  const names = new Map((await Item.find({ _id: { $in: byItem.map(x => x._id) } }, 'name').lean()).map(i => [String(i._id), i.name]));
  const topItems = byItem.map(x => ({ ...x, name: names.get(String(x._id)) || '(deleted item)' }));
  const txCount = await Purchase.countDocuments({ supplierId: sid, status: 'ACTIVE' });
  const t = { transactions: txCount, totalQty: perItem.reduce((a, x) => a + x.qty, 0), distinct: perItem.length };
  const toOrder = await Item.countDocuments({ active: true, supplierId: sid, status: { $in: ORDER_STATUSES } });
  res.json({ supplier: s, stats: { purchaseTransactions: t?.transactions || 0, totalQuantity: t?.totalQty || 0, distinctItems: t?.distinct || 0, lastPurchase: lastP?.date || null, itemsToOrder: toOrder }, topItems, recent });
}));
