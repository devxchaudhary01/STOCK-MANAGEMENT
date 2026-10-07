import { Router } from 'express';
import { OrderLine, Purchase, StockTransaction, Supplier } from '../models';
import { asyncH, rangeFilter } from '../lib/http';
import { authRequired, requireRole } from '../middleware/auth';

export const recordsRouter = Router();
recordsRouter.use(authRequired, requireRole('ADMIN'));
/** Date-wise record: how much went out, how much came in, which supplier was ordered how much. Any range (day / month / quarter / FY / custom). */
recordsRouter.get('/summary', asyncH(async (req, res) => {
  const d = rangeFilter(req.query); const r = d ? { from: d.$gte, to: d.$lt } : null;
  const sm: any = { type: 'SALE', cancelled: { $ne: true } }; const pm: any = { status: 'ACTIVE' }; const om: any = { status: { $ne: 'CANCELLED' } }; const rm: any = { type: 'REJECTION', cancelled: { $ne: true } };
  if (d) { sm.date = d; pm.date = d; om.orderDate = d; rm.date = d; }
  const sum = async (model: any, m: any, field: string) => { const g = await model.aggregate([{ $match: m }, { $group: { _id: null, t: { $sum: '$' + field } } }]); return g[0]?.t || 0; };
  const [soldQty, soldLines, recvQty, recvLines, ordQty, ordLines, rejIn, rejOut] = await Promise.all([
    sum(StockTransaction, sm, 'quantity'), StockTransaction.countDocuments(sm), sum(Purchase, pm, 'quantity'), Purchase.countDocuments(pm), sum(OrderLine, om, 'quantity'), OrderLine.countDocuments(om),
    sum(StockTransaction, { ...rm, quantity: { $gt: 0 } }, 'quantity'), sum(StockTransaction, { ...rm, quantity: { $lt: 0 } }, 'quantity')]);
  const bySup = async (model: any, m: any, qtyField: string) => {
    const g = await model.aggregate([{ $match: m }, { $group: { _id: '$supplierId', qty: { $sum: '$' + qtyField } } }]);
    const names = new Map((await Supplier.find({ _id: { $in: g.map((x: any) => x._id) } }, 'name').lean()).map(s => [String(s._id), s.name]));
    return Promise.all(g.map(async (x: any) => ({ supplierId: x._id, supplier: names.get(String(x._id)) || '(unknown)', qty: x.qty, lines: await model.countDocuments({ ...m, supplierId: x._id }) })));
  };
  const [recvBy, ordBy] = await Promise.all([bySup(Purchase, pm, 'quantity'), bySup(OrderLine, om, 'quantity')]);
  res.json({ range: r, sold: { qty: Math.abs(soldQty), lines: soldLines }, received: { qty: recvQty, lines: recvLines, bySupplier: recvBy.sort((a, b) => b.qty - a.qty) },
    ordered: { qty: ordQty, lines: ordLines, bySupplier: ordBy.sort((a, b) => b.qty - a.qty) }, rejections: { returnedIn: rejIn, sentOut: Math.abs(rejOut) } });
}));
