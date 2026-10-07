import { Types } from 'mongoose';
import { OrderLine } from '../models';

export interface Pending { pendingQty: number; expectedDate: Date | null; incoming: { qty: number; expectedDate: Date | null }[] }
/** Quantity still to arrive from suppliers (admin's open orders) + when. Portable find() + JS grouping, uses the {itemId,status,expectedDate} index. */
export async function pendingFor(itemIds: (string | Types.ObjectId)[]): Promise<Map<string, Pending>> {
  const out = new Map<string, Pending>(); if (!itemIds.length) return out;
  const lines = await OrderLine.find({ itemId: { $in: itemIds }, status: 'OPEN' }, 'itemId quantity receivedQty expectedDate').sort({ expectedDate: 1 }).lean();
  for (const l of lines) {
    const qty = l.quantity - l.receivedQty; if (qty <= 0) continue; const k = String(l.itemId);
    const p = out.get(k) || { pendingQty: 0, expectedDate: null, incoming: [] };
    p.pendingQty += qty; p.incoming.push({ qty, expectedDate: l.expectedDate || null }); if (!p.expectedDate && l.expectedDate) p.expectedDate = l.expectedDate; out.set(k, p);
  }
  return out;
}
/** Receipt from a supplier closes that supplier's oldest open order lines for the item (first in, first out). */
export async function allocateReceipt(itemId: string | Types.ObjectId, supplierId: string | Types.ObjectId, qty: number) {
  const lines = await OrderLine.find({ itemId, supplierId, status: 'OPEN' }).sort({ expectedDate: 1, orderDate: 1 }).lean(); const out: { lineId: Types.ObjectId; qty: number }[] = []; let left = qty;
  for (const l of lines) {
    if (left <= 0) break; const take = Math.min(l.quantity - l.receivedQty, left); if (take <= 0) continue; const nr = l.receivedQty + take;
    await OrderLine.updateOne({ _id: l._id }, { $set: { receivedQty: nr, status: nr >= l.quantity ? 'RECEIVED' : 'OPEN' } }); out.push({ lineId: l._id, qty: take }); left -= take;
  }
  return out;
}
export async function reverseAllocations(allocs: { lineId?: Types.ObjectId | null; qty?: number | null }[]) {
  for (const a of allocs) { if (!a.lineId || !a.qty) continue; const l = await OrderLine.findById(a.lineId); if (!l || l.status === 'CANCELLED') continue; l.receivedQty = Math.max(0, l.receivedQty - a.qty); l.status = l.receivedQty >= l.quantity ? 'RECEIVED' : 'OPEN'; await l.save(); }
}
