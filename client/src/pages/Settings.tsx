import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../App';
import { ErrorBox, Field, PageHeader, useApi, useToast } from '../ui';

export default function Settings() {
  const { isAdmin, user, authRequired } = useAuth(); const toast = useToast(); const s = useApi('/settings'); const [m, setM] = useState<any>(null); const [err, setErr] = useState(''); const [pw, setPw] = useState({ current: '', next: '' }); const [pwErr, setPwErr] = useState(''); const [drift, setDrift] = useState<any>(null);
  const cur = m || s.data;
  async function save(e: FormEvent) { e.preventDefault(); setErr(''); try { const r = await api.put('/settings', { defaultReorderPct: Number(cur.defaultReorderPct), lowBufferPct: Number(cur.lowBufferPct), boundaryAtLevel: cur.boundaryAtLevel }); toast(`Saved. ${r.itemsRecalculated} items recalculated.`); setM(null); s.reload(); } catch (x: any) { setErr(x.message); } }
  async function changePw(e: FormEvent) { e.preventDefault(); setPwErr(''); try { await api.post('/auth/change-password', pw); toast('Password changed'); setPw({ current: '', next: '' }); } catch (x: any) { setPwErr(x.message); } }
  const check = async (fix: boolean) => { try { const r = await api.post('/stock/reconcile' + (fix ? '?fix=true' : '')); setDrift(r); if (fix) toast('Stock repaired from the ledger'); } catch (x: any) { toast(x.message, 'err'); } };
  return <><PageHeader title="Settings" />
    <div className="grid gap-4 xl:grid-cols-2">
      {isAdmin && cur && <form onSubmit={save} className="card p-4 space-y-3"><h2 className="font-semibold">Stock rules</h2><ErrorBox msg={err} />
        <Field label="Default reorder percentage" hint="Used for every item that has a target stock but no percentage or level of its own. Individual items can override it."><input className="inp" type="number" min={0} max={100} value={cur.defaultReorderPct} onChange={e => setM({ ...cur, defaultReorderPct: e.target.value })} /></Field>
        <Field label="When stock is exactly at the reorder level"><select className="inp" value={cur.boundaryAtLevel} onChange={e => setM({ ...cur, boundaryAtLevel: e.target.value })}><option value="LOW">Show as Low stock (yellow)</option><option value="ORDER">Show as Order required (red)</option></select></Field>
        <Field label="Low-stock warning band (%)" hint="Stock within this % above the reorder level is shown as Low stock (yellow). Example: level 50 and band 10% → 50 to 55 is yellow."><input className="inp" type="number" min={0} max={100} value={cur.lowBufferPct} onChange={e => setM({ ...cur, lowBufferPct: e.target.value })} /></Field>
        <p className="text-xs text-slate-500">Saving recalculates the status of every item.</p><button className="btn btn-primary" disabled={!m}>Save rules</button></form>}
      <div className="space-y-4">
        {authRequired && <form onSubmit={changePw} className="card p-4 space-y-3"><h2 className="font-semibold">Change my password</h2><ErrorBox msg={pwErr} /><Field label="Current password"><input className="inp" type="password" autoComplete="current-password" value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} required /></Field><Field label="New password (min. 8 characters)"><input className="inp" type="password" autoComplete="new-password" minLength={8} value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} required /></Field><button className="btn btn-primary">Change password</button></form>}
        {isAdmin && <div className="card p-4 space-y-2"><h2 className="font-semibold">Data checks</h2><p className="text-sm text-slate-600">Compares each item's stock with the sum of its transactions.</p><div className="flex gap-2"><button className="btn" onClick={() => check(false)}>Run check</button>{drift?.drift.length > 0 && <button className="btn btn-danger" onClick={() => confirm('Rewrite stock of the listed items from the ledger?') && check(true)}>Repair from ledger</button>}</div>
          {drift && (drift.drift.length ? <ul className="text-sm text-bad list-disc pl-5">{drift.drift.slice(0, 20).map((d: any) => <li key={d.itemId}>{d.name}: stored {d.stored}, ledger {d.ledger}</li>)}</ul> : <p className="text-sm text-ok">All good — {drift.checked} items checked, no differences.</p>)}</div>}
        {isAdmin && <div className="card p-4 text-sm">Suppliers are managed on the <Link className="underline text-brand" to="/suppliers">Suppliers</Link> page.</div>}</div></div>
  </>;
}
