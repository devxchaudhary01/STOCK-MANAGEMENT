import { FormEvent, useState } from 'react';
import { api, setToken } from '../api';
import { ErrorBox } from '../ui';

export default function Login({ onLogin }: { onLogin: (u: any) => void }) {
  const [username, setU] = useState(''); const [password, setP] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); setErr(''); try { const d = await api.post('/auth/login', { username, password }); setToken(d.token); onLogin(d.user); } catch (x: any) { setErr(x.message); } finally { setBusy(false); } }
  return <div className="min-h-screen grid place-items-center p-4"><form onSubmit={submit} className="card w-full max-w-sm p-6 space-y-4">
    <div><h1 className="text-xl font-semibold text-brand">SS Cutting Tools India</h1><p className="text-sm text-slate-500">Stock management. Please log in.</p></div>
    <ErrorBox msg={err} />
    <label className="block text-sm"><span className="block mb-1 font-medium">Username</span><input className="inp" autoFocus autoComplete="username" value={username} onChange={e => setU(e.target.value)} required /></label>
    <label className="block text-sm"><span className="block mb-1 font-medium">Password</span><input className="inp" type="password" autoComplete="current-password" value={password} onChange={e => setP(e.target.value)} required /></label>
    <button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button></form></div>;
}
