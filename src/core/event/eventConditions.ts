/* 条件编译、候选收集与互斥竞速（谁先发生）。 */

import { DAYS_PER_MONTH } from '../GameClock';
import { Random, fnv1a64 } from '../Random';
import type { CondExpr, EntityId, EventWhen, Expr, WorldContent, WorldState } from '../WorldState';
import { sortedIds } from '../WorldState';
import { createFeatureCache, readFeature } from './eventFeatures';
import { EVENT_WINDOW_DAYS } from './eventTypes';
import type { Candidate, EventScope, EventTarget, Triggered } from './eventTypes';

/**
 * 事件触发概率。
 * `lambda0` 在内容里按**月率**书写（计划 §7.2），因此 30 天窗口下 P = 1 − e^(−λ)；
 * 窗口天数来自 balance，便于以后改成周/季抽样。
 */
export function triggerProbability(lambda: number, samplingDays: number): number {
  return 1 - Math.exp(-lambda * (samplingDays / EVENT_WINDOW_DAYS));
}

export function evaluate(expr: Expr, resolve: (path: string) => number): boolean {
  if ('all' in expr) return expr.all.every((child) => evaluate(child, resolve));
  if ('any' in expr) return expr.any.some((child) => evaluate(child, resolve));
  if ('not' in expr) return !evaluate(expr.not, resolve);
  return compareCondition(expr, resolve(expr.path));
}

export function compareCondition(condition: CondExpr, value: number): boolean {
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

  // 人物事件：玩家每月都在候选里，另外按月轮换 3 位 NPC；随机目标几十人会造成「一个月七次伏击」。
  const characterEntities = (): readonly EntityId[] => {
    const cached = entityCache.get('character');
    if (cached) return cached;
    const alive = entitiesFor('character');
    const player = state.playerId;
    const pool = alive.filter((id) => id !== player);
    const picks = new Set<EntityId>();
    if (state.characters[player]?.alive) picks.add(player);
    if (pool.length > 0) {
      const month = Math.floor(day / DAYS_PER_MONTH);
      const start = Number(fnv1a64(`${state.meta.seed}:${month}`) % BigInt(pool.length));
      for (let i = 0; i < 3 && i < pool.length; i += 1) {
        const id = pool[(start + i) % pool.length];
        if (id) picks.add(id);
      }
    }
    const list = [...picks];
    entityCache.set('character', list);
    return list;
  };

  for (const def of events) {
    // 链条后续只允许由父事件排定，避免随机直接跳到第 2/3 步。
    if ((def.chain?.step ?? 0) > 1) continue;
    const entities = def.scope === 'character' ? characterEntities() : entitiesFor(def.scope);
    for (const entityId of entities) {
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
  // 同一取样周期里同一事件最多触发一次；人物事件整体最多两条，避免一个月全是「路遇伏击」。
  const fired = new Set<string>();
  const CHARACTER_EVENT_LIMIT = 2;
  let characterEvents = 0;
  const allowed = (candidate: Candidate): boolean => {
    if (fired.has(candidate.def.id)) return false;
    if (candidate.def.scope === 'character' && characterEvents >= CHARACTER_EVENT_LIMIT)
      return false;
    return true;
  };
  const remember = (candidate: Candidate): void => {
    fired.add(candidate.def.id);
    if (candidate.def.scope === 'character') characterEvents += 1;
  };
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
    if (winner && allowed(winner)) {
      remember(winner);
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
    if (!allowed(candidate)) continue;
    const probability = triggerProbability(candidate.lambda, samplingDays);
    const key = `${candidate.def.id}:${candidate.target.entityId}`;
    if (rng.chance({ stream: 'event', entityId: key, periodKey }, probability)) {
      remember(candidate);
      triggered.push({ def: candidate.def, target: candidate.target });
    }
  }

  return triggered;
}

/* ------------------------------------------------------------------ */
/* 效果结算                                                             */
/* ------------------------------------------------------------------ */
