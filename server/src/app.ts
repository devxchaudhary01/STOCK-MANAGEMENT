import express, { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import { ZodError } from 'zod';
import mongoose from 'mongoose';
import { config } from './config';
import { HttpError } from './services/stock';
import { authRouter } from './routes/auth';
import { itemsRouter } from './routes/items';
import { suppliersRouter } from './routes/suppliers';
import { stockRouter } from './routes/stock';
import { purchasesRouter } from './routes/purchases';
import { dashboardRouter } from './routes/dashboard';
import { reorderRouter } from './routes/reorder';
import { reportsRouter } from './routes/reports';
import { importRouter } from './routes/import';
import { settingsRouter } from './routes/settings';
import { entriesRouter } from './routes/entries';
import { ordersRouter } from './routes/orders';
import { salesRouter } from './routes/sales';
import { activityRouter } from './routes/activity';
import { recordsRouter } from './routes/records';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);                                   // behind Render/Railway/nginx so rate-limit sees the real IP
  app.use(helmet());
  app.use(cors({ origin: (o, cb) => (!o || config.corsOrigins.includes(o) ? cb(null, true) : cb(new HttpError(403, 'Origin not allowed'))), credentials: false }));
  app.use(express.json({ limit: '1mb' }));
  app.use(mongoSanitize());                                    // strips $ and . operators from input (NoSQL injection)
  if (!config.isTest) app.use(morgan(config.isProd ? 'combined' : 'dev'));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false }));
  app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60_000, limit: config.isTest ? 1000 : 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many login attempts. Try again in 15 minutes.' } }));

  app.get('/api/health', (_q, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1 }));
  app.use('/api/auth', authRouter);
  app.use('/api/items', itemsRouter);
  app.use('/api/suppliers', suppliersRouter);
  app.use('/api/stock', stockRouter);
  app.use('/api/purchases', purchasesRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/reorder', reorderRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/import', importRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/entries', entriesRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/sales', salesRouter);
  app.use('/api/activity', activityRouter);
  app.use('/api/records', recordsRouter);
  app.use('/api', (_q, _r, next) => next(new HttpError(404, 'Not found')));

  if (config.serveClient) {                                    // single-server (VPS) deployment: Express also serves the built React app
    const dist = path.resolve(__dirname, '../../client/dist');
    if (fs.existsSync(dist)) { app.use(express.static(dist)); app.get('*', (_q, res) => res.sendFile(path.join(dist, 'index.html'))); }
  }
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) return void res.status(400).json({ error: err.issues[0]?.message || 'Invalid input', details: err.issues.map(i => ({ path: i.path.join('.'), message: i.message })) });
    if (err?.code === 'LIMIT_FILE_SIZE') return void res.status(413).json({ error: `File too large (max ${config.maxUploadMb} MB)` });
    if (err?.code === 11000) return void res.status(409).json({ error: 'Duplicate record' });
    if (err instanceof mongoose.Error.CastError) return void res.status(400).json({ error: 'Invalid id' });
    const status = err?.status || 500; if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
  });
  return app;
}
