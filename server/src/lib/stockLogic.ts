/**
 * SINGLE SOURCE OF TRUTH for stock status rules.
 * Every API, report, dashboard aggregation and import goes through evaluateStock().
 * The result is persisted on the Item document (derived fields) so MongoDB can
 * filter / count / sort on it with indexes instead of recomputing per request.
 */
export type StockStatus = 'GOOD' | 'LOW' | 'ORDER_REQUIRED' | 'OUT_OF_STOCK' | 'NOT_SET';
export type RuleUsed = 'DIRECT_LEVEL' | 'ITEM_PERCENT' | 'DEFAULT_PERCENT' | 'NONE';

export interface StockSettings {
  /** Used when an item has a target but no own % and no direct level. NOT hard-coded in logic. */
  defaultReorderPct: number;
  /** Stock above reorder level but within this % of it is shown YELLOW (LOW). */
  lowBufferPct: number;
  /** What happens when current stock == reorder level exactly. */
  boundaryAtLevel: 'LOW' | 'ORDER';
}
export const DEFAULT_SETTINGS: StockSettings = { defaultReorderPct: 50, lowBufferPct: 10, boundaryAtLevel: 'LOW' };

export interface CriteriaInput {
  currentStock: number;
  targetStock?: number | null;
  reorderLevel?: number | null;
  reorderPct?: number | null;
}
export interface StockEval {
  status: StockStatus;
  ruleUsed: RuleUsed;
  effectiveReorderPct: number | null;
  effectiveReorderLevel: number | null;
  needsOrder: boolean;
  suggestedOrderQty: number;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function evaluateStock(i: CriteriaInput, s: StockSettings = DEFAULT_SETTINGS): StockEval {
  const cur = isNum(i.currentStock) ? i.currentStock : 0;
  const target = isNum(i.targetStock) && i.targetStock > 0 ? i.targetStock : null;

  let level: number | null = null;
  let rule: RuleUsed = 'NONE';
  let pct: number | null = null;

  if (isNum(i.reorderLevel) && i.reorderLevel >= 0) {            // option B: direct level wins
    level = i.reorderLevel; rule = 'DIRECT_LEVEL';
    pct = target ? round2((level / target) * 100) : null;
  } else if (target) {                                           // option A: target + percentage
    const own = isNum(i.reorderPct) && i.reorderPct >= 0 ? i.reorderPct : null;
    pct = own ?? s.defaultReorderPct;
    rule = own !== null ? 'ITEM_PERCENT' : 'DEFAULT_PERCENT';
    level = Math.ceil((target * pct) / 100 - 1e-9);              // 25 * 50% = 12.5 -> 13 (order slightly early, never late)
  }

  // Spec 31: no target and no level => CRITERIA NOT SET (never assume 0, never auto-order)
  if (level === null) {
    return { status: 'NOT_SET', ruleUsed: 'NONE', effectiveReorderPct: null, effectiveReorderLevel: null, needsOrder: false, suggestedOrderQty: 0 };
  }

  let status: StockStatus;
  if (cur <= 0) status = 'OUT_OF_STOCK';
  else if (cur < level) status = 'ORDER_REQUIRED';
  else if (cur === level) status = s.boundaryAtLevel === 'ORDER' ? 'ORDER_REQUIRED' : 'LOW';
  else if (cur <= level * (1 + s.lowBufferPct / 100)) status = 'LOW';
  else status = 'GOOD';

  const needsOrder = status === 'ORDER_REQUIRED' || status === 'OUT_OF_STOCK';
  // Negative stock is treated as 0 for ordering (data error / back-order), so qty never exceeds target.
  const base = Math.max(cur, 0);
  const suggested = !needsOrder ? 0 : Math.max(0, target ? target - base : level - base);
  return { status, ruleUsed: rule, effectiveReorderPct: pct, effectiveReorderLevel: level, needsOrder, suggestedOrderQty: suggested };
}

export const STATUS_LABEL: Record<StockStatus, string> = {
  GOOD: 'Good', LOW: 'Low Stock', ORDER_REQUIRED: 'Order Required', OUT_OF_STOCK: 'Out of Stock', NOT_SET: 'Criteria Not Set',
};
export const ORDER_STATUSES: StockStatus[] = ['ORDER_REQUIRED', 'OUT_OF_STOCK'];
