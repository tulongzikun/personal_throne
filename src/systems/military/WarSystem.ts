/**
 * 军事与战争（M6）：常备军维持、开战/议和、行军、会战、围城与占领。
 *
 * 规则（与 design.md 第 12 章、development-plan.md M6 对齐）：
 * - 每个国家只有一支"王国军"（`army:<countryId>`），规模随人口与军费折算；
 * - 战争是**两国关系**：`atWarWith` 双向写入，停战后清空；
 * - 行军按月推进一个地区（沿最短路径），到达敌国地区后若无敌军则累积围城进度；
 * - 会战按 `规模 × 训练 × 士气 × 统帅战术` 的比值判定，败方撤退并掉士气；
 * - 厌战度随战争月数上升，任一方到 `peaceExhaustion` 即被迫议和；
 * - 停战时占领方保留已占领地区（割让），未占领则恢复原状。
 *
 * 所有随机抽样都走 `ctx.rng` 的命名流（`stream: 'war'`），因此同种子可复现。
 */

import type {
  Army,
  CountryId,
  RegionId,
  SettleContext,
  WorldContent,
  WorldState,
} from '../../core/WorldState';
import { sortedIds } from '../../core/WorldState';
import { effectiveSkill } from '../character/Character';

export interface ArmyUpdate {
  readonly countryId: string;
  readonly size: number;
  readonly morale: number;
}

export interface WarOutcome {
  readonly kind: 'battle' | 'siege' | 'occupation' | 'peace' | 'declaration' | 'desertion';
  readonly summary: string;
  readonly attackerId: CountryId;
  readonly defenderId: CountryId;
  readonly regionId?: RegionId;
  readonly casualties?: { readonly attacker: number; readonly defender: number };
}

export interface DeclareWarResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly summary?: string;
}

/** 每月先维持常备军（规模/士气/训练），再推进战争。 */
export function settleMonthlyMilitary(
  state: WorldState,
  content: WorldContent,
  ctx: SettleContext,
): ArmyUpdate[] {
  const updates: ArmyUpdate[] = [];

  for (const countryId of sortedIds(state.countries)) {
    const country = state.countries[countryId];
    if (!country) continue;

    const capital = capitalOf(state, country.id);
    if (!capital) continue;

    const size = Math.max(
      50,
      Math.round(country.population * 0.008 * (0.5 + country.policies.militaryShare * 2)),
    );
    const armyId = `army:${country.id}`;
    const existing = state.armies[armyId];

    // 战争期间不补充兵员，只做维护；和平时期才按军费恢复。
    const atWar = country.atWarWith.length > 0;
    const nextSize = atWar && existing ? existing.size : size;
    const moraleBase = 0.45 + country.legitimacy * 0.3 + (country.treasury > 0 ? 0.1 : -0.15);
    const morale = clamp01(
      moraleBase +
        (ctx.rng.nextFloat({ stream: 'army', entityId: country.id, periodKey: ctx.periodKey }) -
          0.5) *
          0.1,
    );
    const training = clamp01((existing?.training ?? 0.35) + content.balance.war.trainingPerMonth);

    state.armies[armyId] = {
      id: armyId,
      countryId: country.id,
      size: nextSize,
      locationRegionId: existing?.locationRegionId ?? capital.id,
      morale,
      training,
      commanderId: existing?.commanderId ?? null,
      stance: existing?.stance ?? 'defend',
      targetRegionId: existing?.targetRegionId ?? null,
    };
    updates.push({ countryId: country.id, size: nextSize, morale });
  }

  return updates;
}

export function totalArmySize(state: WorldState, countryId: string): number {
  return Object.values(state.armies)
    .filter((army) => army.countryId === countryId)
    .reduce((sum, army) => sum + army.size, 0);
}

export function isAtWar(state: WorldState, a: CountryId, b: CountryId): boolean {
  return state.countries[a]?.atWarWith.includes(b) ?? false;
}

export function declareWar(
  state: WorldState,
  content: WorldContent,
  attackerId: CountryId,
  defenderId: CountryId,
): DeclareWarResult {
  void content;
  const attacker = state.countries[attackerId];
  const defender = state.countries[defenderId];
  if (!attacker || !defender) return { ok: false, error: '国家不存在' };
  if (attackerId === defenderId) return { ok: false, error: '不能对自己宣战' };
  if (isAtWar(state, attackerId, defenderId)) return { ok: false, error: '已经在交战' };

  // 议和冷却：停战后 24 个月内不能再次开战（`warStartDay` 记录上次战争）。
  const cooldown = 720;
  if (attacker.warStartDay > 0 && state.clock.day - attacker.warStartDay < cooldown) {
    return { ok: false, error: '刚停战不久，国内反战情绪未平' };
  }

  attacker.atWarWith = [...new Set([...attacker.atWarWith, defenderId])].sort();
  defender.atWarWith = [...new Set([...defender.atWarWith, attackerId])].sort();
  attacker.warStartDay = state.clock.day;
  defender.warStartDay = state.clock.day;
  attacker.diplomacy[defenderId] = -100;
  defender.diplomacy[attackerId] = -100;

  const army = state.armies[`army:${attackerId}`];
  if (army) {
    army.stance = 'march';
    army.targetRegionId = nearestEnemyRegion(state, attackerId, defenderId, army.locationRegionId);
  }

  return {
    ok: true,
    summary: `${attacker.name} 向 ${defender.name} 宣战`,
  };
}

export function makePeace(
  state: WorldState,
  attackerId: CountryId,
  defenderId: CountryId,
  ctx: SettleContext,
): WarOutcome {
  void ctx;
  const attacker = state.countries[attackerId];
  const defender = state.countries[defenderId];
  if (!attacker || !defender) {
    return { kind: 'peace', summary: '议和失败：国家不存在', attackerId, defenderId };
  }

  // 占领地优先割让给占领方；否则归还。
  const conquered: RegionId[] = [];
  for (const regionId of sortedIds(state.regions)) {
    const region = state.regions[regionId];
    if (!region || !region.occupiedBy) continue;
    const occupier = region.occupiedBy;
    if (occupier !== attackerId && occupier !== defenderId) continue;
    conquered.push(regionId);

    const from = state.countries[region.countryId];
    const to = state.countries[occupier];
    if (from && to) {
      from.regionIds = from.regionIds.filter((id) => id !== regionId);
      if (!to.regionIds.includes(regionId)) {
        to.regionIds = [...to.regionIds, regionId].sort();
      }
      region.countryId = to.id;
      to.population += region.population;
      from.population = Math.max(0, from.population - region.population);
    }
    region.occupiedBy = null;
    region.siegeProgress = 0;
  }

  attacker.atWarWith = attacker.atWarWith.filter((id) => id !== defenderId);
  defender.atWarWith = defender.atWarWith.filter((id) => id !== attackerId);
  attacker.warExhaustion = 0;
  defender.warExhaustion = 0;
  attacker.diplomacy[defenderId] = Math.max(attacker.diplomacy[defenderId] ?? 0, -40);
  defender.diplomacy[attackerId] = Math.max(defender.diplomacy[attackerId] ?? 0, -40);

  for (const army of Object.values(state.armies)) {
    army.stance = 'defend';
    army.targetRegionId = null;
  }

  // 战争结束的记录写入调用方的历史（这里只准备文案）。
  return {
    kind: conquered.length > 0 ? 'occupation' : 'peace',
    summary: `${attacker.name} 与 ${defender.name} 停战${
      conquered.length > 0 ? `，割让 ${conquered.length} 个地区` : ''
    }`,
    attackerId,
    defenderId,
    ...(conquered[0] ? { regionId: conquered[0] } : {}),
  };
}

/**
 * 外交漂移与 AI 宣战：同政体互相靠拢，异政体缓慢交恶；
 * 关系极差且明显强于对手时，按月度概率开战（受同一套冷却约束）。
 */
export function settleMonthlyDiplomacy(
  state: WorldState,
  content: WorldContent,
  ctx: SettleContext,
): DeclareWarResult[] {
  const results: DeclareWarResult[] = [];
  const ids = sortedIds(state.countries);

  for (const fromId of ids) {
    const from = state.countries[fromId];
    if (!from) continue;
    for (const toId of ids) {
      if (fromId >= toId) continue;
      const to = state.countries[toId];
      if (!to) continue;

      const samePolity = from.polity === to.polity;
      const target = samePolity ? 15 : -38;
      const current = from.diplomacy[toId] ?? 0;
      const next = current + (target - current) * 0.08;
      from.diplomacy[toId] = Math.round(next);
      to.diplomacy[fromId] = Math.round(next);

      if (from.atWarWith.length > 0 || to.atWarWith.length > 0) continue;
      if (current > -30) continue;
      if (from.warStartDay > 0 && state.clock.day - from.warStartDay < 960) continue;

      const mine = totalArmySize(state, fromId);
      const theirs = totalArmySize(state, toId);
      if (mine < theirs * 1.3) continue;

      const roll = ctx.rng.nextFloat({
        stream: 'war-ai',
        entityId: `${fromId}:${toId}`,
        periodKey: ctx.periodKey,
      });
      if (roll > 0.05) continue;

      const result = declareWar(state, content, fromId, toId);
      if (result.ok) results.push(result);
    }
  }
  return results;
}

/** 每月的战争推进：行军 → 会战/围城 → 厌战与议和。 */
export function settleMonthlyWar(
  state: WorldState,
  content: WorldContent,
  ctx: SettleContext,
): WarOutcome[] {
  const outcomes: WarOutcome[] = [];
  const pairs = warPairs(state);

  for (const [aId, bId] of pairs) {
    const a = state.countries[aId];
    const b = state.countries[bId];
    if (!a || !b) continue;

    a.warExhaustion = clamp01(a.warExhaustion + content.balance.war.exhaustionPerMonth);
    b.warExhaustion = clamp01(b.warExhaustion + content.balance.war.exhaustionPerMonth);

    // 军费：按兵力从国库扣，扣不动就欠债并逃兵。
    for (const country of [a, b]) {
      const army = state.armies[`army:${country.id}`];
      if (!army) continue;
      const upkeep = Math.round(army.size * content.balance.war.upkeepPerSoldier);
      if (country.treasury >= upkeep) {
        country.treasury -= upkeep;
      } else {
        country.debt += upkeep - country.treasury;
        country.treasury = 0;
        const deserted = Math.round(army.size * content.balance.war.desertionRate);
        army.size = Math.max(20, army.size - deserted);
        army.morale = clamp01(army.morale - 0.12);
        outcomes.push({
          kind: 'desertion',
          summary: `${country.name} 欠饷，逃兵 ${deserted} 人`,
          attackerId: country.id,
          defenderId: country.id === aId ? bId : aId,
        });
      }
    }

    advanceArmies(state, aId, bId);

    const battleOutcome = resolveBattleIfCoLocated(state, content, aId, bId, ctx);
    if (battleOutcome) {
      outcomes.push(battleOutcome);
      for (const countryId of [aId, bId]) {
        const country = state.countries[countryId];
        if (country) country.warExhaustion = clamp01(country.warExhaustion + 0.03);
      }
    }

    const siegeOutcome = resolveSiege(state, aId, bId, content);
    if (siegeOutcome) outcomes.push(siegeOutcome);

    // 被迫议和：任一方厌战到阈值，或国库彻底枯竭。
    const exhausted =
      a.warExhaustion >= content.balance.war.peaceExhaustion ||
      b.warExhaustion >= content.balance.war.peaceExhaustion ||
      (a.treasury <= 0 && b.treasury <= 0);
    if (exhausted) outcomes.push(makePeace(state, aId, bId, ctx));
  }

  return outcomes;
}

function advanceArmies(state: WorldState, aId: CountryId, bId: CountryId): void {
  const a = state.armies[`army:${aId}`];
  const b = state.armies[`army:${bId}`];
  // 两军同地时先打，别让"行军"把会战变成擦肩而过。
  if (a && b && a.locationRegionId === b.locationRegionId) return;

  for (const countryId of [aId, bId]) {
    const enemyId = countryId === aId ? bId : aId;
    const army = state.armies[`army:${countryId}`];
    if (!army) continue;

    const enemyArmy = state.armies[`army:${enemyId}`];
    const enemyInOurLand =
      enemyArmy && state.regions[enemyArmy.locationRegionId]?.countryId === countryId;
    // 弱势一方守土：留在本国境内不动，等对方来攻城（否则两军永远在中间擦肩）。
    const inOwnLand = state.regions[army.locationRegionId]?.countryId === countryId;
    if (!enemyInOurLand && inOwnLand && enemyArmy) {
      if (battlePower(state, army) < battlePower(state, enemyArmy) * 0.85) {
        army.stance = 'defend';
        army.targetRegionId = null;
        continue;
      }
    }
    if (enemyInOurLand) {
      army.stance = 'march';
      army.targetRegionId = enemyArmy.locationRegionId;
    } else if (army.stance !== 'march' || !army.targetRegionId) {
      army.stance = 'march';
      army.targetRegionId = nearestEnemyRegion(state, countryId, enemyId, army.locationRegionId);
    }
    const target = army.targetRegionId;
    if (!target) continue;

    const current = state.regions[army.locationRegionId];
    if (!current) continue;
    if (current.id === target) continue;

    const step = nextStep(state, current.id, target);
    if (step) {
      army.locationRegionId = step;
    }
  }
}

function resolveBattleIfCoLocated(
  state: WorldState,
  content: WorldContent,
  aId: CountryId,
  bId: CountryId,
  ctx: SettleContext,
): WarOutcome | null {
  const a = state.armies[`army:${aId}`];
  const b = state.armies[`army:${bId}`];
  if (!a || !b) return null;
  if (a.locationRegionId !== b.locationRegionId) return null;

  const region = state.regions[a.locationRegionId];
  const powerA = battlePower(state, a);
  const powerB = battlePower(state, b);
  const total = powerA + powerB;
  const attackerWins =
    total <= 0
      ? true
      : ctx.rng.nextFloat({
          stream: 'war',
          entityId: `${aId}:${bId}:${region?.id ?? 'x'}`,
          periodKey: `d${state.clock.day}`,
        }) <
        powerA / total;

  const winner = attackerWins ? a : b;
  const loser = attackerWins ? b : a;
  const winnerCountry = state.countries[winner.countryId];
  const loserCountry = state.countries[loser.countryId];

  const roll = (salt: string): number =>
    ctx.rng.nextFloat({
      stream: 'war-casualty',
      entityId: `${aId}:${bId}:${salt}`,
      periodKey: `d${state.clock.day}`,
    });
  const { casualtyMin, casualtyMax } = content.balance.war;
  const loserRate = casualtyMin + (casualtyMax - casualtyMin) * roll('loser');
  const winnerRate = casualtyMin * 0.5 + (casualtyMax - casualtyMin) * 0.35 * roll('winner');
  const loserLoss = Math.max(1, Math.round(loser.size * loserRate));
  const winnerLoss = Math.max(0, Math.round(winner.size * winnerRate));

  winner.size = Math.max(20, winner.size - winnerLoss);
  loser.size = Math.max(20, loser.size - loserLoss);
  winner.morale = clamp01(winner.morale + 0.08);
  loser.morale = clamp01(loser.morale - 0.18);

  // 败方撤回本国首都。
  const home = loserCountry ? capitalOf(state, loser.countryId) : null;
  if (home) {
    loser.locationRegionId = home.id;
    loser.stance = 'march';
    const enemyId = loser.countryId === aId ? bId : aId;
    loser.targetRegionId = nearestEnemyRegion(state, loser.countryId, enemyId, home.id);
  }

  return {
    kind: 'battle',
    summary: `${region?.name ?? '边境'} 会战：${winnerCountry?.name ?? winner.countryId} 胜，${
      loserCountry?.name ?? loser.countryId
    } 退兵（伤亡 ${winnerLoss}/${loserLoss}）`,
    attackerId: aId,
    defenderId: bId,
    ...(region ? { regionId: region.id } : {}),
    casualties: { attacker: winnerLoss, defender: loserLoss },
  };
}

function resolveSiege(
  state: WorldState,
  aId: CountryId,
  bId: CountryId,
  content: WorldContent,
): WarOutcome | null {
  for (const countryId of [aId, bId]) {
    const enemyId = countryId === aId ? bId : aId;
    const army = state.armies[`army:${countryId}`];
    if (!army) continue;
    const region = state.regions[army.locationRegionId];
    if (!region) continue;
    if (region.countryId !== enemyId) continue;

    if (region.occupiedBy) continue;

    const enemyArmy = state.armies[`army:${enemyId}`];
    const contested =
      enemyArmy &&
      enemyArmy.locationRegionId === region.id &&
      battlePower(state, enemyArmy) > battlePower(state, army) * 0.8;
    if (contested) continue;

    region.siegeProgress += 1;
    if (region.siegeProgress >= content.balance.war.occupationMonths) {
      region.occupiedBy = countryId;
      region.siegeProgress = 0;
      // 占下一座城之后继续推进，别在原地反复"占领"同一块地。
      army.stance = 'march';
      army.targetRegionId = nearestEnemyRegion(state, countryId, enemyId, region.id);
      const attacker = state.countries[countryId];
      const defender = state.countries[enemyId];
      return {
        kind: 'occupation',
        summary: `${attacker?.name ?? countryId} 占领了 ${region.name}（原属 ${
          defender?.name ?? enemyId
        }）`,
        attackerId: countryId,
        defenderId: enemyId,
        regionId: region.id,
      };
    }
    return {
      kind: 'siege',
      summary: `围攻 ${region.name}（进度 ${region.siegeProgress}/${content.balance.war.occupationMonths}）`,
      attackerId: countryId,
      defenderId: enemyId,
      regionId: region.id,
    };
  }
  return null;
}

export function battlePower(state: WorldState, army: Army): number {
  const tactics = army.commanderId ? effectiveSkill(state, army.commanderId, 'tactics') : 0;
  const discipline = 0.75 + army.training * 0.5;
  const spirit = 0.8 + army.morale * 0.4;
  const edge = 1 + Math.max(-0.25, Math.min(0.35, tactics * 0.04));
  return Math.round(army.size * discipline * spirit * edge);
}

export function capitalOf(state: WorldState, countryId: CountryId) {
  const country = state.countries[countryId];
  if (!country) return null;
  return (
    country.regionIds
      .map((id) => state.regions[id])
      .filter((region): region is NonNullable<typeof region> => Boolean(region))
      .sort((a, b) => b.population - a.population)[0] ?? null
  );
}

export function nearestEnemyRegion(
  state: WorldState,
  countryId: CountryId,
  enemyId: CountryId,
  from: RegionId,
): RegionId | null {
  const distances = distancesFrom(state, from);
  const enemy = state.countries[enemyId];
  if (!enemy) return null;
  const candidates = enemy.regionIds
    .filter((id) => state.regions[id])
    .map((id) => ({ id, d: distances.get(id) ?? Infinity }))
    .filter((entry) => Number.isFinite(entry.d))
    .sort((x, y) => x.d - y.d);
  void countryId;
  return candidates[0]?.id ?? null;
}

function nextStep(state: WorldState, from: RegionId, to: RegionId): RegionId | null {
  if (from === to) return null;
  const distances = distancesFrom(state, to);
  const region = state.regions[from];
  if (!region) return null;
  const options = region.links
    .filter((link) => state.regions[link.to])
    .map((link) => ({ id: link.to, d: distances.get(link.to) ?? Infinity }))
    .filter((entry) => Number.isFinite(entry.d))
    .sort((a, b) => a.d - b.d || a.id.localeCompare(b.id));
  return options[0]?.id ?? null;
}

function distancesFrom(state: WorldState, start: RegionId): Map<RegionId, number> {
  const distances = new Map<RegionId, number>([[start, 0]]);
  const queue: RegionId[] = [start];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const region = state.regions[current];
    if (!region) continue;
    const next = (distances.get(current) ?? 0) + 1;
    for (const link of region.links) {
      if (distances.has(link.to)) continue;
      distances.set(link.to, next);
      queue.push(link.to);
    }
  }
  return distances;
}

export function warPairs(state: WorldState): Array<[CountryId, CountryId]> {
  const pairs: Array<[CountryId, CountryId]> = [];
  for (const countryId of sortedIds(state.countries)) {
    const country = state.countries[countryId];
    if (!country) continue;
    for (const enemyId of country.atWarWith) {
      if (countryId < enemyId) pairs.push([countryId, enemyId]);
    }
  }
  return pairs;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number(value.toFixed(4))));
}
