import { Setting } from '../models';
import { DEFAULT_SETTINGS, StockSettings } from '../lib/stockLogic';

let cache: { v: StockSettings; t: number } | null = null;
export async function getSettings(): Promise<StockSettings> {
  if (cache && Date.now() - cache.t < 10_000) return cache.v;
  const doc = await Setting.findOne({ key: 'stock' }).lean();
  const v = { ...DEFAULT_SETTINGS, ...((doc?.value as object) || {}) } as StockSettings;
  cache = { v, t: Date.now() }; return v;
}
export async function saveSettings(patch: Partial<StockSettings>): Promise<StockSettings> {
  const v = { ...(await getSettings()), ...patch };
  await Setting.updateOne({ key: 'stock' }, { $set: { value: v } }, { upsert: true });
  cache = { v, t: Date.now() }; return v;
}
export const clearSettingsCache = () => { cache = null; };
