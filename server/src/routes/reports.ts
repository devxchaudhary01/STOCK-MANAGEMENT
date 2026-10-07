import { Router, Response } from 'express';
import { Item, OrderLine, Purchase, StockTransaction, Supplier } from '../models';
import { pendingFor } from '../services/orders';
import { asyncH, paging, rangeFilter } from '../lib/http';
import { authRequired } from '../middleware/auth';
import { buildItemFilter, buildSort, resolveItemFilter } from '../lib/itemQuery';
import { buildExcel, ExportColumn } from '../lib/excel';
import { STATUS_LABEL, StockStatus } from '../lib/stockLogic';
import { purchaseFilter } from './purchases';
import { txnFilter } from './stock';
import { config } from '../config';
import { Types } from 'mongoose';
import { HttpError } from '../services/stock';

export const reportsRouter = Router();
reportsRouter.use(authRequired);
const EXPORT_CAP = 100_000;
const fmtDate = (d?: Date | null) => (d ? new Intl.DateTimeFormat('en-GB', { timeZone: config.tz, day: '2-digit', month: 'short', year: 'numeric' }).format(d).replace(/ /g, '-') : '');
const nm = (x: any) => (x && typeof x === 'object' ? x.name : '') || '';

interface Report { title: string; columns: ExportColumn[]; run(q: any, o: { skip: number; limit: number }): Promise<{ rows: Record<string, any>[]; total: number }> }
const itemCols: ExportColumn[] = [
  { header: 'Item Name', key: 'name', width: 34 }, { header: 'Item Code', key: 'code', width: 14 }, { header: 'Category', key: 'category', width: 22 }, { header: 'Supplier', key: 'supplier', width: 14 },
  { header: 'Priority', key: 'priority', width: 12 }, { header: 'Available', key: 'currentStock', type: 'number' }, { header: 'Criteria', key: 'targetStock', type: 'number' },
  { header: 'Reorder Level', key: 'reorderLevel', type: 'number' }, { header: 'Status', key: 'status', width: 16 }, { header: 'Required', key: 'suggested', type: 'number' }, { header: 'Last Purchase', key: 'lastPurchase', width: 14 }];
const itemRow = (i: any) => ({ name: i.name, code: i.code || '', category: i.category || '', supplier: nm(i.supplierId) || '(none)', priority: i.priority === 'TOP' ? 'TOP PRIORITY' : 'NORMAL', currentStock: i.currentStock, targetStock: i.targetStock ?? '',
  reorderLevel: i.effectiveReorderLevel ?? '', status: STATUS_LABEL[i.status as StockStatus], suggested: i.suggestedOrderQty || '', lastPurchase: fmtDate(i.lastPurchaseDate) });
const itemReport = (title: string, force: (q: any) => any): Report => ({ title, columns: itemCols, async run(q, { skip, limit }) {
  const f = await resolveItemFilter({ ...q, ...force(q) }); const [items, total] = await Promise.all([Item.find(f).sort(buildSort(q.sort || 'status', q.order)).skip(skip).limit(limit).populate('supplierId', 'name').lean(), Item.countDocuments(f)]);
  return { rows: items.map(itemRow), total }; } });

const purchaseCols: ExportColumn[] = [{ header: 'Date', key: 'date', width: 14 }, { header: 'Supplier', key: 'supplier', width: 14 }, { header: 'Item', key: 'item', width: 34 }, { header: 'Quantity', key: 'quantity', type: 'number' }, { header: 'Invoice No.', key: 'invoice', width: 16 }, { header: 'User', key: 'user', width: 16 }, { header: 'Remarks', key: 'remarks', width: 30 }];
const purchaseReport = (title: string): Report => ({ title, columns: purchaseCols, async run(q, { skip, limit }) {
  const f = purchaseFilter(q); const [rows, total] = await Promise.all([Purchase.find(f).sort({ date: -1, _id: -1 }).skip(skip).limit(limit).populate('supplierId', 'name').populate('itemId', 'name').lean(), Purchase.countDocuments(f)]);
  return { rows: rows.map(p => ({ date: fmtDate(p.date), supplier: nm(p.supplierId), item: nm(p.itemId), quantity: p.quantity, invoice: p.invoiceNumber || '', user: p.userName || '', remarks: p.remarks || '' })), total }; } });

export const REPORTS: Record<string, Report> = {
  'current-stock': itemReport('Current Stock Report', () => ({})),
  'order-required': itemReport('Order Required Report', () => ({ view: 'order' })),
  'criteria-missing': itemReport('Criteria Missing Report', () => ({ status: 'NOT_SET' })),
  daily: purchaseReport('Daily Purchase Report'),
  purchases: purchaseReport('Purchase History'),
  supplier: { title: 'Supplier-wise Purchase Report', columns: [{ header: 'Supplier', key: 'supplier', width: 18 }, { header: 'Purchase Transactions', key: 'n', type: 'number', width: 20 }, { header: 'Distinct Items', key: 'items', type: 'number', width: 16 }, { header: 'Total Quantity', key: 'qty', type: 'number', width: 16 }, { header: 'Last Purchase', key: 'last', width: 14 }],
    async run(q, { skip, limit }) {
      const m: any = purchaseFilter(q); if (m.supplierId) m.supplierId = new Types.ObjectId(m.supplierId); if (m.itemId) m.itemId = new Types.ObjectId(m.itemId);
      // two-stage $group (supplier,item) -> (supplier) gives distinct item counts without $addToSet
      const g = await Purchase.aggregate([{ $match: m }, { $group: { _id: { s: '$supplierId', i: '$itemId' }, n: { $sum: 1 }, qty: { $sum: '$quantity' } } }, { $group: { _id: '$_id.s', n: { $sum: '$n' }, qty: { $sum: '$qty' }, items: { $sum: 1 } } }, { $sort: { qty: -1 } }]);
      const names = new Map((await Supplier.find({ _id: { $in: g.map(x => x._id) } }, 'name').lean()).map(x => [String(x._id), x.name]));
      const lasts = await Promise.all(g.map(r => Purchase.findOne({ ...m, supplierId: r._id }).sort({ date: -1 }).select('date').lean()));
      const rows = g.map((r, i) => ({ supplier: names.get(String(r._id)) || '(unknown)', n: r.n, items: r.items, qty: r.qty, last: fmtDate(lasts[i]?.date) })); return { rows: rows.slice(skip, skip + limit), total: rows.length }; } },
  transactions: { title: 'Stock Transaction Report', columns: [{ header: 'Date', key: 'date', width: 14 }, { header: 'Type', key: 'type', width: 16 }, { header: 'Item', key: 'item', width: 34 }, { header: 'Supplier', key: 'supplier', width: 14 }, { header: 'Quantity (+/-)', key: 'quantity', type: 'number' }, { header: 'Balance After', key: 'balance', type: 'number' }, { header: 'Reference', key: 'reference', width: 16 }, { header: 'User', key: 'user', width: 16 }, { header: 'Remarks', key: 'remarks', width: 36 }],
    async run(q, { skip, limit }) {
      const f = txnFilter(q); const [rows, total] = await Promise.all([StockTransaction.find(f).sort({ date: -1, _id: -1 }).skip(skip).limit(limit).populate('itemId', 'name').populate('supplierId', 'name').lean(), StockTransaction.countDocuments(f)]);
      return { rows: rows.map(t => ({ date: fmtDate(t.date), type: t.type, item: nm(t.itemId), supplier: nm(t.supplierId), quantity: t.quantity, balance: t.balanceAfter, reference: t.reference || '', user: t.userName || '', remarks: t.remarks || '' })), total }; } },
};


const sd = (d?: Date | null) => fmtDate(d);
const salesLike = (title: string, type: 'SALE' | 'REJECTION'): Report => ({ title, columns: [{ header: 'Date', key: 'date', width: 14 }, { header: 'Customer', key: 'party', width: 24 }, { header: 'Item', key: 'item', width: 34 }, { header: type === 'SALE' ? 'Quantity' : 'Quantity (+ returned in / - sent out)', key: 'quantity', type: 'number', width: 18 }, { header: 'Doc No.', key: 'doc', width: 14 }, { header: 'Entered by', key: 'user', width: 16 }, { header: 'Remarks', key: 'remarks', width: 30 }],
  async run(q, { skip, limit }) {
    const f: any = { ...txnFilter(q), type, cancelled: { $ne: true } }; if (q.party) f.party = new RegExp(String(q.party).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const [rows, total] = await Promise.all([StockTransaction.find(f).sort({ date: -1, _id: -1 }).skip(skip).limit(limit).populate('itemId', 'name').lean(), StockTransaction.countDocuments(f)]);
    return { rows: rows.map(t => ({ date: sd(t.date), party: t.party || '', item: nm(t.itemId), quantity: type === 'SALE' ? Math.abs(t.quantity) : t.quantity, doc: t.reference || '', user: t.userName || '', remarks: t.remarks || '' })), total }; } });
REPORTS.sales = salesLike('Sales Report', 'SALE'); REPORTS.rejections = salesLike('Rejection Report', 'REJECTION');
REPORTS.orders = { title: 'Orders Placed With Suppliers', columns: [{ header: 'Order No.', key: 'no', width: 20 }, { header: 'Order Date', key: 'date', width: 14 }, { header: 'Supplier', key: 'supplier', width: 16 }, { header: 'Item', key: 'item', width: 34 }, { header: 'Ordered', key: 'qty', type: 'number' }, { header: 'Received', key: 'recv', type: 'number' }, { header: 'Pending', key: 'pend', type: 'number' }, { header: 'Expected By', key: 'exp', width: 14 }, { header: 'Status', key: 'status', width: 12 }],
  async run(q, { skip, limit }) {
    const f: any = { status: ['OPEN', 'RECEIVED', 'CANCELLED'].includes(q.status) ? q.status : { $ne: 'CANCELLED' } }; if (q.supplierId && Types.ObjectId.isValid(q.supplierId)) f.supplierId = q.supplierId; if (q.itemId && Types.ObjectId.isValid(q.itemId)) f.itemId = q.itemId;
    const dr = rangeFilter(q); if (dr) f.orderDate = dr;
    const [rows, total] = await Promise.all([OrderLine.find(f).sort({ orderDate: -1, _id: -1 }).skip(skip).limit(limit).populate('supplierId', 'name').populate('itemId', 'name').lean(), OrderLine.countDocuments(f)]);
    return { rows: rows.map(o => ({ no: o.orderNo, date: sd(o.orderDate), supplier: nm(o.supplierId), item: nm(o.itemId), qty: o.quantity, recv: o.receivedQty, pend: o.status === 'CANCELLED' ? 0 : Math.max(0, o.quantity - o.receivedQty), exp: sd(o.expectedDate), status: o.status })), total }; } };
REPORTS.availability = { title: 'Stock Availability', columns: [{ header: 'Item', key: 'item', width: 34 }, { header: 'Available', key: 'avail', type: 'number' }, { header: 'Pending In Order', key: 'pend', type: 'number', width: 16 }, { header: 'Expected By', key: 'exp', width: 14 }],
  async run(q, { skip, limit }) {
    const f = await resolveItemFilter({ q: q.q }); const [items, total] = await Promise.all([Item.find(f, 'name currentStock').sort({ name: 1 }).skip(skip).limit(limit).lean(), Item.countDocuments(f)]);
    const pend = await pendingFor(items.map(i => i._id)); return { rows: items.map(i => ({ item: i.name, avail: i.currentStock, pend: pend.get(String(i._id))?.pendingQty || 0, exp: sd(pend.get(String(i._id))?.expectedDate) })), total }; } };

async function sendXlsx(res: Response, name: string, r: Report, q: any) {
  const { rows, total } = await r.run(q, { skip: 0, limit: EXPORT_CAP });
  if (total > EXPORT_CAP) throw new HttpError(400, `Too many rows to export (${total}). Narrow the filters.`);
  const buf = await buildExcel(r.title, r.title, r.columns, rows);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.xlsx"`); res.send(buf);
}
reportsRouter.get('/:name', asyncH(async (req, res) => {
  const r = REPORTS[req.params.name]; if (!r) throw new HttpError(404, 'Unknown report');
  if (req.user!.role !== 'ADMIN') { if (!['sales', 'availability'].includes(req.params.name)) throw new HttpError(403, 'Not allowed for your panel'); (req.query as any).userId = req.user!.id; }   // sales team: only their own sales + availability
  if (req.query.format === 'xlsx') return void (await sendXlsx(res, req.params.name, r, req.query));
  const { limit, page, skip } = paging(req.query, 500); const out = await r.run(req.query, { skip, limit });
  res.json({ title: r.title, columns: r.columns, ...out, page, pages: Math.ceil(out.total / limit) });
}));
