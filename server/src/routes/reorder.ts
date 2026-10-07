import { Router } from 'express';
import { Item } from '../models';
import { asyncH, paging } from '../lib/http';
import { authRequired } from '../middleware/auth';
import { buildItemFilter, buildSort, resolveItemFilter } from '../lib/itemQuery';
import { pendingFor } from '../services/orders';

export const reorderRouter = Router();
reorderRouter.use(authRequired);
reorderRouter.use((req, _res, next) => (req.user!.role === 'ADMIN' ? next() : next(Object.assign(new Error('Admin access required'), { status: 403 }))));
/** Items needing an order, optionally for one supplier ("Kis supplier se kya mangwana hai?"). */
reorderRouter.get('/', asyncH(async (req, res) => {
  const q: any = { ...req.query, view: 'order' }; const { limit, page, skip } = paging(req.query, 500); const filter = await resolveItemFilter(q);
  const [rows, total, tot] = await Promise.all([
    Item.find(filter, 'name code priority currentStock targetStock effectiveReorderLevel suggestedOrderQty status lastPurchaseDate supplierId category').sort(buildSort((req.query.sort as string) || 'status', req.query.order as string)).skip(skip).limit(limit).populate('supplierId', 'name').lean(),
    Item.countDocuments(filter), Item.aggregate([{ $match: filter }, { $group: { _id: null, qty: { $sum: '$suggestedOrderQty' } } }])]);
  const pend = await pendingFor(rows.map(x => x._id));
  const out = rows.map(x => { const p = pend.get(String(x._id)); const onOrder = p?.pendingQty || 0; return { ...x, onOrderQty: onOrder, expectedDate: p?.expectedDate || null, stillRequired: Math.max(0, x.suggestedOrderQty - onOrder) }; });
  res.json({ rows: out, total, page, pages: Math.ceil(total / limit), totalSuggestedQty: tot[0]?.qty || 0 });
}));
