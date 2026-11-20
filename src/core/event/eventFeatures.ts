/* 历史特征读取：按实体统计窗口内的事件次数。 */

import type { WorldState } from '../WorldState';
import { readNumber } from './eventPaths';
import { HISTORY_WINDOW_DAYS } from './eventTypes';
import type { EventTarget, FeatureCache } from './eventTypes';

export function createFeatureCache(state: WorldState): FeatureCache {
  const price = new Map<string, number>();
  for (const market of Object.values(state.markets)) {
    const ratio = market.price / Math.max(1, market.floor);
    const value = Math.min(1, Math.max(0, ratio - 1));
    const prev = price.get(market.regionId) ?? 0;
    if (value > prev) price.set(market.regionId, value);
  }
  return { day: state.clock.day, price, history: new Map() };
}

export function historyCount(
  state: WorldState,
  cache: FeatureCache,
  eventId: string,
): Map<string, number> {
  const cached = cache.history.get(eventId);
  if (cached) return cached;
  const counts = new Map<string, number>();
  const since = cache.day - HISTORY_WINDOW_DAYS;
  for (const record of state.history) {
    if (record.day <= since || record.causeEventId !== eventId) continue;
    for (const ref of record.refs) counts.set(ref.id, (counts.get(ref.id) ?? 0) + 1);
  }
  cache.history.set(eventId, counts);
  return counts;
}

/** 风险项使用的归一化特征（0–1 或小数值），避免量纲差异。 */
export function readFeature(
  state: WorldState,
  target: EventTarget,
  path: string,
  cache?: FeatureCache,
): number {
  // 历史窗口特征：history.<eventId> = 目标实体近一年内经历该事件的次数。
  if (path.startsWith('history.')) {
    const eventId = path.slice('history.'.length);
    if (cache) return historyCount(state, cache, eventId).get(target.entityId) ?? 0;
    const since = state.clock.day - HISTORY_WINDOW_DAYS;
    return state.history.filter(
      (record) =>
        record.causeEventId === eventId &&
        record.day > since &&
        record.refs.some((ref) => ref.id === target.entityId),
    ).length;
  }

  switch (path) {
    case 'cashRatio': {
      const cash = readNumber(state, target, 'cash') ?? 0;
      const liabilities = readNumber(state, target, 'liabilities') ?? 0;
      return Math.min(1, cash / (liabilities + cash + 1));
    }
    case 'debtRatio': {
      // 国家没有 liabilities/assets，用"债务占财政总量"的同一语义。
      if (target.scope === 'country') {
        const debt = readNumber(state, target, 'debt') ?? 0;
        const treasury = readNumber(state, target, 'treasury') ?? 0;
        return Math.min(1, debt / (treasury + debt + 1));
      }
      const liabilities = readNumber(state, target, 'liabilities') ?? 0;
      const assets = readNumber(state, target, 'assets') ?? 0;
      return Math.min(1, liabilities / (assets + 1));
    }
    case 'treasuryRatio': {
      // 国家流动性：国库可覆盖多少个月的开支（<1 表示不足一年）。
      if (target.scope !== 'country') return 0;
      const treasury = readNumber(state, target, 'treasury') ?? 0;
      const expense = readNumber(state, target, 'monthlyExpense') ?? 0;
      return Math.min(1, treasury / Math.max(1, expense * 12));
    }
    case 'priceRatio': {
      if (target.scope !== 'region') return 0;
      if (cache) return cache.price.get(target.entityId) ?? 0;
      let worst = 0;
      for (const market of Object.values(state.markets)) {
        if (market.regionId !== target.entityId) continue;
        const ratio = market.price / Math.max(1, market.floor);
        worst = Math.max(worst, Math.min(1, Math.max(0, ratio - 1)));
      }
      return worst;
    }
    default:
      return readNumber(state, target, path) ?? 0;
  }
}

/* ------------------------------------------------------------------ */
/* 条件表达式                                                           */
/* ------------------------------------------------------------------ */
