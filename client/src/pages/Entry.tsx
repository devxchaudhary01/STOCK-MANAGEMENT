import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, download } from '../api';
import { useAuth } from '../App';
import { Empty, ErrorBox, Field, fmtNum, ItemPicker, PageHeader, parseVoice, SupplierSelect, today, useToast, VoiceButton } from '../ui';

type EType = 'SALE' | 'PURCHASE' | 'REJECTION'; type Method = 'manual' | 'excel' | 'photo';
const TYPE_LABEL: Record<EType, string> = { SALE: 'Sale', PURCHASE: 'Purchase / challan', REJECTION: 'Rejection' };
interface Header { date: string; party: string; supplierId: string; docNo: string; docType: 'INVOICE' | 'CHALLAN'; direction: 'IN' | 'OUT' | '' }
const emptyHeader = (): Header => ({ date: today(), party: '', supplierId: '', docNo: '', docType: 'INVOICE', direction: '' });
const headerBody = (t: EType, h: Header) => ({ type: t, date: h.date, party: h.party || undefined, supplierId: h.supplierId || undefined, docNo: h.docNo || undefined, docType: t === 'PURCHASE' ? h.docType : undefined, direction: t === 'REJECTION' ? h.direction || undefined : undefined });
function headerError(t: EType, h: Header) { if (t === 'PURCHASE' && !h.supplierId) return 'Choose the supplier'; if (t === 'REJECTION' && !h.direction) return 'Choose the rejection direction'; return ''; }

export default function Entry() {
  const { isAdmin } = useAuth(); const [type, setType] = useState<EType>('SALE'); const [method, setMethod] = useState<Method>('manual'); const [h, setH] = useState<Header>(emptyHeader()); const [done, setDone] = useState<any>(null);
  const types: EType[] = isAdmin ? ['SALE', 'PURCHASE', 'REJECTION'] : ['SALE']; const up = (k: keyof Header) => (e: any) => setH({ ...h, [k]: e.target.value });
  if (done) return <div className="card p-6 max-w-xl space-y-3"><h2 className="text-lg font-semibold text-ok">{done.created} line(s) saved</h2><ul className="text-sm space-y-1">{done.lines?.slice(0, 15).map((l: any, i: number) => <li key={i}>{l.name}: {fmtNum(l.quantity)} → stock now <b>{fmtNum(l.newStock)}</b></li>)}</ul>
    {done.errors?.length > 0 && <div className="text-sm text-bad"><b>{done.errors.length} line(s) NOT saved:</b><ul className="list-disc pl-5">{done.errors.slice(0, 15).map((e: any, i: number) => <li key={i}>{e.name}: {e.message}</li>)}</ul></div>}
    <div className="flex gap-2"><button className="btn btn-primary" onClick={() => { setDone(null); setH(emptyHeader()); }}>New entry</button>{isAdmin && <Link className="btn" to="/stock">Stock ledger</Link>}</div></div>;
  return <>
    <PageHeader title={isAdmin ? 'Daily entry' : 'Book by Excel / photo'} sub="Sale, purchase / challan and rejection. Only items that exist in the item list can be entered." />
    {types.length > 1 && <div className="flex flex-wrap gap-1.5 mb-3">{types.map(t => <button key={t} onClick={() => { setType(t); setH(emptyHeader()); }} className={`rounded-md px-4 py-2 text-sm font-semibold ${type === t ? 'bg-brand text-white' : 'bg-white border border-slate-300 hover:bg-slate-100'}`}>{TYPE_LABEL[t]}</button>)}</div>}
    <div className="card p-4 mb-3"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Date"><input className="inp" type="date" value={h.date} max={today()} onChange={up('date')} /></Field>
      {type === 'PURCHASE' && <><Field label="Supplier"><SupplierSelect value={h.supplierId} onChange={v => setH({ ...h, supplierId: v })} includeAll="Choose supplier…" /></Field><Field label="Document"><select className="inp" value={h.docType} onChange={up('docType')}><option value="INVOICE">Invoice</option><option value="CHALLAN">Challan</option></select></Field></>}
      {type === 'REJECTION' && <><Field label="Direction"><select className="inp" value={h.direction} onChange={up('direction')}><option value="">Choose…</option><option value="IN">Returned by customer (stock in)</option><option value="OUT">Rejected to supplier (stock out)</option></select></Field>{h.direction === 'OUT' && <Field label="Supplier"><SupplierSelect value={h.supplierId} onChange={v => setH({ ...h, supplierId: v })} includeAll="Choose supplier…" /></Field>}</>}
      {type !== 'PURCHASE' && (type === 'SALE' || h.direction === 'IN') && <Field label="Customer (optional)"><input className="inp" value={h.party} onChange={up('party')} /></Field>}
      <Field label={type === 'PURCHASE' ? (h.docType === 'CHALLAN' ? 'Challan no.' : 'Invoice no.') : 'Document no. (optional)'}><input className="inp" value={h.docNo} onChange={up('docNo')} maxLength={60} /></Field></div></div>
    <div className="flex flex-wrap gap-1.5 mb-3">{([['manual', 'Type or speak'], ['excel', 'From Excel'], ['photo', 'From photo / PDF']] as [Method, string][]).map(([k, l]) => <button key={k} onClick={() => setMethod(k)} className={`rounded-full border px-3.5 py-1.5 text-sm ${method === k ? 'bg-brand-soft border-brand font-semibold text-brand' : 'bg-white border-slate-300 hover:bg-slate-100'}`}>{l}</button>)}</div>
    {method === 'manual' && <Manual type={type} h={h} onDone={setDone} />}{method === 'excel' && <ExcelEntry type={type} h={h} onDone={setDone} />}{method === 'photo' && <PhotoEntry type={type} h={h} onDone={setDone} />}</>;
}

// ---------------- manual / voice ----------------
interface Line { key: number; item: any | null; qty: string }
function Manual({ type, h, onDone }: { type: EType; h: Header; onDone: (d: any) => void }) {
  const toast = useToast(); const [lines, setLines] = useState<Line[]>([{ key: 1, item: null, qty: '' }]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k: number, p: Partial<Line>) => setLines(l => l.map(x => (x.key === k ? { ...x, ...p } : x)));
  async function heard(text: string) {
    const p = parseVoice(text); if (!p.name) return toast('Say the item name, then the quantity', 'err');
    const r = await api.get('/items/lookup?q=' + encodeURIComponent(p.name)); const it = r.items[0];
    if (!it) return toast(`“${p.name}” does not exist in the item list`, 'err');
    setLines(l => [...l.filter(x => x.item || x.qty), { key: Date.now(), item: { id: it._id, name: it.name, ...it }, qty: p.qty ? String(p.qty) : '' }, { key: Date.now() + 1, item: null, qty: '' }]); toast(`Added ${it.name}${p.qty ? ' × ' + p.qty : ''}`);
  }
  async function save() {
    const he = headerError(type, h); const ok = lines.filter(l => l.item && Number(l.qty) > 0); if (he) return setErr(he); if (!ok.length) return setErr('Add at least one item with a quantity');
    setBusy(true); setErr(''); try { onDone(await api.post('/entries/batch', { ...headerBody(type, h), lines: ok.map(l => ({ itemId: l.item.id, quantity: Number(l.qty) })) })); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return <div className="card p-4 space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Items</h2><VoiceButton onHeard={heard} label="Speak an item and quantity" /></div><ErrorBox msg={err} />
    {lines.map(l => <div key={l.key} className="grid grid-cols-[1fr_6.5rem_auto] gap-2 items-start"><ItemPicker value={l.item} onPick={i => set(l.key, { item: i })} />
      <input className="inp" type="number" min={0} step="any" placeholder="Qty" value={l.qty} onChange={e => set(l.key, { qty: e.target.value })} aria-label="Quantity" /><button className="text-bad text-sm underline pt-2" onClick={() => setLines(x => (x.length > 1 ? x.filter(y => y.key !== l.key) : x))}>Remove</button>
      {l.item && type !== 'PURCHASE' && <div className="col-span-3 -mt-1 text-xs text-slate-500">Available: {fmtNum(l.item.currentStock)}</div>}</div>)}
    <div className="flex flex-wrap gap-2"><button className="btn" onClick={() => setLines(l => [...l, { key: Date.now(), item: null, qty: '' }])}>Add line</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : `Save ${TYPE_LABEL[type].toLowerCase()}`}</button></div></div>;
}

// ---------------- Excel ----------------
function ExcelEntry({ type, h, onDone }: { type: EType; h: Header; onDone: (d: any) => void }) {
  const [up, setUp] = useState<any>(null); const [sheet, setSheet] = useState(0); const [headerRow, setHeaderRow] = useState(0); const [map, setMap] = useState<Record<string, number | null>>({}); const [plan, setPlan] = useState<any>(null); const [res, setRes] = useState<Record<number, any>>({}); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const body = (r = res) => ({ sheet, headerRow, mapping: map, resolutions: r, entry: headerBody(type, h) });
  async function upload(f: File) { setBusy(true); setErr(''); try { const fd = new FormData(); fd.append('file', f); fd.append('kind', 'ENTRY'); const d = await api.upload('/import/upload', fd); setUp(d); pick(d, 0); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }
  const pick = (d: any, i: number) => { setSheet(i); setHeaderRow(d.sheets[i].headerRow); setMap(d.sheets[i].suggestedMapping); setPlan(null); setRes({}); };
  async function preview(r = res) { const he = headerError(type, h); if (he) return setErr(he); setBusy(true); setErr(''); try { setPlan((await api.post(`/import/${up.importId}/preview`, body(r))).plan); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }
  const resolve = (row: number, v: any) => { const r = { ...res }; r[row] = v; setRes(r); preview(r); };
  async function commit() { if (!confirm(`Save ${plan.summary.willApply} line(s) as ${TYPE_LABEL[type].toLowerCase()}? Unmatched, duplicate and invalid rows are skipped.`)) return; setBusy(true); setErr(''); try { const d = await api.post(`/import/${up.importId}/commit`, { ...body(), confirm: true }); onDone({ created: d.counts.created, lines: [], errors: d.errors }); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }
  if (!up) return <div className="card p-4 space-y-3 max-w-2xl"><p className="text-sm text-slate-600">Upload an Excel / CSV with <b>item name (or code)</b> and <b>quantity</b>. You will see matched, unmatched, duplicate and invalid rows before anything is saved.</p><ErrorBox msg={err} /><input className="inp" type="file" accept=".xlsx,.xls,.csv" disabled={busy} onChange={e => e.target.files?.[0] && upload(e.target.files[0])} /></div>;
  const sh = up.sheets[sheet]; const cols = (k: string, label: string) => <Field label={label}><select className="inp" value={map[k] ?? ''} onChange={e => { setMap({ ...map, [k]: e.target.value === '' ? null : Number(e.target.value) }); setPlan(null); }}><option value="">— not in file —</option>{sh.header.map((x: string, i: number) => <option key={i} value={i}>{x || `(column ${i + 1})`}</option>)}</select></Field>;
  const s = plan?.summary; const bad = plan?.rows.filter((r: any) => r.bucket !== 'MATCHED' && r.bucket !== 'UNCHANGED') || [];
  return <div className="space-y-3"><div className="card p-4 space-y-3"><div className="flex justify-between"><b>{up.fileName}</b><button className="btn" onClick={() => { setUp(null); setPlan(null); }}>Another file</button></div><ErrorBox msg={err} />
    <div className="grid gap-3 sm:grid-cols-4"><Field label="Sheet"><select className="inp" value={sheet} onChange={e => pick(up, Number(e.target.value))}>{up.sheets.map((x: any, i: number) => <option key={i} value={i}>{x.name}</option>)}</select></Field>{cols('name', 'Item name column')}{cols('code', 'Item code column (optional)')}{cols('currentStock', 'Quantity column')}</div>
    <button className="btn btn-primary" disabled={busy || (map.name == null && map.code == null) || map.currentStock == null} onClick={() => preview()}>Preview</button></div>
    {plan && <><div className="grid grid-cols-2 sm:grid-cols-5 gap-2">{[['Matched', s.matched, 'border-ok'], ['Unmatched', s.unmatched, 'border-bad'], ['Duplicates', s.duplicates, 'border-warn'], ['Invalid', s.invalid, 'border-dead'], ['Will be saved', s.willApply, 'border-brand']].map(([l, n, c]) => <div key={l as string} className={`card p-3 border-l-4 ${c}`}><div className="text-xl font-semibold">{n}</div><div className="text-xs text-slate-600">{l}</div></div>)}</div>
      {bad.length > 0 && <div className="card overflow-hidden"><div className="px-4 py-2 font-semibold border-b border-slate-200">Needs attention (these are not saved unless you fix them)</div><div className="overflow-x-auto max-h-80"><table className="tbl"><thead><tr><th>Row</th><th>In file</th><th className="text-right">Qty</th><th>Problem</th><th>Fix</th></tr></thead><tbody>{bad.slice(0, 100).map((r: any) => <tr key={r.rowNum}><td>{r.rowNum}</td><td>{r.name || r.code}</td><td className="text-right">{r.qty ?? ''}</td><td className="text-xs text-bad">{r.bucket === 'UNMATCHED' ? 'Does not exist in the item list' : r.error}</td>
        <td className="min-w-[14rem]">{r.bucket === 'UNMATCHED' && <div className="space-y-1">{r.suggestions?.length > 0 && <select className="inp !py-1" defaultValue="" onChange={e => e.target.value && resolve(r.rowNum, { action: 'LINK', itemId: e.target.value })}><option value="">Did you mean…</option>{r.suggestions.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}<ItemPicker value={null} onPick={i => i && resolve(r.rowNum, { action: 'LINK', itemId: i.id })} placeholder="Search item…" /></div>}{r.bucket === 'DUPLICATE' && <button className="btn !py-1" onClick={() => resolve(r.rowNum, { action: 'USE' })}>Use this row</button>}</td></tr>)}</tbody></table></div></div>}
      <button className="btn btn-primary" disabled={busy || !s.willApply} onClick={commit}>Confirm and save {s.willApply} line(s)</button></>}</div>;
}

// ---------------- photo / PDF ----------------
interface PLine { key: number; rawName: string; quantity: string; status: string; itemId?: string; itemName?: string; candidates: any[] }
function PhotoEntry({ type, h, onDone }: { type: EType; h: Header; onDone: (d: any) => void }) {
  const [file, setFile] = useState<File | null>(null); const [lines, setLines] = useState<PLine[] | null>(null); const [invoiceId, setInv] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function read() { if (!file) return; setBusy(true); setErr(''); try { const fd = new FormData(); fd.append('file', file); const d = await api.upload('/import/invoice', fd); setInv(d.invoiceId); setErr(d.ocrError || ''); setLines(d.rows.map((r: any, i: number) => ({ key: i, rawName: r.rawName, quantity: r.quantity == null ? '' : String(r.quantity), status: r.status, itemId: r.itemId, itemName: r.itemName, candidates: r.candidates || [] }))); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }
  const upd = (k: number, p: Partial<PLine>) => setLines(l => l!.map(x => (x.key === k ? { ...x, ...p } : x)));
  const link = (k: number, i: any) => upd(k, i ? { itemId: i.id, itemName: i.name, status: 'MATCHED' } : { itemId: undefined, itemName: undefined, status: 'UNMATCHED' });
  const ready = (lines || []).filter(l => l.itemId && Number(l.quantity) > 0); const skipped = (lines?.length || 0) - ready.length;
  async function confirmIt() { const he = headerError(type, h); if (he) return setErr(he); if (!confirm(`Save ${ready.length} line(s)?${skipped ? `\n${skipped} unmatched / empty line(s) will be ignored.` : ''}`)) return; setBusy(true); setErr('');
    try { onDone(await api.post('/entries/batch', { ...headerBody(type, h), invoiceId: type === 'PURCHASE' ? invoiceId : undefined, lines: ready.map(l => ({ itemId: l.itemId, quantity: Number(l.quantity) })) })); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }
  const badge = (s: string) => s === 'MATCHED' ? <span className="rounded bg-ok px-2 py-0.5 text-xs font-semibold text-white">Matched</span> : s === 'SUGGESTED' ? <span className="rounded bg-warn px-2 py-0.5 text-xs font-semibold">Check</span> : <span className="rounded bg-bad px-2 py-0.5 text-xs font-semibold text-white">Not in list</span>;
  if (!lines) return <div className="card p-4 space-y-3 max-w-2xl"><p className="text-sm text-slate-600">Upload a photo or PDF of the order / challan / invoice. Only <b>item name and quantity</b> are read. You review every line before anything is saved.</p><ErrorBox msg={err} /><input className="inp" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" onChange={e => setFile(e.target.files?.[0] || null)} /><button className="btn btn-primary" disabled={!file || busy} onClick={read}>{busy ? 'Reading…' : 'Read the photo'}</button></div>;
  return <div className="space-y-3"><ErrorBox msg={err} />{invoiceId && <button className="btn" onClick={() => download('/import/invoice/' + invoiceId + '/file', 'file', true)}>View uploaded file</button>}
    <div className="card overflow-hidden">{!lines.length ? <Empty>Nothing was read. Add the lines by hand below.</Empty> : null}<div className="overflow-x-auto"><table className="tbl"><thead><tr><th>As read</th><th className="w-28">Qty</th><th>Status</th><th>Item in list</th><th></th></tr></thead><tbody>{lines.map(l => <tr key={l.key}><td><input className="inp" value={l.rawName} onChange={e => upd(l.key, { rawName: e.target.value })} /></td><td><input className="inp" type="number" min={0} step="any" value={l.quantity} onChange={e => upd(l.key, { quantity: e.target.value })} /></td><td>{badge(l.status)}</td>
      <td className="min-w-[15rem]">{l.itemId ? <ItemPicker value={{ id: l.itemId, name: l.itemName! }} onPick={i => link(l.key, i)} /> : <div className="space-y-1">{l.candidates.map((c: any) => <button key={c.id} className="btn !py-0.5 text-xs mr-1" onClick={() => link(l.key, { id: c.id, name: c.name })}>{c.name}</button>)}<ItemPicker value={null} onPick={i => link(l.key, i)} placeholder="Search item…" /></div>}</td><td><button className="text-bad text-xs underline" onClick={() => setLines(x => x!.filter(y => y.key !== l.key))}>Remove</button></td></tr>)}</tbody></table></div>
      <div className="p-3 border-t border-slate-100 flex gap-2"><button className="btn" onClick={() => setLines(l => [...l!, { key: Date.now(), rawName: '', quantity: '', status: 'UNMATCHED', candidates: [] }])}>Add line</button><button className="btn" onClick={() => { setLines(null); setFile(null); }}>Start over</button></div></div>
    <div className="card p-4 flex flex-wrap items-center justify-between gap-3"><div className="text-sm"><b>{ready.length}</b> ready · <b className={skipped ? 'text-bad' : ''}>{skipped}</b> ignored (not in list or no qty)</div><button className="btn btn-primary" disabled={busy || !ready.length} onClick={confirmIt}>Confirm and save</button></div></div>;
}
