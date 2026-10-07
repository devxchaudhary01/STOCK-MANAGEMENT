import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { User } from '../models';
import { asyncH, parse, paging, escapeRegex } from '../lib/http';
import { authRequired, requireRole, signToken, invalidateUser } from '../middleware/auth';
import { HttpError } from '../services/stock';
import { config } from '../config';

export const authRouter = Router();
const DUMMY = bcrypt.hashSync('not-a-real-password', 10);

authRouter.post('/login', asyncH(async (req, res) => {
  const { username, password } = parse(z.object({ username: z.string().min(1).max(60), password: z.string().min(1).max(200) }), req.body);
  const u = await User.findOne({ username: username.toLowerCase().trim() }).select('+passwordHash');
  const ok = await bcrypt.compare(password, u?.passwordHash || DUMMY);       // constant-ish time whether or not the user exists
  if (!u || !ok || !u.active) throw new HttpError(401, 'Invalid username or password');
  const user = { id: String(u._id), username: u.username, name: u.name, role: u.role as 'ADMIN' | 'SALES' };
  await User.updateOne({ _id: u._id }, { $set: { lastLoginAt: new Date() } });
  res.json({ token: signToken(user), user });
}));
authRouter.get('/config', (_q, res) => res.json({ authRequired: config.authRequired }));
authRouter.get('/me', authRequired, (req, res) => res.json({ user: req.user }));
authRouter.post('/change-password', authRequired, asyncH(async (req, res) => {
  const { current, next } = parse(z.object({ current: z.string(), next: z.string().min(8).max(200) }), req.body);
  const u = await User.findById(req.user!.id).select('+passwordHash'); if (!u || !(await bcrypt.compare(current, u.passwordHash))) throw new HttpError(400, 'Current password is incorrect');
  u.passwordHash = await bcrypt.hash(next, 12); await u.save(); res.json({ ok: true });
}));
// ---- user management (ADMIN panel): list, add, edit, block ----
authRouter.get('/users', authRequired, requireRole('ADMIN'), asyncH(async (req, res) => {
  const { limit, page, skip } = paging(req.query, 100); const f: any = {};
  const q = String(req.query.q || '').trim(); if (q) f.$or = [{ name: new RegExp(escapeRegex(q), 'i') }, { username: new RegExp(escapeRegex(q), 'i') }];
  if (req.query.role === 'ADMIN' || req.query.role === 'SALES') f.role = req.query.role;
  if (req.query.active === 'true' || req.query.active === 'false') f.active = req.query.active === 'true';
  const [users, total] = await Promise.all([User.find(f, 'username name role active lastLoginAt createdAt').sort({ name: 1 }).skip(skip).limit(limit).lean(), User.countDocuments(f)]);
  res.json({ users, total, page, pages: Math.ceil(total / limit) });
}));
const uname = z.string().min(3).max(40).regex(/^[a-z0-9._-]+$/i, 'Username: letters, numbers, . _ - only');
authRouter.post('/users', authRequired, requireRole('ADMIN'), asyncH(async (req, res) => {
  const b = parse(z.object({ username: uname, name: z.string().min(1).max(80), password: z.string().min(8).max(200), role: z.enum(['ADMIN', 'SALES']).default('SALES') }), req.body);
  if (await User.exists({ username: b.username.toLowerCase() })) throw new HttpError(409, 'Username already exists');
  const u = await User.create({ username: b.username, name: b.name, role: b.role, passwordHash: await bcrypt.hash(b.password, 12) });
  res.status(201).json({ id: u.id });
}));
authRouter.put('/users/:id', authRequired, requireRole('ADMIN'), asyncH(async (req, res) => {
  const b = parse(z.object({ name: z.string().min(1).max(80).optional(), username: uname.optional(), role: z.enum(['ADMIN', 'SALES']).optional(), active: z.boolean().optional(), password: z.string().min(8).max(200).optional() }), req.body);
  if (req.params.id === req.user!.id && (b.active === false || b.role === 'SALES')) throw new HttpError(400, 'You cannot block or demote yourself');
  if (b.username && await User.exists({ username: b.username.toLowerCase(), _id: { $ne: req.params.id } })) throw new HttpError(409, 'Username already exists');
  const set: any = { ...b }; delete set.password; if (b.username) set.username = b.username.toLowerCase(); if (b.password) set.passwordHash = await bcrypt.hash(b.password, 12);
  await User.updateOne({ _id: req.params.id }, { $set: set }); invalidateUser(String(req.params.id)); res.json({ ok: true });
}));
