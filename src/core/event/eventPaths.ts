/* 按路径读写实体字段，并对金额与比例做取值域收敛。 */

import type { Market, WorldState } from '../WorldState';
import { marketKeyOf } from '../WorldState';
import type { EventTarget } from './eventTypes';

export const RATIO_PATHS = new Set([
  'legitimacy',
  'conflict',
  'governance',
  'efficiency',
  'stability',
  'morale',
  'leadership.legitimacy',
]);

export const MONEY_PATHS = new Set([
  'cash',
  'assets',
  'liabilities',
  'treasury',
  'debt',
  'wealth',
  'monthlyRevenue',
  'monthlyExpense',
  'payrollMonthly',
]);

export const PATH_CACHE = new Map<string, readonly string[]>();

/** 路径切分结果缓存：事件抽样每月要读上万次特征，避免反复 split。 */
export function pathParts(path: string): readonly string[] {
  let parts = PATH_CACHE.get(path);
  if (!parts) {
    parts = path.split('.');
    PATH_CACHE.set(path, parts);
  }
  return parts;
}

export function targetObject(
  state: WorldState,
  target: EventTarget,
): Record<string, unknown> | null {
  const asRecord = <T>(value: T | undefined): Record<string, unknown> | null =>
    value === undefined ? null : (value as unknown as Record<string, unknown>);
  switch (target.scope) {
    case 'organization':
      return asRecord(state.organizations[target.entityId]);
    case 'country':
      return asRecord(state.countries[target.entityId]);
    case 'region':
      return asRecord(state.regions[target.entityId]);
    case 'character':
      return asRecord(state.characters[target.entityId]);
  }
}

/** 读取数值路径；不存在返回 null。支持  与一级点路径。 */
export function readNumber(state: WorldState, target: EventTarget, path: string): number | null {
  if (path.startsWith('market.')) {
    if (target.scope !== 'region') return null;
    const [, goodId, field] = pathParts(path);
    if (!goodId || !field) return null;
    const market = state.markets[marketKeyOf(target.entityId, goodId)];
    if (!market) return null;
    const value = (market as unknown as Record<string, unknown>)[field];
    return typeof value === 'number' ? value : null;
  }

  const object = targetObject(state, target);
  if (!object) return null;

  const parts = pathParts(path);
  let cursor: unknown = object;
  for (const part of parts) {
    if (cursor === null || typeof cursor !== 'object') return null;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return typeof cursor === 'number' ? cursor : null;
}

export function clampRatio(value: number): number {
  return Math.min(1, Math.max(0, Number(value.toFixed(4))));
}

/** 写入数值路径；非法路径或不可写字段返回 false。 */
export function writeNumber(
  state: WorldState,
  target: EventTarget,
  path: string,
  value: number,
): boolean {
  if (!Number.isFinite(value)) return false;

  if (path.startsWith('market.')) {
    if (target.scope !== 'region') return false;
    const [, goodId, field] = pathParts(path);
    if (!goodId || !field) return false;
    const market = state.markets[marketKeyOf(target.entityId, goodId)];
    if (!market) return false;
    return assignMarketField(market, field, value);
  }

  const object = targetObject(state, target);
  if (!object) return false;

  const parts = pathParts(path);
  let cursor: Record<string, unknown> = object;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index] as string;
    const next = cursor[part];
    if (next === null || typeof next !== 'object') return false;
    cursor = next as Record<string, unknown>;
  }
  const field = parts[parts.length - 1];
  if (!field) return false;
  if (typeof cursor[field] !== 'number') {
    // 技能是稀疏表：允许事件"学会一项新技能"，其余路径仍然严格要求字段已存在。
    if (path.startsWith('skills.') && cursor[field] === undefined) {
      cursor[field] = sanitize(path, value);
      return true;
    }
    return false;
  }

  cursor[field] = sanitize(path, value);
  return true;
}

export function assignMarketField(market: Market, field: string, value: number): boolean {
  if (field === 'price') {
    market.price = Math.round(Math.min(market.ceiling, Math.max(market.floor, value)));
    return true;
  }
  if (field === 'stock' || field === 'demand' || field === 'production') {
    (market as unknown as Record<string, number>)[field] = Math.max(0, Math.round(value));
    return true;
  }
  return false;
}

export function sanitize(path: string, value: number): number {
  if (RATIO_PATHS.has(path) || path.startsWith('policies.')) return clampRatio(value);
  if (MONEY_PATHS.has(path)) return Math.max(0, Math.round(value));
  if (path === 'members' || path === 'military' || path === 'population' || path === 'age') {
    return Math.max(0, Math.round(value));
  }
  if (path === 'scale' || path === 'skills') return Math.max(0, value);
  if (path.startsWith('skills.')) return Math.min(20, Math.max(0, Math.round(value)));
  return value;
}

export function round(value: number): number {
  return Math.round(value * 100) / 100;
}
