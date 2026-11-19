/**
 * 模拟分层（L1/L2/L3）：决定"谁被精细模拟"。
 *
 * 规则（开发计划 §7.3）：
 * - L1：玩家本人、玩家所在地区与组织、当前冒险相关实体；
 * - L2：与 L1 直接相连的地区/组织/国家（距离 ≤2 跳、同国、有合同关系、规模突出）；
 * - L3：其余宏观聚合。
 *
 * 升降级带滞回（promote/demote 双阈值），避免实体在层间抖动造成的状态跳变。
 * 降级时先把可聚合字段折算成宏观值（`aggregateRegion`），保证"按已存宏观状态展开"。
 */

import type { CountryId, EntityId, OrgId, RegionId, WorldContent, WorldState } from './WorldState';
import { sortedIds } from './WorldState';

export type Tier = 1 | 2 | 3;

export interface TierReport {
  readonly tiers: Record<EntityId, Tier>;
  readonly counts: Record<Tier, number>;
}

/** 地区图上的最短跳数；不可达返回 Infinity。 */
export function regionDistance(state: WorldState, from: RegionId, to: RegionId): number {
  if (from === to) return 0;
  const visited = new Set<RegionId>([from]);
  let frontier: RegionId[] = [from];
  for (let hops = 1; hops <= 8; hops += 1) {
    const next: RegionId[] = [];
    for (const id of frontier) {
      const region = state.regions[id];
      if (!region) continue;
      for (const link of region.links) {
        if (visited.has(link.to)) continue;
        if (link.to === to) return hops;
        visited.add(link.to);
        next.push(link.to);
      }
    }
    if (next.length === 0) break;
    frontier = next.sort();
  }
  return Number.POSITIVE_INFINITY;
}

function normalize(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/** 重新计算分层。纯函数：同状态 → 同结果（不读随机）。 */
export function computeTiers(state: WorldState, content: WorldContent): TierReport {
  const { promoteThreshold, demoteThreshold, distanceWeight, relationWeight, scaleWeight } =
    content.balance.tiers;

  const player = state.characters[state.playerId];
  const focusRegion = player ? player.regionId : (sortedIds(state.regions)[0] ?? '');
  const focusCountry = state.regions[focusRegion]?.countryId ?? '';
  const focusOrgs = new Set<OrgId>();
  if (player?.organizationId) focusOrgs.add(player.organizationId);
  for (const org of Object.values(state.organizations)) {
    if (org.leadership.leaderId === state.playerId) focusOrgs.add(org.id);
    if (org.shares.some((share) => share.characterId === state.playerId)) focusOrgs.add(org.id);
  }

  const tiers: Record<EntityId, Tier> = {};

  /** 分数越高越该被精细模拟。 */
  const previous = (id: EntityId): Tier => state.tiers[id] ?? 3;
  const decide = (id: EntityId, score: number): Tier => {
    const before = previous(id);
    if (before === 1 && score >= demoteThreshold) return 1;
    if (before <= 2 && score >= demoteThreshold * 0.5) return 2;
    if (score >= promoteThreshold) return 2;
    return before === 1 ? 1 : 3;
  };

  // 地区：玩家所在地 L1；2 跳内（含跨国相邻）L2；更远按分数与滞回决定。
  // MVP 只有 5 个地区，全部落在 2 跳内，因此"边缘地区冻结"不会发生。
  for (const region of Object.values(state.regions)) {
    if (region.id === focusRegion) {
      tiers[region.id] = 1;
      continue;
    }
    const distance = regionDistance(state, focusRegion, region.id);
    const sameCountry = region.countryId === focusCountry;
    const score =
      distanceWeight * (1 - normalize(distance, 0, 6)) + relationWeight * (sameCountry ? 1 : 0);
    if (distance <= 2) {
      tiers[region.id] = 2;
      continue;
    }
    tiers[region.id] = decide(region.id, score);
  }

  // 组织：玩家控制 L1；位于 L1/L2 地区的 L2；其余按规模分数与滞回。
  const maxAssets = Math.max(1, ...Object.values(state.organizations).map((org) => org.assets));
  for (const org of Object.values(state.organizations)) {
    if (focusOrgs.has(org.id)) {
      tiers[org.id] = 1;
      continue;
    }
    const regionTier = tiers[org.homeRegionId] ?? 3;
    const scaleScore = scaleWeight * normalize(org.assets, 0, maxAssets);
    if (regionTier <= 2) {
      tiers[org.id] = 2;
      continue;
    }
    const nearScore = distanceWeight * 0.2;
    tiers[org.id] = decide(org.id, nearScore + scaleScore);
  }

  // 人物：玩家 L1；其所在地区或所属组织处于 L1/L2 的 L2；其余 L3。
  // 人物没有独立的地理图，按"所在地区 / 所属组织"继承层级，避免角色事件永久静默。
  for (const character of Object.values(state.characters)) {
    if (character.id === state.playerId) {
      tiers[character.id] = 1;
      continue;
    }
    const regionTier = tiers[character.regionId] ?? 3;
    const orgTier = character.organizationId ? (tiers[character.organizationId] ?? 3) : 3;
    tiers[character.id] = Math.min(regionTier, orgTier) <= 2 ? 2 : 3;
  }

  // 国家：玩家所在国 L2；含 L1/L2 地区的国家 L2；其余 L3。
  for (const country of Object.values(state.countries)) {
    if (country.id === focusCountry) {
      tiers[country.id] = 2;
      continue;
    }
    const hasNearRegion = country.regionIds.some((id) => (tiers[id] ?? 3) <= 2);
    tiers[country.id] = hasNearRegion ? 2 : 3;
  }

  const counts: Record<Tier, number> = { 1: 0, 2: 0, 3: 0 };
  for (const tier of Object.values(tiers)) counts[tier] += 1;

  return { tiers, counts };
}

/** 应用分层结果（保留 `WorldState.tiers` 为唯一事实来源）。 */
export function applyTiers(state: WorldState, report: TierReport): void {
  state.tiers = { ...report.tiers };
}

/** 国家的人口/经济聚合值，供 L3 宏观展示与事件使用。 */
export function aggregateCountry(
  state: WorldState,
  countryId: CountryId,
): {
  readonly population: number;
  readonly marketValue: number;
  readonly organizationValue: number;
} {
  const country = state.countries[countryId];
  if (!country) return { population: 0, marketValue: 0, organizationValue: 0 };
  const regionIds = new Set(country.regionIds);
  let population = 0;
  let marketValue = 0;
  for (const regionId of regionIds) {
    const region = state.regions[regionId];
    if (region) population += region.population;
    for (const market of Object.values(state.markets)) {
      if (market.regionId === regionId) marketValue += market.stock * market.price;
    }
  }
  let organizationValue = 0;
  for (const org of Object.values(state.organizations)) {
    if (regionIds.has(org.homeRegionId)) organizationValue += org.assets;
  }
  return { population, marketValue, organizationValue };
}
