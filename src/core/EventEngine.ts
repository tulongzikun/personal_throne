/**
 * 概率事件引擎：条件编译 → 风险强度 → 互斥竞速 → 效果结算。
 *
 * 模型（GDD §11 / 计划 §7.2）：
 *   λ(entity, event) = λ₀ · exp(Σ βᵢ·Xᵢ)
 *   P(Δt)            = 1 − e^(−λ·Δt)
 * 同一实体的同一互斥组（`exclusivity`）内用**指数竞速**只选一个赢家：
 *   tᵢ ~ Exp(λᵢ)，min(tᵢ) 对应的事件发生。
 * 这样两组事件不会在同一次抽样里同时发生，同时每个事件边际概率仍等于 1−e^(−λᵢΔt)。
 *
 * 随机数全部走命名流：`event:<entityId>:<periodKey>:<eventId>`，与遍历顺序无关。
 */

import type { Random } from './Random';
import type {
  CondExpr,
  Effect,
  EntityId,
  EventDef,
  Expr,
  Market,
  WorldContent,
  WorldState,
} from './WorldState';
import { marketKeyOf, sortedIds } from './WorldState';

/** 默认抽样窗口（天）：月度抽样点，与 `balance.events.samplingDays` 对应。 */
export const EVENT_WINDOW_DAYS = 30;

/**
 * 事件触发概率。
 * `lambda0` 在内容里按**月率**书写（计划 §7.2），因此 30 天窗口下 P = 1 − e^(−λ)；
 * 窗口天数来自 balance，便于以后改成周/季抽样。
 */
function triggerProbability(lambda: number, samplingDays: number): number {
  return 1 - Math.exp(-lambda * (samplingDays / EVENT_WINDOW_DAYS));
}

export type EventScope = EventDef['scope'];

export interface EventTarget {
  readonly scope: EventScope;
  readonly entityId: EntityId;
}

export interface Candidate {
  readonly def: EventDef;
  readonly target: EventTarget;
  readonly lambda: number;
  /** 竞速分组键；无 exclusivity 时为 null，单独判定。 */
  readonly group: string | null;
}

export interface Triggered {
  readonly def: EventDef;
  readonly target: EventTarget;
}

export interface Outcome {
  readonly def: EventDef;
  readonly target: EventTarget;
  readonly summary: string;
  readonly changes: readonly string[];
}

/* ------------------------------------------------------------------ */
/* 路径解析                                                             */
/* ------------------------------------------------------------------ */

const RATIO_PATHS = new Set([
  'legitimacy',
  'conflict',
  'governance',
  'efficiency',
  'stability',
  'morale',
  'leadership.legitimacy',
]);

const MONEY_PATHS = new Set([
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

function targetObject(state: WorldState, target: EventTarget): Record<string, unknown> | null {
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

/** 读取数值路径；不存在返回 null。支持 `market.<goodId>.<field>` 与一级点路径。 */
export function readNumber(state: WorldState, target: EventTarget, path: string): number | null {
  if (path.startsWith('market.')) {
    if (target.scope !== 'region') return null;
    const [, goodId, field] = path.split('.');
    if (!goodId || !field) return null;
    const market = state.markets[marketKeyOf(target.entityId, goodId)];
    if (!market) return null;
    const value = (market as unknown as Record<string, unknown>)[field];
    return typeof value === 'number' ? value : null;
  }

  const object = targetObject(state, target);
  if (!object) return null;

  const parts = path.split('.');
  let cursor: unknown = object;
  for (const part of parts) {
    if (cursor === null || typeof cursor !== 'object') return null;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return typeof cursor === 'number' ? cursor : null;
}

function clampRatio(value: number): number {
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
    const [, goodId, field] = path.split('.');
    if (!goodId || !field) return false;
    const market = state.markets[marketKeyOf(target.entityId, goodId)];
    if (!market) return false;
    return assignMarketField(market, field, value);
  }

  const object = targetObject(state, target);
  if (!object) return false;

  const parts = path.split('.');
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

function assignMarketField(market: Market, field: string, value: number): boolean {
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

function sanitize(path: string, value: number): number {
  if (RATIO_PATHS.has(path) || path.startsWith('policies.')) return clampRatio(value);
  if (MONEY_PATHS.has(path)) return Math.max(0, Math.round(value));
  if (path === 'members' || path === 'military' || path === 'population' || path === 'age') {
    return Math.max(0, Math.round(value));
  }
  if (path === 'scale' || path === 'skills') return Math.max(0, value);
  if (path.startsWith('skills.')) return Math.min(20, Math.max(0, Math.round(value)));
  return value;
}

/** 风险项使用的归一化特征（0–1 或小数值），避免量纲差异。 */
export function readFeature(state: WorldState, target: EventTarget, path: string): number {
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
    case 'priceRatio': {
      if (target.scope !== 'region') return 0;
      let worst = 0;
      for (const goodId of sortedIds(Object.fromEntries(Object.entries(state.markets)))) {
        const market = state.markets[goodId];
        if (!market || market.regionId !== target.entityId) continue;
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

export function evaluate(expr: Expr, resolve: (path: string) => number): boolean {
  if ('all' in expr) return expr.all.every((child) => evaluate(child, resolve));
  if ('any' in expr) return expr.any.some((child) => evaluate(child, resolve));
  if ('not' in expr) return !evaluate(expr.not, resolve);
  return compareCondition(expr, resolve(expr.path));
}

function compareCondition(condition: CondExpr, value: number): boolean {
  const target = condition.value;
  switch (condition.op) {
    case '>':
      return value > target;
    case '>=':
      return value >= target;
    case '<':
      return value < target;
    case '<=':
      return value <= target;
    case '==':
      return value === target;
    case '!=':
      return value !== target;
  }
}

/* ------------------------------------------------------------------ */
/* 候选收集                                                             */
/* ------------------------------------------------------------------ */

export function entitiesOfScope(state: WorldState, scope: EventScope): EntityId[] {
  switch (scope) {
    case 'organization':
      return sortedIds(state.organizations);
    case 'country':
      return sortedIds(state.countries);
    case 'region':
      return sortedIds(state.regions);
    case 'character':
      return sortedIds(state.characters);
  }
}

/** 收集某次月度抽样中所有"够格"的事件候选（已过条件与冷却）。 */
export function collectCandidates(
  state: WorldState,
  content: WorldContent,
  day: number,
  maxTier = 2,
): Candidate[] {
  const candidates: Candidate[] = [];
  const events = [...content.events].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const def of events) {
    for (const entityId of entitiesOfScope(state, def.scope)) {
      if ((state.tiers[entityId] ?? 3) > maxTier) continue;
      const cooldownKey = `${def.id}@${entityId}`;
      const until = state.cooldowns[cooldownKey] ?? 0;
      if (until > day) continue;

      const target: EventTarget = { scope: def.scope, entityId };
      // 条件与风险项共用同一套特征函数，因此 `debtRatio` 这类派生量也能写进 conditions。
      const resolver = (path: string): number => readFeature(state, target, path);

      if (def.conditions && !evaluate(def.conditions, resolver)) continue;

      let exponent = 0;
      for (const term of def.risk.terms) {
        exponent += term.coef * readFeature(state, target, term.path);
      }
      const lambda = def.risk.lambda0 * Math.exp(exponent);
      if (!(lambda > 0) || !Number.isFinite(lambda)) continue;

      candidates.push({
        def,
        target,
        lambda,
        group: def.exclusivity ? `${entityId}|${def.exclusivity}` : null,
      });
    }
  }
  return candidates;
}

/* ------------------------------------------------------------------ */
/* 竞速与判定                                                           */
/* ------------------------------------------------------------------ */

export function selectTriggered(
  state: WorldState,
  candidates: readonly Candidate[],
  rng: Random,
  periodKey: string,
  samplingDays: number = EVENT_WINDOW_DAYS,
): Triggered[] {
  const triggered: Triggered[] = [];
  const groups = new Map<string, Candidate[]>();
  const singles: Candidate[] = [];

  for (const candidate of candidates) {
    if (candidate.group) {
      const list = groups.get(candidate.group) ?? [];
      list.push(candidate);
      groups.set(candidate.group, list);
    } else {
      singles.push(candidate);
    }
  }

  // 互斥组：指数竞速，只允许一个赢家。
  for (const [groupKey, members] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const totalLambda = members.reduce((sum, member) => sum + member.lambda, 0);
    const probability = triggerProbability(totalLambda, samplingDays);
    const probe = rng.nextFloat({ stream: 'event', entityId: groupKey, periodKey });
    if (probe >= probability) continue;

    let winner: Candidate | null = null;
    let bestTime = Number.POSITIVE_INFINITY;
    for (const member of members) {
      const time = rng.exponential(
        {
          stream: 'event',
          entityId: `${groupKey}:${member.def.id}`,
          periodKey,
        },
        member.lambda,
      );
      if (time < bestTime) {
        bestTime = time;
        winner = member;
      }
    }
    if (winner) {
      triggered.push({ def: winner.def, target: winner.target });
      // 赢家之外的成员进入冷却，避免下个月立刻顶上（同组互斥的语义延续）。
      for (const member of members) {
        if (member !== winner) {
          state.cooldowns[`${member.def.id}@${member.target.entityId}`] =
            state.clock.day + Math.max(1, Math.round(member.def.cooldownDays / 3));
        }
      }
    }
  }

  // 独立事件：各自判定。
  for (const candidate of singles) {
    const probability = triggerProbability(candidate.lambda, samplingDays);
    const key = `${candidate.def.id}:${candidate.target.entityId}`;
    if (rng.chance({ stream: 'event', entityId: key, periodKey }, probability)) {
      triggered.push({ def: candidate.def, target: candidate.target });
    }
  }

  return triggered;
}

/* ------------------------------------------------------------------ */
/* 效果结算                                                             */
/* ------------------------------------------------------------------ */

/** 应用一个已触发事件的全部效果，并设置冷却。 */
export function applyEvent(state: WorldState, content: WorldContent, trigger: Triggered): Outcome {
  const { def, target } = trigger;
  const changes: string[] = [];

  for (const effect of def.effects) {
    changes.push(...applyEffect(state, content, target, effect, def.id));
  }

  const cooldown =
    def.cooldownDays > 0 ? def.cooldownDays : content.balance.events.defaultCooldownDays;
  state.cooldowns[`${def.id}@${target.entityId}`] = state.clock.day + cooldown;

  return {
    def,
    target,
    summary: `${def.text.title}（${labelOf(state, target)}）`,
    changes,
  };
}

function applyEffect(
  state: WorldState,
  content: WorldContent,
  target: EventTarget,
  effect: Effect,
  parentEventId: string,
): string[] {
  if (effect.kind === 'schedule') {
    state.scheduleSeq += 1;
    state.pendingEvents.push({
      day: state.clock.day + Math.max(1, Math.round(effect.inDays)),
      phase: 4,
      seq: state.scheduleSeq,
      kind: 'event',
      refId: effect.eventId,
      parentEventId,
      targetScope: target.scope,
      targetEntityId: target.entityId,
    });
    return [`排定后续事件 ${effect.eventId}（+${effect.inDays} 天）`];
  }

  const current = readNumber(state, target, effect.path);
  if (current === null) return [`忽略未知路径 ${effect.path}`];

  let next: number;
  switch (effect.kind) {
    case 'add':
      next = current + effect.value;
      break;
    case 'mul':
      next = current * effect.value;
      break;
    case 'set':
      next = effect.value;
      break;
  }

  if (!writeNumber(state, target, effect.path, next)) {
    return [`无法写入 ${effect.path}`];
  }
  void content;
  return [
    `${effect.path}: ${round(current)} → ${round(readNumber(state, target, effect.path) ?? next)}`,
  ];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function labelOf(state: WorldState, target: EventTarget): string {
  switch (target.scope) {
    case 'organization':
      return state.organizations[target.entityId]?.name ?? target.entityId;
    case 'country':
      return state.countries[target.entityId]?.name ?? target.entityId;
    case 'region':
      return state.regions[target.entityId]?.name ?? target.entityId;
    case 'character':
      return state.characters[target.entityId]?.name ?? target.entityId;
  }
}
