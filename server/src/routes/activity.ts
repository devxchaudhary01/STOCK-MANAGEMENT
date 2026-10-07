import { Router } from 'express';
import { StockTransaction, User } from '../models';
import { asyncH, rangeFilter } from '../lib/http';
import { authRequired, requireRole } from '../middleware/auth';

export const activityRouter = Router();
activityRouter.use(authRequired, requireRole('ADMIN'));
/** Who booked what: per-employee totals for a date range (details come from /api/entries?userId=). */
activityRouter.get('/', asyncH(async (req, res) => {
  const m: any = { type: 'SALE', cancelled: { $ne: true } }; const r = rangeFilter(req.query); if (r) m.date = r;
  const g = await StockTransaction.aggregate([{ $match: m }, { $group: { _id: '$userId', qty: { $sum: '$quantity' } } }]);
  const users = await User.find({ role: 'SALES' }, 'name username active').lean(); const name = new Map(users.map(u => [String(u._id), u]));
  const rows = await Promise.all(g.map(async x => ({ userId: x._id, name: name.get(String(x._id))?.name || '(removed)', username: name.get(String(x._id))?.username, qty: Math.abs(x.qty), lines: await StockTransaction.countDocuments({ ...m, userId: x._id }) })));
  const idle = users.filter(u => u.active && !g.some(x => String(x._id) === String(u._id))).map(u => ({ userId: u._id, name: u.name, username: u.username, qty: 0, lines: 0 }));
  res.json({ rows: [...rows.sort((a, b) => b.qty - a.qty), ...idle], totalQty: rows.reduce((a, x) => a + x.qty, 0), totalLines: rows.reduce((a, x) => a + x.lines, 0) });
}));
