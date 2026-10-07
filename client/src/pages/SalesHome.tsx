import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Beacon, ErrorBox, fmtDate, fmtNum, PageHeader, StatusBadge, say, parseVoice, useApi, useDebounced, useToast, VoiceButton } from '../ui';
import { Lang } from '../voice';

interface Hit { _id: string; name: string; code?: string; available: number; status: string; pendingOrderQty: number; expectedDate: string | null; incoming: { qty: number; expectedDate: string | null }[] }
const dateWords = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' }) : '');

/** Sales panel: look up an item (typed or spoken), see available + pending order + expected date, book the quantity. */
export default function SalesHome() {
  const toast = useToast(); const [q, setQ] = useState(''); const dq = useDebounced(q, 250); const [hits, setHits] = useState<Hit[]>([]); const [cur, setCur] = useState<Hit | null>(null);
  const [qty, setQty] = useState(''); const [customer, setCustomer] = useState(() => localStorage.getItem('ssct_customer') || ''); const [lang, setLang] = useState<Lang>('en-IN'); const [heard, setHeard] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [searched, setSearched] = useState(false);
  const today = useApi('/entries?preset=today&limit=100'); const curRef = useRef<Hit | null>(null); curRef.current = cur;

  const search = useCallback(async (text: string): Promise<Hit[]> => { const d = await api.get('/sales/search?q=' + encodeURIComponent(text)); setHits(d.items); setSearched(true); return d.items; }, []);
  useEffect(() => { if (dq.trim().length >= 2) search(dq).catch(e => setErr(e.message)); else { setHits([]); setSearched(false); } }, [dq, search]);

  const describe = (h: Hit) => `${h.name}. Available ${h.available}. ` + (h.pendingOrderQty ? `Pending in order ${h.pendingOrderQty}, expected by ${dateWords(h.expectedDate) || 'date not set'}.` : 'Nothing pending in order.');
  const pick = (h: Hit, speakIt = false) => { setCur(h); setQty(''); setErr(''); if (speakIt) say(describe(h), lang); };

  async function book(h: Hit, n: number, speakIt = false) {
    if (!(n > 0)) return setErr('Enter a quantity to book'); setBusy(true); setErr('');
    try {
      const r = await api.post('/entries/batch', { type: 'SALE', party: customer || undefined, lines: [{ itemId: h._id, quantity: n }] }); const nl = r.lines[0];
      const msg = `Booked ${n} of ${h.name}. ${nl.newStock} left.`; toast(msg); if (speakIt) say(`Booked ${n}. ${nl.newStock} left.`, lang);
      setCur({ ...h, available: nl.newStock, status: nl.status }); setQty(''); setHits(x => x.map(y => (y._id === h._id ? { ...y, available: nl.newStock, status: nl.status } : y))); today.reload();
    } catch (e: any) { setErr(e.message); if (speakIt) say(e.message, lang); } finally { setBusy(false); }
  }
  async function onHeard(text: string) {
    setHeard(text); setErr(''); const p = parseVoice(text); let h = curRef.current;
    if (p.name) {
      const found = await search(p.name);
      if (!found.length) { setCur(null); say('This item does not exist in the list.', lang); setErr(`"${p.name}" does not exist in the item list`); return; }
      const exact = found.find(x => x.name.toLowerCase().replace(/\s+/g, '') === p.name.replace(/\s+/g, ''));
      if (found.length === 1 || exact) { h = exact || found[0]; pick(h, !(p.qty && p.book)); } else { setCur(null); say(`I found ${found.length} items. Please tap the right one.`, lang); return; }
    }
    if (p.qty && h && (p.book || !p.name)) { if (p.book || !p.name) await book(h, p.qty, true); }
    else if (p.qty && h) { setQty(String(p.qty)); }
    else if (p.book && !h) say('Tell me the item first.', lang);
  }
  const myToday = today.data?.rows?.filter((r: any) => !r.cancelled) || [];
  async function cancel(id: string) { if (!confirm('Cancel this booking? Stock will be added back.')) return; try { await api.post(`/entries/${id}/cancel`); toast('Booking cancelled'); today.reload(); if (cur) search(cur.name).then(h => { const n = h.find(x => x._id === cur._id); if (n) setCur(n); }); } catch (e: any) { toast(e.message, 'err'); } }

  return <>
    <PageHeader title="Stock & book" sub="Search or speak an item. Check what is available and when more is coming, then book." />
    <div className="card p-3 sm:p-4 space-y-3 mb-4">
      <div className="flex flex-wrap gap-2 items-center">
        <input className="inp !text-base !py-2.5 flex-1 min-w-[12rem]" placeholder="Type item name, e.g. BTJNL 2525 M15" value={q} onChange={e => { setQ(e.target.value); setCur(null); }} aria-label="Search item" autoFocus />
        <VoiceButton lang={lang} onHeard={onHeard} label="Speak" />
        <select className="inp !w-auto" value={lang} onChange={e => setLang(e.target.value as Lang)} aria-label="Voice language"><option value="en-IN">English</option><option value="hi-IN">हिन्दी</option></select></div>
      {heard && <p className="text-sm text-slate-600">I heard: <b>“{heard}”</b></p>}
      <p className="text-xs text-slate-500">Say the item name, then “15 piece book” or “book 15”. Model codes can be misheard, so check the item shown before booking.</p><ErrorBox msg={err} /></div>

    {cur && <div className="card p-4 mb-4 border-2 border-brand">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="text-lg font-semibold">{cur.name}</h2><div className="mt-1"><StatusBadge status={cur.status} /></div></div><button className="btn" onClick={() => say(describe(cur), lang)}>🔊 Read out</button></div>
      <div className="grid grid-cols-2 gap-3 my-4"><div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">Available now</div><div className="text-3xl font-bold tabular-nums">{fmtNum(cur.available)}</div></div>
        <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">Pending in order</div><div className="text-3xl font-bold tabular-nums">{fmtNum(cur.pendingOrderQty)}</div>{cur.pendingOrderQty > 0 && <div className="text-sm text-slate-600 mt-1">Expected by <b>{fmtDate(cur.expectedDate)}</b></div>}</div></div>
      {cur.incoming.length > 1 && <ul className="text-sm text-slate-600 mb-3 list-disc pl-5">{cur.incoming.map((x, i) => <li key={i}>{fmtNum(x.qty)} by {fmtDate(x.expectedDate)}</li>)}</ul>}
      <div className="flex flex-wrap gap-2 items-end"><label className="text-sm"><span className="block mb-1 font-medium">Quantity to book</span><input className="inp !w-32 !text-lg" type="number" inputMode="numeric" min={1} value={qty} onChange={e => setQty(e.target.value)} onKeyDown={e => e.key === 'Enter' && book(cur, Number(qty))} /></label>
        <label className="text-sm flex-1 min-w-[10rem]"><span className="block mb-1 font-medium">Customer (optional)</span><input className="inp" value={customer} onChange={e => { setCustomer(e.target.value); localStorage.setItem('ssct_customer', e.target.value); }} /></label>
        <button className="btn btn-primary !py-2.5 !px-6 !text-base" disabled={busy || !qty} onClick={() => book(cur, Number(qty))}>Book</button></div></div>}

    {!cur && searched && (hits.length ? <div className="grid gap-2 mb-4">{hits.map(h => <button key={h._id} onClick={() => pick(h, true)} className="card p-3 text-left hover:bg-brand-soft flex items-center justify-between gap-3"><div className="min-w-0"><div className="font-medium truncate">{h.name}</div><div className="text-sm text-slate-600">Available <b>{fmtNum(h.available)}</b>{h.pendingOrderQty > 0 && <> · On order {fmtNum(h.pendingOrderQty)} by {fmtDate(h.expectedDate)}</>}</div></div><StatusBadge status={h.status} /></button>)}</div>
      : <div className="card p-4 mb-4 text-bad font-medium flex items-center gap-2"><Beacon kind="order" />Does not exist in the item list</div>)}

    <div className="card overflow-hidden"><div className="px-4 py-3 font-semibold border-b border-slate-200">My bookings today <span className="font-normal text-slate-500">({myToday.length})</span></div>
      {!myToday.length ? <div className="py-8 text-center text-sm text-slate-500">No bookings yet today.</div> : <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Item</th><th className="text-right">Qty</th><th>Customer</th><th></th></tr></thead><tbody>{myToday.map((r: any) => <tr key={r._id}><td className="font-medium">{r.itemId?.name}</td><td className="text-right tabular-nums">{fmtNum(Math.abs(r.quantity))}</td><td>{r.party || '—'}</td><td><button className="text-bad text-xs underline" onClick={() => cancel(r._id)}>Cancel</button></td></tr>)}</tbody></table></div>}</div></>;
}
