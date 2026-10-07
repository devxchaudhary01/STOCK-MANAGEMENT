import { Request, Response, NextFunction, RequestHandler } from 'express';
import { z, ZodTypeAny } from 'zod';
import { config } from '../config';
import { HttpError } from '../services/stock';

export const asyncH = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler => (req, res, next) => { fn(req, res, next).catch(next); };
export const parse = <T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> => schema.parse(data);
export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const paging = (q: any, max = 200) => { const limit = Math.min(Math.max(parseInt(q.limit) || 50, 1), max); const page = Math.max(parseInt(q.page) || 1, 1); return { limit, page, skip: (page - 1) * limit }; };

// ---------- dates: everything is a calendar day in the company timezone (default Asia/Kolkata) ----------
function tzOffsetMin(tz: string, at: Date) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at);
  const g = (t: string) => Number(p.find(x => x.type === t)!.value);
  return (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - at.getTime()) / 60000;
}
export const ymdToday = (tz = config.tz, at = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(at);
/** 'YYYY-MM-DD' -> instant of midnight at the start of that day in company tz. */
export function dayStart(ymd: string, tz = config.tz): Date {
  const [y, m, d] = ymd.split('-').map(Number); const guess = new Date(Date.UTC(y, m - 1, d));
  return new Date(guess.getTime() - tzOffsetMin(tz, guess) * 60000);
}
export const addDays = (ymd: string, n: number) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** preset: today | yesterday | week | month | custom(from,to). Returns [start, endExclusive) or null for no filter. */
export function resolveRange(q: { preset?: string; from?: string; to?: string }, now = new Date()): { from: Date; to: Date } | null {
  const today = ymdToday(config.tz, now);
  switch (q.preset) {
    case 'today': return { from: dayStart(today), to: dayStart(addDays(today, 1)) };
    case 'yesterday': return { from: dayStart(addDays(today, -1)), to: dayStart(today) };
    case 'week': { const dow = (new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7; const mon = addDays(today, -dow); return { from: dayStart(mon), to: dayStart(addDays(today, 1)) }; }
    case 'month': return { from: dayStart(today.slice(0, 8) + '01'), to: dayStart(addDays(today, 1)) };
    case 'lastmonth': { const [y, m] = today.split('-').map(Number); const py = m === 1 ? y - 1 : y; const pm = m === 1 ? 12 : m - 1; return { from: dayStart(`${py}-${String(pm).padStart(2, '0')}-01`), to: dayStart(`${y}-${String(m).padStart(2, '0')}-01`) }; }
    case 'quarter': { const [y, m] = today.split('-').map(Number); const qm = Math.floor((m - 1) / 3) * 3 + 1; return { from: dayStart(`${y}-${String(qm).padStart(2, '0')}-01`), to: dayStart(addDays(today, 1)) }; }   // Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec (same as Indian FY quarters)
    case 'fy': { const [y, m] = today.split('-').map(Number); const fy = m >= 4 ? y : y - 1; return { from: dayStart(`${fy}-04-01`), to: dayStart(addDays(today, 1)) }; }
    case 'year': return { from: dayStart(today.slice(0, 4) + '-01-01'), to: dayStart(addDays(today, 1)) };
  }
  if (q.from && YMD.test(q.from)) return { from: dayStart(q.from), to: dayStart(addDays(q.to && YMD.test(q.to) ? q.to : q.from, 1)) };
  if (q.to && YMD.test(q.to)) return { from: new Date(0), to: dayStart(addDays(q.to, 1)) };
  return null;
}
export const rangeFilter = (q: any) => { const r = resolveRange(q); return r ? { $gte: r.from, $lt: r.to } : undefined; };
export const parseYmd = (s: string) => { if (!YMD.test(s)) throw new HttpError(400, 'Date must be YYYY-MM-DD'); return dayStart(s); };
