import { Router } from 'express';
import { Item } from '../models';
import { asyncH, paging } from '../lib/http';
import { authRequired } from '../middleware/auth';
import { buildItemFilter, buildSort } from '../lib/itemQuery';

export const dashboardRouter = Router();
dashboardRouter.use(authRequired);
dashboardRouter.use((req, _res, next) => (req.user!.role === 'ADMIN' ? next() : next(Object.assign(new Error('Admin access required'), { status: 403 }))));

/** One $group aggregation for all cards + one indexed, paginated query for the table. Nothing is computed in the browser. */
dashboardRouter.get('/', asyncH(async (req, res) => {
  const agg = await Item.aggregate([{ $match: { active: true } }, { $group: { _id: { s: '$status', p: '$priority' }, n: { $sum: 1 } } }]);
  const c = { total: 0, topPriority: 0, good: 0, low: 0, orderRequired: 0, outOfStock: 0, notSet: 0 };
  const key: Record<string, keyof typeof c> = { GOOD: 'good', LOW: 'low', ORDER_REQUIRED: 'orderRequired', OUT_OF_STOCK: 'outOfStock', NOT_SET: 'notSet' };
  for (const r of agg) { c.total += r.n; if (r._id.p === 'TOP') c.topPriority += r.n; c[key[r._id.s]] += r.n; }
  // table: default = items that need ordering; ?status / ?priority / ?supplierId filters switch the view
  const q: any = { ...req.query }; if (!q.status && !q.view) q.view = 'order';
  const { limit, page, skip } = paging(req.query, 100); const filter = await buildItemFilter(q);
  const [rows, total] = await Promise.all([Item.find(filter, 'name code priority currentStock targetStock effectiveReorderLevel suggestedOrderQty status lastPurchaseDate supplierId').sort(buildSort(req.query.sort as string, req.query.order as string)).skip(skip).limit(limit).populate('supplierId', 'name').lean(), Item.countDocuments(filter)]);
  res.json({ cards: c, rows, total, page, pages: Math.ceil(total / limit) });
}));
