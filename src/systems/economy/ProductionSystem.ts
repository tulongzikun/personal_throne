/**
 * 生产：决定每个地区每月各商品的产出量。
 *
 * `production = min(劳动力上限, 原料/系数, 产能)` 的简化版：
 * -  subsistence 基数（人口自给自足部分，保证没有组织也不会饿死）；
 * -  组织产能（成员 × productionPerWorker × 规模）；
 * -  上限受劳动力供给约束（地区人口的 35%）。
 *
 * 纯函数式：只读状态与内容，把结果写回 `Market.production`，不涉及随机。
 */

import type { GoodId, RegionId, WorldContent, WorldState } from '../../core/WorldState';
import { marketKeyOf, sortedIds } from '../../core/WorldState';

const LABOR_FRACTION = 0.35;
const DEFAULT_SUBSISTENCE_SHARE = 0.2;

export interface ProductionLine {
  readonly regionId: RegionId;
  readonly goodId: GoodId;
  readonly units: number;
  readonly laborUsed: number;
}

export function settleMonthlyProduction(
  state: WorldState,
  content: WorldContent,
): ProductionLine[] {
  const lines: ProductionLine[] = [];
  const { productionPerWorker, stockMonthsTarget } = content.balance.economy;

  for (const regionId of sortedIds(state.regions)) {
    const region = state.regions[regionId];
    if (!region) continue;
    if ((state.tiers[regionId] ?? 3) > 2) continue;

    const laborPool = Math.max(0, Math.round(region.population * LABOR_FRACTION));

    for (const good of content.goods) {
      const market = state.markets[marketKeyOf(regionId, good.id)];
      if (!market) continue;

      const subsistenceShare = good.subsistenceShare ?? DEFAULT_SUBSISTENCE_SHARE;
      const subsistence = Math.round(
        region.population * good.consumptionPerCapita * subsistenceShare,
      );

      let orgOutput = 0;
      for (const orgId of sortedIds(state.organizations)) {
        const org = state.organizations[orgId];
        if (!org || org.homeRegionId !== regionId) continue;
        if (org.industry !== good.id) continue;
        if (org.lifecycle === 'dissolved') continue;
        const scale = Math.max(0.1, org.scale);
        orgOutput += org.members * productionPerWorker * scale * org.efficiency;
      }

      const laborCap = Math.max(0, Math.round(laborPool / Math.max(1, content.goods.length)));
      const laborUsed = Math.min(
        laborCap,
        Math.round(orgOutput / Math.max(0.0001, productionPerWorker)),
      );
      // 产量跟随"当月需求 + 目标库存缺口"，否则单一商品会无限堆积、价格钉死在边界。
      const targetStock = Math.round(market.demand * stockMonthsTarget);
      const desired = Math.max(0, targetStock - market.stock) + market.demand;
      const units = Math.max(
        0,
        Math.round(
          Math.min(
            orgOutput + subsistence,
            Math.max(desired, subsistence),
            laborPool * Math.max(0.5, productionPerWorker),
          ),
        ),
      );

      market.production = units;
      lines.push({ regionId, goodId: good.id, units, laborUsed });
    }
  }

  return lines;
}
