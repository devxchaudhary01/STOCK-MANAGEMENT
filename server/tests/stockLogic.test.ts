import { describe, it, expect } from 'vitest';
import { evaluateStock, DEFAULT_SETTINGS } from '../src/lib/stockLogic';

const ev = (currentStock: number, extra: any = {}, s = DEFAULT_SETTINGS) => evaluateStock({ currentStock, targetStock: 100, ...extra }, s);
describe('stock status rules (target 100, default 50%)', () => {
  it('1. above reorder level -> GOOD', () => { expect(ev(100).status).toBe('GOOD'); expect(ev(80).status).toBe('GOOD'); expect(ev(60).status).toBe('GOOD'); });
  it('2. exactly at reorder level -> LOW (configurable boundary)', () => {
    expect(ev(50).status).toBe('LOW');
    expect(ev(50, {}, { ...DEFAULT_SETTINGS, boundaryAtLevel: 'ORDER' }).status).toBe('ORDER_REQUIRED');
    expect(ev(52).status).toBe('LOW');
  });
  it('3. below reorder level -> ORDER_REQUIRED with suggested = target - current', () => { const e = ev(49); expect(e.status).toBe('ORDER_REQUIRED'); expect(ev(42).suggestedOrderQty).toBe(58); });
  it('4. zero stock -> OUT_OF_STOCK, suggested = full target', () => { const e = ev(0); expect(e.status).toBe('OUT_OF_STOCK'); expect(e.suggestedOrderQty).toBe(100); });
  it('5. missing target and level -> NOT_SET, never ordered, never assumed zero', () => {
    for (const cur of [0, 5, 500]) { const e = evaluateStock({ currentStock: cur }, DEFAULT_SETTINGS); expect(e.status).toBe('NOT_SET'); expect(e.needsOrder).toBe(false); expect(e.suggestedOrderQty).toBe(0); }
    expect(evaluateStock({ currentStock: 3, targetStock: 0 }).status).toBe('NOT_SET');
  });
  it('6. default 50% reorder calculation', () => { const e = ev(10); expect(e.effectiveReorderLevel).toBe(50); expect(e.ruleUsed).toBe('DEFAULT_PERCENT'); expect(e.effectiveReorderPct).toBe(50); });
  it('7. custom reorder percentage per item', () => { const e = ev(70, { reorderPct: 80 }); expect(e.effectiveReorderLevel).toBe(80); expect(e.ruleUsed).toBe('ITEM_PERCENT'); expect(e.status).toBe('ORDER_REQUIRED'); });
  it('8. custom direct reorder level overrides percent', () => { const e = ev(30, { reorderLevel: 20, reorderPct: 90 }); expect(e.effectiveReorderLevel).toBe(20); expect(e.ruleUsed).toBe('DIRECT_LEVEL'); expect(e.status).toBe('GOOD'); expect(e.effectiveReorderPct).toBe(20); });
  it('direct level without target still works (criteria are set) and never goes negative', () => { const e = evaluateStock({ currentStock: 2, reorderLevel: 5 }); expect(e.status).toBe('ORDER_REQUIRED'); expect(e.suggestedOrderQty).toBe(3); });
  it('rounds odd targets up so ordering is early not late', () => { expect(evaluateStock({ currentStock: 20, targetStock: 25 }).effectiveReorderLevel).toBe(13); });
  it('default percentage is a setting, not hard-coded', () => { expect(ev(30, {}, { ...DEFAULT_SETTINGS, defaultReorderPct: 25 }).effectiveReorderLevel).toBe(25); });
  it('negative stock behaves as out of stock and suggestion never exceeds target', () => { const e = ev(-14); expect(e.status).toBe('OUT_OF_STOCK'); expect(e.suggestedOrderQty).toBe(100); });
  it('example from the brief: BTJNL 2525 M15 target 30, 50%, stock 12', () => { const e = evaluateStock({ currentStock: 12, targetStock: 30 }); expect(e.effectiveReorderLevel).toBe(15); expect(e.status).toBe('ORDER_REQUIRED'); expect(e.suggestedOrderQty).toBe(18); });
});
