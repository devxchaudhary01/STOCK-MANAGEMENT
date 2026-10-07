import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, download, qs } from '../api';
import { today } from '../ui';
import { useAuth } from '../App';
import { Empty, ErrorBox, Field, fmtDate, fmtNum, Modal, PageHeader, Pager, PriorityBadge, Spinner, StatusBadge, useApi, useToast } from '../ui';

/** Items that need ordering, optionally for one supplier. Used by Reorder and Supplier pages. */
export function OrderTable({ supplierId, name }: { supplierId: string; name: string }) {
  const [page, setPage] = useState(1); const nav = useNavigate(); const toast = useToast(); const [ordering, setOrdering] = useState(false); const { data, loading, error, reload } = useApi('/reorder' + qs({ supplierId, page, limit: 100 }));
  const canOrder = !!supplierId && supplierId !== 'none';
  return <div className="card overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-200"><div className="font-semibold">Order from {name}{data && <span className="font-normal text-slate-500"> — {fmtNum(data.total)} items, {fmtNum(data.totalSuggestedQty)} pieces in total</span>}</div>
    <div className="flex gap-2"><button className="btn" onClick={() => download('/reports/order-required' + qs({ supplierId, format: 'xlsx' }), `order-${name}.xlsx`)}>Export Excel</button>{canOrder && <button className="btn btn-primary" onClick={() => setOrdering(true)}>Order now</button>}</div></div><ErrorBox msg={error} />
    {ordering && <Modal title={`Order from ${name}`} onClose={() => setOrdering(false)}><OrderNow supplierId={supplierId} onDone={m => { setOrdering(false); toast(m); reload(); }} /></Modal>}
    {loading && !data ? <Spinner /> : !data?.rows.length ? <Empty>Nothing needs ordering{supplierId === 'none' ? ' without a supplier' : ' from this supplier'} right now.</Empty> : <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Item</th><th className="text-right">Criteria</th><th className="text-right">Available</th><th className="text-right">On order</th><th className="text-right">Required</th><th>Priority</th><th>Status</th></tr></thead>
      <tbody>{data.rows.map((r: any) => <tr key={r._id} className="cursor-pointer" onClick={() => nav('/items/' + r._id)}><td className="font-medium">{r.name}</td><td className="text-right tabular-nums">{fmtNum(r.targetStock)}</td><td className="text-right tabular-nums font-medium">{fmtNum(r.currentStock)}</td><td className="text-right tabular-nums">{r.onOrderQty ? <>{fmtNum(r.onOrderQty)}<div className="text-xs text-slate-500">by {fmtDate(r.expectedDate)}</div></> : '—'}</td><td className="text-right tabular-nums font-semibold">{fmtNum(r.stillRequired)}</td><td><PriorityBadge p={r.priority} /></td><td><StatusBadge status={r.status} /></td></tr>)}</tbody></table></div>}
    {data && <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}</div>;
}

function OrderNow({ supplierId, onDone }: { supplierId: string; onDone: (m: string) => void }) {
  const [d, setD] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + 7 * 864e5))); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  return <div className="space-y-3"><p className="text-sm text-slate-600">Creates an order for everything still required from this supplier. Quantity already on order is not ordered again. Your sales team will see the expected date.</p><ErrorBox msg={err} />
    <Field label="Expected by"><input className="inp" type="date" min={today()} value={d} onChange={e => setD(e.target.value)} /></Field><button className="btn btn-primary" disabled={busy} onClick={async () => { setBusy(true); try { const r = await api.post('/orders/from-reorder', { supplierId, expectedDate: d }); onDone(`Order ${r.orderNo}: ${r.lines} items, ${r.totalQty} pieces`); } catch (e: any) { setErr(e.message); setBusy(false); } }}>Place order</button></div>;
}
export function Reorder() {
  const [sp, setSp] = useSearchParams(); const sup = useApi('/suppliers'); const sel = sp.get('supplierId') ?? '';
  const tabs: [string, string, number | undefined][] = [['', 'All suppliers', undefined], ...((sup.data?.suppliers || []).map((s: any) => [s._id, s.name, s.itemsToOrder]) as any), ['none', 'No supplier', sup.data?.unassigned.itemsToOrder]];
  const name = tabs.find(t => t[0] === sel)?.[1] || 'all suppliers';
  return <><PageHeader title="Reorder" sub="What to order, and from whom" />
    <div className="flex flex-wrap gap-1.5 mb-3">{tabs.map(([id, label, n]) => <button key={id} onClick={() => setSp(id ? { supplierId: id } : {})} className={`rounded-full border px-3 py-1 text-sm ${sel === id ? 'bg-brand text-white border-brand' : 'bg-white border-slate-300 hover:bg-slate-100'}`}>{label}{n !== undefined && <span className={`ml-1.5 rounded-full px-1.5 text-xs ${sel === id ? 'bg-white/25' : 'bg-slate-200'}`}>{n}</span>}</button>)}</div>
    <OrderTable key={sel} supplierId={sel} name={name} /></>;
}

export default function Suppliers() {
  const { isAdmin } = useAuth(); const { data, loading, error, reload } = useApi('/suppliers?all=true'); const [edit, setEdit] = useState<any>(null);
  return <><PageHeader title="Suppliers" sub="Click a supplier to see what to order from them">{isAdmin && <button className="btn btn-primary" onClick={() => setEdit({})}>Add supplier</button>}</PageHeader><ErrorBox msg={error} />
    {loading && !data ? <Spinner /> : <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{data?.suppliers.map((s: any) => <div key={s._id} className={`card p-4 ${s.active ? '' : 'opacity-60'}`}>
      <div className="flex items-start justify-between"><Link to={'/suppliers/' + s._id} className="text-lg font-semibold text-brand hover:underline">{s.name}</Link>{!s.active && <span className="text-xs text-slate-500">Inactive</span>}</div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-sm"><div><div className="text-xl font-semibold tabular-nums text-bad">{s.itemsToOrder}</div><div className="text-slate-500">to order</div></div><div><div className="text-xl font-semibold tabular-nums">{fmtNum(s.qtyToOrder)}</div><div className="text-slate-500">pieces</div></div><div><div className="text-xl font-semibold tabular-nums">{fmtNum(s.itemsAssigned)}</div><div className="text-slate-500">items assigned</div></div></div>
      <div className="mt-3 flex gap-2"><Link className="btn !py-1" to={'/suppliers/' + s._id}>Open</Link>{isAdmin && <button className="btn !py-1" onClick={() => setEdit(s)}>Edit</button>}</div></div>)}
      <Link to="/reorder?supplierId=none" className="card p-4 border-dashed hover:bg-slate-50"><div className="text-lg font-semibold text-unset">No supplier assigned</div><div className="mt-3 text-sm"><b className="text-xl tabular-nums">{fmtNum(data?.unassigned.itemsAssigned)}</b> items. Assign suppliers from the Items page.</div></Link></div></>}
    {edit && <SupplierForm s={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}</>;
}
function SupplierForm({ s, onClose, onSaved }: { s: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast(); const [m, setM] = useState({ name: s.name || '', phone: s.phone || '', notes: s.notes || '', active: s.active ?? true }); const [err, setErr] = useState('');
  async function save(e: FormEvent) { e.preventDefault(); try { s._id ? await api.put('/suppliers/' + s._id, m) : await api.post('/suppliers', m); toast('Supplier saved'); onSaved(); } catch (x: any) { setErr(x.message); } }
  return <Modal title={s._id ? 'Edit supplier' : 'Add supplier'} onClose={onClose}><form onSubmit={save} className="space-y-3"><ErrorBox msg={err} /><Field label="Name"><input className="inp" required value={m.name} onChange={e => setM({ ...m, name: e.target.value })} /></Field><Field label="Phone (optional)"><input className="inp" value={m.phone} onChange={e => setM({ ...m, phone: e.target.value })} /></Field><Field label="Notes (optional)"><input className="inp" value={m.notes} onChange={e => setM({ ...m, notes: e.target.value })} /></Field>
    {s._id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={m.active} onChange={e => setM({ ...m, active: e.target.checked })} />Active (inactive suppliers cannot be used for new purchases)</label>}<div className="flex justify-end gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary">Save supplier</button></div></form></Modal>;
}

export function SupplierDetail() {
  const { id } = useParams(); const { data, loading, error } = useApi('/suppliers/' + id); if (loading && !data) return <Spinner />; if (error) return <ErrorBox msg={error} />;
  const { supplier: s, stats, topItems, recent } = data; const Stat = ({ l, v }: { l: string; v: any }) => <div className="card p-3"><div className="text-xl font-semibold tabular-nums">{v}</div><div className="text-sm text-slate-500">{l}</div></div>;
  return <><PageHeader title={s.name} sub={s.phone || undefined}><Link className="btn" to="/suppliers">All suppliers</Link></PageHeader>
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4"><Stat l="Items to order now" v={stats.itemsToOrder} /><Stat l="Purchase transactions" v={fmtNum(stats.purchaseTransactions)} /><Stat l="Quantity purchased" v={fmtNum(stats.totalQuantity)} /><Stat l="Different items bought" v={fmtNum(stats.distinctItems)} /><Stat l="Last purchase" v={fmtDate(stats.lastPurchase)} /></div>
    <OrderTable supplierId={id!} name={s.name} />
    <div className="grid gap-4 xl:grid-cols-2 mt-4">
      <div className="card overflow-hidden"><div className="px-4 py-3 font-semibold border-b border-slate-200">Most purchased items</div>{!topItems.length ? <Empty>No purchases yet.</Empty> : <table className="tbl"><thead><tr><th>Item</th><th className="text-right">Quantity</th></tr></thead><tbody>{topItems.map((t: any) => <tr key={t._id}><td><Link className="hover:underline" to={'/items/' + t._id}>{t.name}</Link></td><td className="text-right tabular-nums">{fmtNum(t.qty)}</td></tr>)}</tbody></table>}</div>
      <div className="card overflow-hidden"><div className="px-4 py-3 font-semibold border-b border-slate-200">Recent purchases</div>{!recent.length ? <Empty>No purchases yet.</Empty> : <table className="tbl"><thead><tr><th>Date</th><th>Item</th><th className="text-right">Qty</th><th>Invoice</th></tr></thead><tbody>{recent.map((p: any) => <tr key={p._id}><td>{fmtDate(p.date)}</td><td>{p.itemId?.name}</td><td className="text-right tabular-nums">{fmtNum(p.quantity)}</td><td>{p.invoiceNumber || '—'}</td></tr>)}</tbody></table>}</div></div></>;
}
