import { Supplier } from '../models';
import { escapeRegex } from './http';
import { ORDER_STATUSES } from './stockLogic';

export interface ItemFilter { special?: string; q?: string; status?: string; priority?: string; supplierId?: string; category?: string; view?: string; active?: string }
const OID = /^[a-f\d]{24}$/i;
/** One shared filter builder: used by Items list, Reorder, Dashboard and every report so numbers always agree. */
export async function buildItemFilter(f: ItemFilter, mode: 'contains' | 'prefix' = 'contains'): Promise<Record<string, any>> {
  const m: Record<string, any> = { active: f.active === 'false' ? false : true };
  if (f.view === 'order') m.status = { $in: ORDER_STATUSES };
  else if (f.status) { const list = String(f.status).split(',').filter(s => ['GOOD', 'LOW', 'ORDER_REQUIRED', 'OUT_OF_STOCK', 'NOT_SET'].includes(s)); if (list.length) m.status = { $in: list }; }
  if (f.priority === 'TOP' || f.priority === 'NORMAL') m.priority = f.priority;
  if (f.supplierId === 'none') m.supplierId = null; else if (f.supplierId && OID.test(f.supplierId)) m.supplierId = f.supplierId;
  if (f.category) m.category = String(f.category);
  if (f.special === 'true') m.special = true;
  const q = String(f.q || '').trim().toLowerCase();
  if (q) {
    const terms = q.split(/\s+/).slice(0, 6).map(t => new RegExp(escapeRegex(t)));
    const prefix = q.split(/[^a-z0-9]+/).filter(Boolean).slice(0, 6).map(t => ({ tokens: new RegExp('^' + escapeRegex(t)) }));            // every word must appear -> "btjnl 2525" works
    const sup = await Supplier.find({ nameKey: new RegExp(escapeRegex(q.toUpperCase())) }, '_id').limit(10).lean();
    m.$or = [mode === 'prefix' && prefix.length ? { $and: prefix } : { $and: terms.map(t => ({ searchText: t })) }, ...(sup.length ? [{ supplierId: { $in: sup.map(s => s._id) } }] : [])];
  }
  return m;
}
const SORTABLE: Record<string, string> = { name: 'name', code: 'code', currentStock: 'currentStock', targetStock: 'targetStock', reorderLevel: 'effectiveReorderLevel', status: 'statusRank', priority: 'priority', suggestedOrderQty: 'suggestedOrderQty', lastPurchaseDate: 'lastPurchaseDate', updatedAt: 'updatedAt', category: 'category' };
export function buildSort(sort?: string, order?: string): Record<string, 1 | -1> {
  const key = SORTABLE[String(sort)] ; const dir = order === 'desc' ? -1 : 1;
  if (!key) return { priority: -1, statusRank: 1, name: 1 };            // default: TOP PRIORITY first, then worst status
  return key === 'name' ? { name: dir } : { [key]: dir, name: 1 };
}

/** Fast path first (indexed word-prefix match). If that finds nothing, fall back to 'contains' so partial codes still work. */
export async function resolveItemFilter(f: ItemFilter): Promise<Record<string, any>> {
  const p = await buildItemFilter(f, 'prefix'); if (!String(f.q || '').trim()) return p;
  const { Item } = await import('../models'); return (await Item.exists(p)) ? p : buildItemFilter(f, 'contains');
}
