import { FormEvent, useState } from 'react';
import { api } from '../api';
import { Empty, ErrorBox, Field, fmtDate, Modal, PageHeader, Pager, Spinner, useApi, useDebounced, useToast } from '../ui';

/** Admin panel: every user, edit, block / unblock. Server-side paging + search, so it stays fast with thousands of users. */
export default function Users() {
  const toast = useToast(); const [q, setQ] = useState(''); const dq = useDebounced(q); const [role, setRole] = useState(''); const [active, setActive] = useState(''); const [page, setPage] = useState(1); const [edit, setEdit] = useState<any>(null);
  const qs = new URLSearchParams({ page: String(page), limit: '25', ...(dq && { q: dq }), ...(role && { role }), ...(active && { active }) }).toString();
  const { data, loading, error, reload } = useApi('/auth/users?' + qs);
  const toggle = async (u: any) => { if (u.active && !confirm(`Block ${u.name}? They will be logged out immediately.`)) return; try { await api.put('/auth/users/' + u._id, { active: !u.active }); toast(u.active ? 'User blocked' : 'User unblocked'); reload(); } catch (e: any) { toast(e.message, 'err'); } };
  return <><PageHeader title="Users" sub="Admin and Sales users. Edit details, reset password, block or unblock."><button className="btn btn-primary" onClick={() => setEdit({})}>Add user</button></PageHeader>
    <div className="card p-3 mb-3 flex flex-wrap gap-2"><input className="inp !w-64" placeholder="Search name or username…" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} /><select className="inp !w-auto" value={role} onChange={e => { setRole(e.target.value); setPage(1); }}><option value="">All roles</option><option value="ADMIN">Admin</option><option value="SALES">Sales</option></select><select className="inp !w-auto" value={active} onChange={e => { setActive(e.target.value); setPage(1); }}><option value="">Active and blocked</option><option value="true">Active only</option><option value="false">Blocked only</option></select></div>
    <ErrorBox msg={error} /><div className="card overflow-hidden">{loading && !data ? <Spinner /> : !data?.users.length ? <Empty>No users found.</Empty> : <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Name</th><th>Username</th><th>Panel</th><th>Last login</th><th>Status</th><th></th></tr></thead>
      <tbody>{data.users.map((u: any) => <tr key={u._id} className={u.active ? '' : 'opacity-60'}><td className="font-medium">{u.name}</td><td>{u.username}</td><td>{u.role === 'ADMIN' ? 'Admin' : 'Sales'}</td><td>{fmtDate(u.lastLoginAt)}</td><td>{u.active ? <span className="text-ok font-medium">Active</span> : <span className="text-bad font-medium">Blocked</span>}</td>
        <td className="whitespace-nowrap text-right"><button className="btn !py-1 mr-1" onClick={() => setEdit(u)}>Edit</button><button className={`btn !py-1 ${u.active ? '' : 'btn-primary'}`} onClick={() => toggle(u)}>{u.active ? 'Block' : 'Unblock'}</button></td></tr>)}</tbody></table></div>}
      {data && <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}</div>
    {edit && <UserForm u={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}</>;
}
function UserForm({ u, onClose, onSaved }: { u: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast(); const isNew = !u._id; const [m, setM] = useState({ name: u.name || '', username: u.username || '', role: u.role || 'SALES', password: '' }); const [err, setErr] = useState('');
  async function save(e: FormEvent) { e.preventDefault(); setErr(''); try { if (isNew) await api.post('/auth/users', m); else { const b: any = { name: m.name, username: m.username, role: m.role }; if (m.password) b.password = m.password; await api.put('/auth/users/' + u._id, b); } toast('User saved'); onSaved(); } catch (x: any) { setErr(x.message); } }
  const set = (k: string) => (e: any) => setM({ ...m, [k]: e.target.value });
  return <Modal title={isNew ? 'Add user' : `Edit ${u.name}`} onClose={onClose}><form onSubmit={save} className="space-y-3"><ErrorBox msg={err} /><Field label="Full name"><input className="inp" required value={m.name} onChange={set('name')} /></Field><Field label="Username"><input className="inp" required value={m.username} onChange={set('username')} /></Field>
    <Field label="Panel"><select className="inp" value={m.role} onChange={set('role')}><option value="SALES">Sales panel</option><option value="ADMIN">Admin panel</option></select></Field>
    <Field label={isNew ? 'Password (min. 8)' : 'New password (leave empty to keep)'}><input className="inp" type="password" minLength={8} required={isNew} autoComplete="new-password" value={m.password} onChange={set('password')} /></Field><div className="flex justify-end gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary">Save</button></div></form></Modal>;
}
