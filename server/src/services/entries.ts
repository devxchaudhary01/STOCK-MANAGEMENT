import { Purchase } from '../models';
import { applyTransaction, HttpError } from './stock';
import { allocateReceipt } from './orders';

export type EntryType = 'SALE' | 'PURCHASE' | 'REJECTION';
export interface EntryCtx { userId: string; userName: string; date: Date; remarks?: string; docNo?: string; party?: string; supplierId?: string; docType?: 'INVOICE' | 'CHALLAN'; invoiceId?: string; direction?: 'IN' | 'OUT' }

/** One line of a daily entry. Every path (manual, Excel, photo, voice) ends here, so stock + audit + order tracking always behave the same. */
export async function recordLine(type: EntryType, itemId: string, qty: number, c: EntryCtx) {
  const who = { userId: c.userId, userName: c.userName };
  if (!(qty > 0)) throw new HttpError(400, 'Quantity must be greater than 0');
  if (type === 'PURCHASE') {
    if (!c.supplierId) throw new HttpError(400, 'Supplier is required for a purchase / challan');
    const p = await Purchase.create({ date: c.date, supplierId: c.supplierId, itemId, quantity: qty, invoiceNumber: c.docNo, docType: c.docType || 'INVOICE', invoiceId: c.invoiceId, remarks: c.remarks, ...who });
    try {
      const r = await applyTransaction({ itemId, type: 'PURCHASE', quantity: qty, date: c.date, supplierId: c.supplierId, reference: c.docNo, invoiceId: c.invoiceId, purchaseId: p._id, remarks: c.remarks, ...who });
      p.transactionId = r.txn._id; p.set('allocations', await allocateReceipt(itemId, c.supplierId, qty)); await p.save();
      return { txn: r.txn, item: r.item, purchase: p };
    } catch (e) { await Purchase.deleteOne({ _id: p._id }); throw e; }
  }
  if (type === 'SALE') { const r = await applyTransaction({ itemId, type: 'SALE', quantity: qty, date: c.date, party: c.party, reference: c.docNo, remarks: c.remarks, guardNegative: true, ...who }); return { txn: r.txn, item: r.item }; }
  if (!c.direction) throw new HttpError(400, 'Rejection needs a direction (IN = returned by customer, OUT = rejected to supplier)');
  const r = await applyTransaction({ itemId, type: 'REJECTION', quantity: c.direction === 'IN' ? qty : -qty, date: c.date, party: c.party, supplierId: c.supplierId, reference: c.docNo, remarks: c.remarks, guardNegative: true, ...who });
  return { txn: r.txn, item: r.item };
}
