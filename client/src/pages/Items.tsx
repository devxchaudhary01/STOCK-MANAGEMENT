import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, download, qs } from '../api';
import { useAuth } from '../App';
import { Empty, ErrorBox, Field, fmtDate, fmtNum, ItemPicker, Modal, PageHeader, Pager, PriorityBadge, Spinner, StatusBadge, SupplierSelect, today, useApi, useDebounced, useToast } from '../ui';

const RULE_TEXT: Record<string, string> = { DIRECT_LEVEL: 'Direct reorder level', ITEM_PERCENT: "This item's own percentage of target", DEFAULT_PERCENT: 'Default percentage of target (from Settings)', NONE: 'No criteria set' };

// ---------------- Items list ----------------
export function Items() {
  const nav = useNavigate(); const { isAdmin } = useAuth(); const toast = useToast();
  const [q, setQ] = useState(''); const dq = useDebounced(q); const [status, setStatus] = useState(''); const [priority, setPriority] = useState(''); const [supplierId, setSupplierId] = useState(''); const [category, setCategory] = useState(''); const [special, setSpecial] = useState(false);
  const [sort, setSort] = useState('name'); const [order, setOrder] = useState('asc'); const [page, setPage] = useState(1); const [edit, setEdit] = useState<any>(null); const [bulk, setBulk] = useState(false);
  const cats = useApi('/items/categories');
  const f = { q: dq, status, priority, supplierId, category, special: special ? 'true' : '' };
  const { data, loading, error, reload } = useApi('/items' + qs({ ...f, sort, order, page, limit: 50 }));
  const th = (key: string, label: string, right = false) => <th className={`cursor-pointer select-none ${right ? 'text-right' : ''}`} onClick={() => { setPage(1); if (sort === key) setOrder(order === 'asc' ? 'desc' : 'asc'); else { setSort(key); setOrder('asc'); } }} aria-sort={sort === key ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}>{label}{sort === key ? (order === 'asc' ? ' ▲' : ' ▼') : ''}</th>;
  const set = (fn: (v: string) => void) => (e: any) => { fn(e.target.value); setPage(1); };
  return <>
    <PageHeader title="Items" sub="Search, filter and edit stock criteria">
      <button className="btn" onClick={() => download('/reports/current-stock' + qs({ ...f, format: 'xlsx' }))}>Export Excel</button>
      {isAdmin && <><button className="btn" onClick={() => setBulk(true)}>Assign supplier to these items</button><button className="btn" onClick={() => setEdit({})} title="Only for items that are NOT in your Excel item list">Add special item</button></>}</PageHeader>
    <div className="card p-3 mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      <input className="inp lg:col-span-2" placeholder="Search by item name, code or supplier…" value={q} onChange={set(setQ)} aria-label="Search items" />
      <select className="inp" value={status} onChange={set(setStatus)}><option value="">All statuses</option><option value="GOOD">Good</option><option value="LOW">Low stock</option><option value="ORDER_REQUIRED">Required</option><option value="OUT_OF_STOCK">Out of stock</option><option value="NOT_SET">Criteria not set</option></select>
      <select className="inp" value={priority} onChange={set(setPriority)}><option value="">All priorities</option><option value="TOP">Top priority</option><option value="NORMAL">Normal</option></select>
      <SupplierSelect value={supplierId} onChange={v => { setSupplierId(v); setPage(1); }} includeAll="All suppliers" includeNone />
      <select className="inp" value={category} onChange={set(setCategory)}><option value="">All categories</option>{cats.data?.categories.map((c: string) => <option key={c}>{c}</option>)}</select>
      <label className="flex items-center gap-2 text-sm px-1"><input type="checkbox" checked={special} onChange={e => { setSpecial(e.target.checked); setPage(1); }} />Special items only</label></div>
    <ErrorBox msg={error} />
    <div className="card overflow-hidden">{loading && !data ? <Spinner /> : !data?.items.length ? <Empty>No items match these filters.</Empty> : <div className="overflow-x-auto"><table className="tbl"><thead><tr>{th('name', 'Item name')}{th('code', 'Code')}<th>Supplier</th>{th('targetStock', 'Criteria', true)}{th('currentStock', 'Available', true)}{th('suggestedOrderQty', 'Required', true)}{th('status', 'Status')}{th('priority', 'Priority')}<th></th></tr></thead>
      <tbody>{data.items.map((i: any) => <tr key={i._id}><td className="font-medium"><Link className="hover:underline" to={'/items/' + i._id}>{i.name}</Link>{i.special && <span className="ml-2 rounded bg-warn/30 px-1.5 text-xs font-semibold">Special</span>}{i.category && <div className="text-xs text-slate-500">{i.category}</div>}</td><td>{i.code || '—'}</td><td>{i.supplierId?.name || <span className="text-unset">Not assigned</span>}</td>
        <td className="text-right tabular-nums">{fmtNum(i.targetStock)}</td><td className="text-right tabular-nums font-medium">{fmtNum(i.currentStock)}</td><td className="text-right tabular-nums font-semibold">{i.suggestedOrderQty ? fmtNum(i.suggestedOrderQty) : '—'}</td><td><StatusBadge status={i.status} /></td><td><PriorityBadge p={i.priority} /></td>
        <td className="whitespace-nowrap text-right">{isAdmin && <button className="btn !py-1 mr-1" onClick={() => setEdit(i)}>Edit</button>}<button className="btn !py-1" onClick={() => nav('/items/' + i._id)}>View history</button></td></tr>)}</tbody></table></div>}
      {data && <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}</div>
    {edit && <ItemForm item={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    {bulk && <Modal title="Assign supplier" onClose={() => setBulk(false)}><BulkSupplier filter={f} total={data?.total || 0} onDone={n => { setBulk(false); toast(`Supplier assigned to ${n} items`); reload(); }} /></Modal>}</>;
}

function BulkSupplier({ filter, total, onDone }: { filter: any; total: number; onDone: (n: number) => void }) {
  const [sid, setSid] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => { if (!sid) return setErr('Choose a supplier'); if (!confirm(`Assign this supplier to all ${total} items matching the current filters?`)) return; setBusy(true); try { onDone((await api.post('/items/bulk-supplier', { supplierId: sid, filter })).updated); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  return <div className="space-y-3"><p className="text-sm">This will set the supplier on <b>{fmtNum(total)}</b> items matching your current search and filters. Tip: filter by category first.</p><ErrorBox msg={err} /><SupplierSelect value={sid} onChange={setSid} includeAll="Choose supplier…" /><button className="btn btn-primary" disabled={busy} onClick={go}>Assign supplier</button></div>;
}

// ---------------- Item create / edit (criteria) ----------------
export function ItemForm({ item, onClose, onSaved }: { item: any; onClose: () => void; onSaved: () => void }) {
  const isNew = !item._id; const toast = useToast();
  const [m, setM] = useState({ name: item.name || '', code: item.code || '', category: item.category || '', priority: item.priority || 'NORMAL', supplierId: item.supplierId?._id || item.supplierId || '', targetStock: item.targetStock ?? '', reorderPct: item.reorderPct ?? '', reorderLevel: item.reorderLevel ?? '', openingStock: '' });
  const [rule, setRule] = useState<'PERCENT' | 'LEVEL'>(item.reorderLevel != null ? 'LEVEL' : 'PERCENT'); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const n = (v: any) => (v === '' || v === null ? null : Number(v));
  const dname = useDebounced(m.name, 350); const [chk, setChk] = useState<any>(null);
  useEffect(() => { if (!isNew || dname.trim().length < 2) { setChk(null); return; } let a = true; api.get('/items/check?name=' + encodeURIComponent(dname)).then(d => a && setChk(d)).catch(() => {}); return () => { a = false; }; }, [dname, isNew]);
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    const body: any = { name: m.name, code: m.code || null, category: m.category || null, priority: m.priority, supplierId: m.supplierId || null, targetStock: n(m.targetStock),
      reorderPct: rule === 'PERCENT' ? n(m.reorderPct) : null, reorderLevel: rule === 'LEVEL' ? n(m.reorderLevel) : null };
    if (rule === 'LEVEL' && body.reorderLevel === null) { setErr('Enter a reorder level, or switch to percentage'); setBusy(false); return; }
    if (isNew) { if (chk?.exists) { setErr(`Already in the item list as “${chk.item.name}”. No special item needed.`); setBusy(false); return; } body.special = true; }
    if (isNew && m.openingStock !== '') body.openingStock = Number(m.openingStock);
    try { isNew ? await api.post('/items', body) : await api.put('/items/' + item._id, body); toast(isNew ? 'Item added' : 'Item saved'); onSaved(); } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  }
  const up = (k: string) => (e: any) => setM({ ...m, [k]: e.target.value });
  return <Modal title={isNew ? 'Add special item' : 'Edit item'} onClose={onClose} wide><form onSubmit={save} className="space-y-4"><ErrorBox msg={err} />
    {isNew && <div className={`rounded-md border px-3 py-2 text-sm ${chk?.exists ? 'border-red-300 bg-red-50 text-red-800' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>{chk?.exists ? <>This item <b>already exists</b> in the list as “{chk.item.name}”. It cannot be added again.</> : <>Use this <b>only</b> for a one-off item that is <b>not</b> in your Excel item list. It will be marked <b>Special</b>.{chk?.similar?.length > 0 && <div className="mt-1">Similar items already in the list: {chk.similar.map((x: any) => x.name).join(', ')}</div>}</>}</div>}
    <div className="grid gap-3 sm:grid-cols-2"><div className="sm:col-span-2"><Field label="Item name"><input className="inp" value={m.name} onChange={up('name')} required maxLength={200} /></Field></div>
      <Field label="Item code (optional)"><input className="inp" value={m.code} onChange={up('code')} /></Field><Field label="Category (optional)"><input className="inp" value={m.category} onChange={up('category')} /></Field>
      <Field label="Supplier"><SupplierSelect value={m.supplierId} onChange={v => setM({ ...m, supplierId: v })} includeAll="Not assigned" /></Field>
      <Field label="Priority"><select className="inp" value={m.priority} onChange={up('priority')}><option value="NORMAL">Normal</option><option value="TOP">Top priority</option></select></Field></div>
    <fieldset className="border border-slate-200 rounded-md p-3 space-y-3"><legend className="px-1 text-sm font-semibold">Stock criteria</legend>
      <Field label="Criteria (target stock)" hint="Quantity you want to hold. Leave empty if not decided yet — the item will show “Criteria not set”."><input className="inp" type="number" min={0} value={m.targetStock} onChange={up('targetStock')} /></Field>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={`border rounded-md p-3 cursor-pointer ${rule === 'PERCENT' ? 'border-brand bg-brand-soft' : 'border-slate-300'}`}><input type="radio" className="mr-2" checked={rule === 'PERCENT'} onChange={() => setRule('PERCENT')} /><b className="text-sm">Target + percentage</b>
          <input className="inp mt-2" type="number" min={0} max={100} placeholder="Blank = default %" disabled={rule !== 'PERCENT'} value={m.reorderPct} onChange={up('reorderPct')} aria-label="Reorder percentage" /><span className="text-xs text-slate-500">Reorder when stock falls below this % of target.</span></label>
        <label className={`border rounded-md p-3 cursor-pointer ${rule === 'LEVEL' ? 'border-brand bg-brand-soft' : 'border-slate-300'}`}><input type="radio" className="mr-2" checked={rule === 'LEVEL'} onChange={() => setRule('LEVEL')} /><b className="text-sm">Target + direct level</b>
          <input className="inp mt-2" type="number" min={0} placeholder="Reorder level" disabled={rule !== 'LEVEL'} value={m.reorderLevel} onChange={up('reorderLevel')} aria-label="Reorder level" /><span className="text-xs text-slate-500">Reorder when stock falls below this quantity.</span></label></div>
      {!isNew && <p className="text-xs text-slate-600">Rule in use now: <b>{RULE_TEXT[item.ruleUsed] || '—'}</b>{item.effectiveReorderLevel != null && <> · reorder level <b>{item.effectiveReorderLevel}</b> ({item.effectiveReorderPct ?? '—'}% of target)</>}</p>}</fieldset>
    {isNew && <Field label="Opening stock (optional)"><input className="inp" type="number" value={m.openingStock} onChange={up('openingStock')} /></Field>}
    <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy}>Save item</button></div></form></Modal>;
}

// ---------------- Stock movement form (used on item page + Stock page) ----------------
export function StockMoveForm({ item, onDone }: { item?: any; onDone: () => void }) {
  const toast = useToast(); const [it, setIt] = useState<any>(item ? { id: item._id, name: item.name } : null); const [type, setType] = useState('ADJUSTMENT'); const [qty, setQty] = useState(''); const [remarks, setRemarks] = useState(''); const [date, setDate] = useState(today()); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function go(e: FormEvent) { e.preventDefault(); if (!it) return setErr('Choose an item'); setBusy(true); setErr('');
    try { const r = await api.post('/stock/transaction', { itemId: it.id, type, quantity: Number(qty), remarks, date }); toast(`Recorded. New stock: ${r.currentStock}`); setQty(''); setRemarks(''); if (!item) setIt(null); onDone(); } catch (x: any) { setErr(x.message); } finally { setBusy(false); } }
  return <form onSubmit={go} className="space-y-3"><ErrorBox msg={err} />{!item && <Field label="Item"><ItemPicker value={it} onPick={setIt} /></Field>}
    <div className="grid gap-3 sm:grid-cols-3"><Field label="Type"><select className="inp" value={type} onChange={e => setType(e.target.value)}><option value="ADJUSTMENT">Adjustment (+ or −)</option><option value="STOCK_OUT">Stock out</option><option value="RETURN">Return (stock back in)</option></select></Field>
      <Field label={type === 'ADJUSTMENT' ? 'Quantity (use − to reduce)' : 'Quantity'}><input className="inp" type="number" step="any" required value={qty} onChange={e => setQty(e.target.value)} /></Field><Field label="Date"><input className="inp" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field></div>
    <Field label={type === 'ADJUSTMENT' ? 'Reason (required)' : 'Remarks'}><input className="inp" value={remarks} onChange={e => setRemarks(e.target.value)} required={type === 'ADJUSTMENT'} maxLength={300} /></Field>
    <button className="btn btn-primary" disabled={busy}>Record movement</button></form>;
}

// ---------------- Item detail ----------------
export function ItemDetail() {
  const { id } = useParams(); const { isAdmin } = useAuth(); const nav = useNavigate();
  const { data, loading, error, reload } = useApi('/items/' + id); const [pp, setPP] = useState(1); const [tp, setTP] = useState(1); const [edit, setEdit] = useState(false); const [adj, setAdj] = useState(false);
  const pur = useApi(`/items/${id}/purchases?limit=10&page=${pp}`); const txn = useApi(`/items/${id}/transactions?limit=20&page=${tp}`);
  if (loading && !data) return <Spinner />; if (error) return <ErrorBox msg={error} />; const i = data.item;
  const Stat = ({ l, v, big }: { l: string; v: any; big?: boolean }) => <div><div className="text-xs text-slate-500">{l}</div><div className={`${big ? 'text-2xl' : 'text-lg'} font-semibold tabular-nums`}>{v}</div></div>;
  return <>
    <PageHeader title={i.name} sub={[i.code, i.category].filter(Boolean).join(' · ') || undefined}><button className="btn" onClick={() => nav(-1)}>Back</button><button className="btn" onClick={() => setAdj(true)}>Record stock movement</button><Link className="btn" to="/entry">Daily entry</Link>{isAdmin && <button className="btn btn-primary" onClick={() => setEdit(true)}>Edit criteria</button>}</PageHeader>
    <div className="card p-4 mb-4"><div className="flex flex-wrap items-center gap-3 mb-4"><StatusBadge status={i.status} /><PriorityBadge p={i.priority} /><span className="text-sm text-slate-600">Supplier: <b>{i.supplierId?.name || 'Not assigned'}</b></span></div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4"><Stat big l="Available" v={fmtNum(i.currentStock)} /><Stat l="Criteria" v={fmtNum(i.targetStock)} /><Stat l="Reorder level" v={fmtNum(i.effectiveReorderLevel)} /><Stat l="Reorder %" v={i.effectiveReorderPct != null ? i.effectiveReorderPct + '%' : '—'} /><Stat big l="Required" v={i.suggestedOrderQty ? fmtNum(i.suggestedOrderQty) : '—'} /><Stat l="Last purchase" v={i.lastPurchaseDate ? `${fmtNum(i.lastPurchaseQty)} on ${fmtDate(i.lastPurchaseDate)}` : '—'} /></div>
      <p className="mt-3 text-sm text-slate-600">Rule in use: <b>{RULE_TEXT[i.ruleUsed]}</b>{i.status === 'NOT_SET' && ' — an admin can set a target stock to start tracking this item.'}</p></div>
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="card overflow-hidden"><div className="px-4 py-3 font-semibold border-b border-slate-200">Purchase history</div>{!pur.data?.rows.length ? <Empty>No purchases recorded.</Empty> : <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Date</th><th>Supplier</th><th className="text-right">Qty</th><th>Invoice</th><th>User</th></tr></thead><tbody>{pur.data.rows.map((p: any) => <tr key={p._id}><td>{fmtDate(p.date)}</td><td>{p.supplierId?.name}</td><td className="text-right tabular-nums">{fmtNum(p.quantity)}</td><td>{p.invoiceNumber || '—'}</td><td>{p.userName}</td></tr>)}</tbody></table></div>}{pur.data && <Pager page={pur.data.page} pages={pur.data.pages} total={pur.data.total} onPage={setPP} />}</div>
      <div className="card overflow-hidden"><div className="px-4 py-3 font-semibold border-b border-slate-200">Stock transaction history</div>{!txn.data?.rows.length ? <Empty>No transactions yet.</Empty> : <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Date</th><th>Type</th><th className="text-right">Change</th><th className="text-right">Balance</th><th>User</th><th>Remarks</th></tr></thead><tbody>{txn.data.rows.map((t: any) => <tr key={t._id}><td>{fmtDate(t.date)}</td><td>{t.type.replace('_', ' ').toLowerCase()}</td><td className={`text-right tabular-nums font-medium ${t.quantity < 0 ? 'text-bad' : 'text-ok'}`}>{t.quantity > 0 ? '+' : ''}{fmtNum(t.quantity)}</td><td className="text-right tabular-nums">{fmtNum(t.balanceAfter)}</td><td>{t.userName}</td><td className="max-w-[16rem] truncate" title={t.remarks}>{t.remarks}</td></tr>)}</tbody></table></div>}{txn.data && <Pager page={txn.data.page} pages={txn.data.pages} total={txn.data.total} onPage={setTP} />}</div></div>
    {edit && <ItemForm item={i} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); reload(); }} />}
    {adj && <Modal title={`Stock movement: ${i.name}`} onClose={() => setAdj(false)} wide><StockMoveForm item={i} onDone={() => { setAdj(false); reload(); txn.reload(); }} /></Modal>}</>;
}
