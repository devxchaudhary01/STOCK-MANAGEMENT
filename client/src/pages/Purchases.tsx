import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, download, qs } from '../api';
import { useAuth } from '../App';
import { DateFilters, dateParams, Empty, ErrorBox, Field, fmtDate, fmtNum, ItemPicker, PageHeader, Pager, Spinner, SupplierSelect, today, useApi, useToast } from '../ui';

export default function Purchases({ isNew }: { isNew?: boolean }) { return isNew ? <NewPurchase /> : <History />; }

function History() {
  const { isAdmin } = useAuth(); const toast = useToast();
  const [d, setD] = useState({ preset: '', from: '', to: '' }); const [supplierId, setS] = useState(''); const [item, setItem] = useState<any>(null); const [invoice, setInv] = useState(''); const [page, setPage] = useState(1);
  const f = { supplierId, itemId: item?.id, invoice, ...dateParams(d) };
  const { data, loading, error, reload } = useApi('/purchases' + qs({ ...f, page, limit: 50 }));
  const quick = (preset: string) => { setD({ preset, from: '', to: '' }); setPage(1); };
  const cancel = async (id: string) => { if (!confirm('Cancel this purchase? Stock will be reduced by this quantity and an adjustment will be recorded.')) return; try { await api.del('/purchases/' + id); toast('Purchase cancelled'); reload(); } catch (e: any) { toast(e.message, 'err'); } };
  return <>
    <PageHeader title="Purchases" sub="Purchase history and daily purchase report"><button className="btn" onClick={() => download('/reports/purchases' + qs({ ...f, format: 'xlsx' }))}>Export Excel</button><Link className="btn btn-primary" to="/entry">Add purchase / challan</Link></PageHeader>
    <div className="flex flex-wrap gap-1.5 mb-2">{[['', 'All'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['month', 'This month']].map(([k, l]) => <button key={k} onClick={() => quick(k)} className={`rounded-full border px-3 py-1 text-sm ${d.preset === k ? 'bg-brand text-white border-brand' : 'bg-white border-slate-300 hover:bg-slate-100'}`}>{l}</button>)}</div>
    <div className="card p-3 mb-3 flex flex-wrap gap-2 items-center"><DateFilters v={d} set={(x: any) => { setD(x); setPage(1); }} /><SupplierSelect className="inp !w-auto" value={supplierId} onChange={v => { setS(v); setPage(1); }} includeAll="All suppliers" /><div className="w-64"><ItemPicker value={item} onPick={i => { setItem(i); setPage(1); }} placeholder="Filter by item…" /></div><input className="inp !w-40" placeholder="Invoice no." value={invoice} onChange={e => { setInv(e.target.value); setPage(1); }} /></div>
    <ErrorBox msg={error} />
    <div className="card overflow-hidden">{loading && !data ? <Spinner /> : !data?.rows.length ? <Empty>No purchases found for these filters.</Empty> : <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Date</th><th>Supplier</th><th>Item</th><th className="text-right">Quantity</th><th>Invoice no.</th><th>User</th><th>Remarks</th>{isAdmin && <th></th>}</tr></thead>
      <tbody>{data.rows.map((p: any) => <tr key={p._id}><td className="whitespace-nowrap">{fmtDate(p.date)}</td><td>{p.supplierId?.name}</td><td className="font-medium">{p.itemId ? <Link className="hover:underline" to={'/items/' + p.itemId._id}>{p.itemId.name}</Link> : '—'}</td><td className="text-right tabular-nums">{fmtNum(p.quantity)}</td>
        <td>{p.invoiceNumber || '—'}{p.invoiceId && <button className="ml-2 text-brand underline text-xs" onClick={() => download('/import/invoice/' + p.invoiceId + '/file', 'invoice', true)}>View file</button>}</td><td>{p.userName}</td><td className="max-w-[16rem] truncate" title={p.remarks}>{p.remarks}</td>{isAdmin && <td><button className="text-bad text-xs underline" onClick={() => cancel(p._id)}>Cancel</button></td>}</tr>)}</tbody></table></div>}
      {data && <><div className="px-4 py-2 border-t border-slate-100 text-sm font-medium">Total quantity for these filters: {fmtNum(data.totalQuantity)}</div><Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} /></>}</div></>;
}

function NewPurchase() {
  const nav = useNavigate(); const toast = useToast(); const [sp] = useSearchParams();
  const [date, setDate] = useState(today()); const [supplierId, setSup] = useState(''); const [item, setItem] = useState<any>(null); const [qty, setQty] = useState(''); const [inv, setInv] = useState(''); const [remarks, setRemarks] = useState(''); const [file, setFile] = useState<File | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { const id = sp.get('itemId'); if (id) api.get('/items/' + id).then(d => { setItem({ id, name: d.item.name, ...d.item }); if (d.item.supplierId?._id) setSup(d.item.supplierId._id); }).catch(() => {}); }, [sp]);
  const pick = (i: any) => { setItem(i); if (i?.supplierId?._id && !supplierId) setSup(i.supplierId._id); };
  async function save(e: FormEvent) {
    e.preventDefault(); if (!item) return setErr('Choose an item'); if (!supplierId) return setErr('Choose a supplier'); setBusy(true); setErr('');
    try {
      let invoiceId: string | undefined; if (file) { const fd = new FormData(); fd.append('file', file); invoiceId = (await api.upload('/purchases/invoice-file', fd)).invoiceId; }
      const r = await api.post('/purchases', { date, supplierId, itemId: item.id, quantity: Number(qty), invoiceNumber: inv || undefined, invoiceId, remarks: remarks || undefined });
      toast(`Purchase saved. ${item.name} stock is now ${r.newStock}.`); nav('/purchases');
    } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  }
  return <><PageHeader title="Add purchase" sub="Saving a purchase adds the quantity to current stock"><Link className="btn" to="/purchases">Back to history</Link></PageHeader>
    <form onSubmit={save} className="card p-5 max-w-2xl space-y-4"><ErrorBox msg={err} />
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Date"><input className="inp" type="date" required value={date} onChange={e => setDate(e.target.value)} max={today()} /></Field><Field label="Supplier"><SupplierSelect value={supplierId} onChange={setSup} includeAll="Choose supplier…" /></Field></div>
      <Field label="Item"><ItemPicker value={item} onPick={pick} /></Field>
      {item && item.currentStock !== undefined && <p className="text-sm text-slate-600 -mt-2">Current stock: <b>{fmtNum(item.currentStock)}</b></p>}
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Quantity"><input className="inp" type="number" min={0} step="any" required value={qty} onChange={e => setQty(e.target.value)} /></Field><Field label="Invoice number (optional)"><input className="inp" value={inv} onChange={e => setInv(e.target.value)} maxLength={60} /></Field></div>
      <Field label="Invoice photo or PDF (optional)" hint="JPG, PNG, WEBP or PDF"><input className="inp" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e => setFile(e.target.files?.[0] || null)} /></Field>
      <Field label="Remarks (optional)"><input className="inp" value={remarks} onChange={e => setRemarks(e.target.value)} maxLength={300} /></Field>
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save purchase'}</button></form>
    <p className="text-sm text-slate-500 mt-3">Have a supplier invoice photo with many lines? Use <Link className="underline" to="/import">Import / Export → Invoice</Link> to read it automatically.</p></>;
}
