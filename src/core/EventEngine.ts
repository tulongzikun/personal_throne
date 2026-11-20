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

import { DAYS_PER_MONTH } from './GameClock';
import { Random } from './Random';
import { rollCheck } from '../systems/character/Check';
import type {
  CondExpr,
  Effect,
  EntityId,
  EventDef,
  ChoiceDef,
  EventWhen,
  Expr,
  Market,
  WorldContent,
  WorldState,
} from './WorldState';
import type { HistoryRef } from './History';
import { marketKeyOf, sortedIds } from './WorldState';

/** 默认抽样窗口（天）：月度抽样点，与 `balance.events.samplingDays` 对应。 */
export const EVENT_WINDOW_DAYS = 30;
/** 历史特征的回溯窗口（一年）。 */
export const HISTORY_WINDOW_DAYS = 360;
/** 玩家抉择的等待窗口（天），超时自动按效用择优。 */
export const CHOICE_WINDOW_DAYS = 180;

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

const PATH_CACHE = new Map<string, readonly string[]>();

/** 路径切分结果缓存：事件抽样每月要读上万次特征，避免反复 split。 */
function pathParts(path: string): readonly string[] {
  let parts = PATH_CACHE.get(path);
  if (!parts) {
    parts = path.split('.');
    PATH_CACHE.set(path, parts);
  }
  return parts;
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

/** 单轮抽样共享的特征缓存：价格比与历史计数都很贵，逐实体重算会变成 O(实体×事件×市场)。 */
export interface FeatureCache {
  readonly day: number;
  /** regionId → 该地区最差价格比（0–1）。 */
  readonly price: Map<string, number>;
  /** eventId → (entityId → 近一年次数)。 */
  readonly history: Map<string, Map<string, number>>;
}

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

function historyCount(
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
      // 死者不再成为事件目标：否则百年模拟里过半事件落在已故人物身上。
      return sortedIds(state.characters).filter((id) => state.characters[id]?.alive === true);
  }
}

/** 收集某次月度抽样中所有"够格"的事件候选（已过条件与冷却）。 */
/** 事件目标所在地区：地区=自身，组织=母地区，人物=所在地，国家=人口最多的地区。 */
export function targetRegionOf(state: WorldState, target: EventTarget): string | null {
  switch (target.scope) {
    case 'region':
      return state.regions[target.entityId] ? target.entityId : null;
    case 'organization':
      return state.organizations[target.entityId]?.homeRegionId ?? null;
    case 'character':
      return state.characters[target.entityId]?.regionId ?? null;
    case 'country': {
      const country = state.countries[target.entityId];
      let best: string | null = null;
      let population = -1;
      for (const id of country?.regionIds ?? []) {
        const region = state.regions[id];
        if (region && region.population > population) {
          population = region.population;
          best = id;
        }
      }
      return best;
    }
  }
}

/** 事件目标所在国家（地区按所属国）。 */
export function targetCountryOf(state: WorldState, target: EventTarget): string | null {
  if (target.scope === 'country') return state.countries[target.entityId] ? target.entityId : null;
  const regionId = targetRegionOf(state, target);
  return regionId ? (state.regions[regionId]?.countryId ?? null) : null;
}

/** 世界门控：发生地不符的事件不该出现在候选里（"石渡关雪崩"只在高谷）。 */
export function matchesWhen(
  state: WorldState,
  when: EventWhen | undefined,
  target: EventTarget,
): boolean {
  if (!when) return true;
  const countryId = targetCountryOf(state, target);
  if (when.countryId !== undefined) {
    const allowed = typeof when.countryId === 'string' ? [when.countryId] : when.countryId;
    if (!countryId || !allowed.includes(countryId)) return false;
  }
  const regionId = targetRegionOf(state, target);
  if (when.regionIds !== undefined && (!regionId || !when.regionIds.includes(regionId)))
    return false;
  if (when.terrains !== undefined) {
    const terrain = regionId ? state.regions[regionId]?.terrain : undefined;
    if (!terrain || !when.terrains.includes(terrain)) return false;
  }
  return true;
}

export function collectCandidates(
  state: WorldState,
  content: WorldContent,
  day: number,
  maxTier = 2,
): Candidate[] {
  const candidates: Candidate[] = [];
  const cache = createFeatureCache(state);
  const events = [...content.events].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // 同一轮里各 scope 的实体列表复用，避免逐事件重排。
  const entityCache = new Map<EventScope, readonly EntityId[]>();
  // 同一实体的同一特征在一轮内只解析一次：多个事件常读 conflict/governance/cashRatio 这类共享路径。
  const featureMemo = new Map<EntityId, Map<string, number>>();
  const featureFor = (target: EventTarget, path: string): number => {
    let memo = featureMemo.get(target.entityId);
    if (!memo) {
      memo = new Map();
      featureMemo.set(target.entityId, memo);
    }
    const cached = memo.get(path);
    if (cached !== undefined) return cached;
    const value = readFeature(state, target, path, cache);
    memo.set(path, value);
    return value;
  };
  const entitiesFor = (scope: EventScope): readonly EntityId[] => {
    let list = entityCache.get(scope);
    if (!list) {
      list = entitiesOfScope(state, scope);
      entityCache.set(scope, list);
    }
    return list;
  };

  // 人物事件按季度抽样：冒险类事件每月逐人判定既贵又吵（百年能刷出三千条）。
  const characterRound = Math.floor(day / DAYS_PER_MONTH) % 3 === 0;

  for (const def of events) {
    // 链条后续只允许由父事件排定，避免随机直接跳到第 2/3 步。
    if ((def.chain?.step ?? 0) > 1) continue;
    if (def.scope === 'character' && !characterRound) continue;
    for (const entityId of entitiesFor(def.scope)) {
      if ((state.tiers[entityId] ?? 3) > maxTier) continue;
      const cooldownKey = `${def.id}@${entityId}`;
      const until = state.cooldowns[cooldownKey] ?? 0;
      if (until > day) continue;

      const target: EventTarget = { scope: def.scope, entityId };
      // 世界门控：地形/国家不符的事件不进入候选（阶段 4）。
      if (!matchesWhen(state, def.when, target)) continue;
      // 条件与风险项共用同一套特征函数，因此 `debtRatio` 这类派生量也能写进 conditions。
      const resolver = (path: string): number => featureFor(target, path);

      if (def.conditions && !evaluate(def.conditions, resolver)) continue;

      let exponent = 0;
      for (const term of def.risk.terms) {
        exponent += term.coef * featureFor(target, term.path);
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
/** 把 {place}/{country}/{subject} 占位符换成专名（阶段 4）。 */
export function eventText(
  state: WorldState,
  def: EventDef,
  target: EventTarget,
): { title: string; body: string } {
  const regionId = targetRegionOf(state, target);
  const countryId = targetCountryOf(state, target);
  const vars: Record<string, string> = {
    place: (regionId ? state.regions[regionId]?.name : undefined) ?? labelOf(state, target),
    country: (countryId ? state.countries[countryId]?.name : undefined) ?? labelOf(state, target),
    subject: labelOf(state, target),
  };
  const fill = (text: string): string =>
    text.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);
  return { title: fill(def.text.title), body: fill(def.text.body) };
}

/** 按历史记录里的 refs 找到主体，套用同一套占位符替换。 */
export function eventTextForRefs(
  state: WorldState,
  def: EventDef,
  refs: readonly HistoryRef[] | undefined,
): { title: string; body: string } {
  const scopes = new Set(['character', 'organization', 'country', 'region']);
  const first = refs?.find((ref) => scopes.has(ref.type));
  if (!first) return { title: def.text.title, body: def.text.body };
  return eventText(state, def, {
    scope: first.type as EventTarget['scope'],
    entityId: first.id,
  });
}

export function applyEvent(
  state: WorldState,
  content: WorldContent,
  trigger: Triggered,
  rng: Random | null = null,
): Outcome {
  const { def, target } = trigger;
  const changes: string[] = [];

  for (const effect of def.effects) {
    changes.push(...applyEffect(state, content, target, effect, def.id));
  }

  // 有选项的事件：不拦玩家时按效用自动择优（确定性，无 rng 也稳定）。
  if (def.choices && def.choices.length > 0) {
    const choice = pickChoice(state, target, def.choices);
    if (choice) {
      changes.push(...resolveChoice(state, content, def, target, choice, rng));
      changes.push(`抉择：${choice.label}`);
    }
  }

  if (rng) {
    changes.push(...scheduleFollowUps(state, def, target, rng));
  }

  const cooldown =
    def.cooldownDays > 0 ? def.cooldownDays : content.balance.events.defaultCooldownDays;
  state.cooldowns[`${def.id}@${target.entityId}`] = state.clock.day + cooldown;

  const notes = changes.filter((line) => line.includes('检定') || line.startsWith('抉择：'));
  const suffix = notes.length > 0 ? `：${notes.join('；')}` : '';
  return {
    def,
    target,
    summary: `${eventText(state, def, target).title}（${labelOf(state, target)}）${suffix}`,
    changes,
  };
}

/**
 * 事件链：父事件结算后按 followUps 排定后续事件。
 * 条件用与候选相同的一套特征函数，因此可以写 `history.<eventId>`。
 */
export function scheduleFollowUps(
  state: WorldState,
  def: EventDef,
  target: EventTarget,
  rng: Random,
): string[] {
  const followUps = def.followUps;
  if (!followUps || followUps.length === 0) return [];

  const step = (def.chain?.step ?? 1) + 1;
  const notes: string[] = [];
  const resolver = (path: string): number => readFeature(state, target, path);

  for (const followUp of followUps) {
    if (followUp.conditions && !evaluate(followUp.conditions, resolver)) continue;
    const chance = followUp.chance ?? 1;
    if (
      chance < 1 &&
      !rng.chance({ stream: 'followup', entityId: target.entityId, periodKey: def.id }, chance)
    )
      continue;

    state.scheduleSeq += 1;
    state.pendingEvents.push({
      day: state.clock.day + Math.max(1, Math.round(followUp.delayDays)),
      phase: 4,
      seq: state.scheduleSeq,
      kind: 'event',
      refId: followUp.eventId,
      parentEventId: def.id,
      targetScope: target.scope,
      targetEntityId: target.entityId,
      chainStep: step,
    });
    notes.push(`排定后续 ${followUp.eventId}（+${followUp.delayDays} 天）`);
  }

  return notes;
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

  if (effect.kind === 'merge') {
    return mergeIntoCompetitor(state, target);
  }

  if (effect.kind === 'stat') {
    state.stats[effect.key] += Math.round(effect.value);
    return [`统计 ${effect.key} +${Math.round(effect.value)}`];
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

/**
 * 并购：被作用组织并入同地区同行业资产最大的竞争者。
 * 资产、负债、成员、工资随之归并；被并方注销并留下清算快照，
 * 其成员与领袖改挂到收购方，避免出现悬空引用。
 */
function mergeIntoCompetitor(state: WorldState, target: EventTarget): string[] {
  if (target.scope !== 'organization') return ['并购仅适用于组织'];
  const victim = state.organizations[target.entityId];
  if (!victim || victim.lifecycle === 'dissolved') return ['目标组织已不存在'];

  let acquirer: WorldState['organizations'][string] | undefined;
  for (const id of sortedIds(state.organizations)) {
    const org = state.organizations[id];
    if (!org || org.id === victim.id || org.lifecycle === 'dissolved') continue;
    if (org.homeRegionId !== victim.homeRegionId || org.industry !== victim.industry) continue;
    if (!acquirer || org.assets > acquirer.assets) acquirer = org;
  }
  if (!acquirer) return [`${victim.name} 没有可并购的同业竞争者`];

  const shortfall = Math.max(0, victim.liabilities - victim.cash - victim.assets);
  acquirer.cash += victim.cash;
  acquirer.assets += victim.assets;
  acquirer.liabilities += victim.liabilities;
  acquirer.members += victim.members;
  acquirer.payrollMonthly += victim.payrollMonthly;
  acquirer.scale = Math.max(acquirer.scale, victim.scale);

  const day = state.clock.day;
  victim.cash = 0;
  victim.assets = 0;
  victim.liabilities = 0;
  victim.unpaidWages = 0;
  victim.members = 0;
  victim.payrollMonthly = 0;
  victim.lifecycle = 'dissolved';
  victim.liquidation = {
    day,
    proceeds: 0,
    creditorPaid: 0,
    wagePaid: 0,
    shareholderPaid: 0,
    shortfall,
  };
  state.stats.mergers += 1;
  state.stats.dissolved += 1;

  for (const characterId of sortedIds(state.characters)) {
    const character = state.characters[characterId];
    if (character?.organizationId === victim.id) character.organizationId = acquirer.id;
  }
  for (const contractId of sortedIds(state.contracts)) {
    const contract = state.contracts[contractId];
    if (!contract || contract.status !== 'open') continue;
    if (contract.fromOrgId === victim.id) contract.fromOrgId = acquirer.id;
    if (contract.toOrgId === victim.id) contract.toOrgId = acquirer.id;
  }
  for (const marketId of sortedIds(state.markets)) {
    const market = state.markets[marketId];
    if (market) delete market.shareByOrg[victim.id];
  }

  return [
    `${victim.name} 被 ${acquirer.name} 并购（承接负债 ${victim.liabilities}，差额 ${shortfall}）`,
  ];
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

/* ------------------------------------------------------------------ */
/* 抉择                                                                 */
/* ------------------------------------------------------------------ */

/** 应用事件自身的效果（有 choices 时，基础效果在"做出抉择"时一并结算）。 */
export function applyBaseEffects(
  state: WorldState,
  content: WorldContent,
  def: EventDef,
  target: EventTarget,
): string[] {
  const changes: string[] = [];
  for (const effect of def.effects) {
    changes.push(...applyEffect(state, content, target, effect, def.id));
  }
  return changes;
}

/** 选项效用：把效果折算成同一量纲，供 NPC 自动择优。 */
export function choiceUtility(choice: ChoiceDef): number {
  let score = 0;
  for (const effect of choice.effects) {
    if (effect.kind === 'schedule' || effect.kind === 'merge') {
      score += 20;
      continue;
    }
    if (effect.kind === 'stat') {
      score += Math.abs(effect.value) * 10;
      continue;
    }
    const magnitude = Math.abs(effect.value);
    if (effect.path === 'legitimacy' || effect.path === 'stability') score += magnitude * 500;
    else if (effect.path === 'conflict') score -= magnitude * 400;
    else if (effect.path === 'wealth' || effect.path === 'cash') score += effect.value;
    else if (effect.path === 'treasury') score += effect.value * 0.5;
    else score += effect.value;
  }
  return score;
}

/** 可用选项（满足条件）里选效用最高者；同分按 id 稳定排序。 */
export function pickChoice(
  state: WorldState,
  target: EventTarget,
  choices: readonly ChoiceDef[],
): ChoiceDef | null {
  const resolver = (path: string): number => readFeature(state, target, path);
  const available = choices
    .filter((choice) => !choice.conditions || evaluate(choice.conditions, resolver))
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let best: ChoiceDef | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const choice of available) {
    const score = choiceUtility(choice);
    if (score > bestScore) {
      best = choice;
      bestScore = score;
    }
  }
  return best;
}

/** 应用某个选项并返回变化说明；调用方负责把 pending 从状态里移除。 */
/** 没有显式 rng（直接调用 applyEvent）时，用种子派生一个可复现的掷骰源。 */
function fallbackRng(state: WorldState): Random {
  return new Random(`${state.meta.seed}:check`);
}

export function resolveChoice(
  state: WorldState,
  content: WorldContent,
  def: EventDef,
  target: EventTarget,
  choice: ChoiceDef,
  rng: Random | null = null,
): string[] {
  const changes: string[] = [];
  let effects = choice.effects;
  const character = target.scope === 'character' ? state.characters[target.entityId] : undefined;
  if (choice.check && character) {
    const key = `${def.id}:${choice.id}`;
    const check = rollCheck(rng ?? fallbackRng(state), character, choice.check, key);
    changes.push(check.text);
    if (!check.success) effects = choice.failureEffects ?? [];
  }
  for (const effect of effects) {
    changes.push(...applyEffect(state, content, target, effect, def.id));
  }
  if (rng) changes.push(...scheduleFollowUps(state, def, target, rng));
  return changes;
}
