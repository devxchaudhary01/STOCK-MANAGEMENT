import { Router } from 'express';
import { z } from 'zod';
import { asyncH, parse } from '../lib/http';
import { authRequired, requireRole } from '../middleware/auth';
import { getSettings, saveSettings } from '../services/settings';
import { recomputeAll } from '../services/stock';

export const settingsRouter = Router();
settingsRouter.use(authRequired);
settingsRouter.get('/', asyncH(async (_q, res) => res.json(await getSettings())));
/** Changing a rule re-derives every item's status (batched) so reports/dashboards stay consistent. */
settingsRouter.put('/', requireRole('ADMIN'), asyncH(async (req, res) => {
  const b = parse(z.object({ defaultReorderPct: z.number().min(0).max(100).optional(), lowBufferPct: z.number().min(0).max(100).optional(), boundaryAtLevel: z.enum(['LOW', 'ORDER']).optional() }), req.body);
  const s = await saveSettings(b); const n = await recomputeAll(s); res.json({ settings: s, itemsRecalculated: n });
}));
