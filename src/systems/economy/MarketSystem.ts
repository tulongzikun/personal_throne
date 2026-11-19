/**
 * 市场：需求、库存与价格。
 *
 * 价格公式（GDD §9.2）：
 *   P' = clamp(P × [1 + α(D − S)/max(D, S, ε)], floor, ceiling)
 * 库存进出：stock' = max(0, stock + production − demand)，缺口由贸易系统补。
 */

import type { WorldContent, WorldState } from '../../core/WorldState';
import { marketKeyOf, sortedIds } from '../../core/WorldState';

export interface MarketMove {
  readonly regionId: string;
  readonly goodId: string;
  readonly priceBefore: number;
  readonly priceAfter: number;
  readonly demand: number;
  readonly supply: number;
  readonly shortage: number;
}

/** 先算需求（人口 × 人均消费，按消费系数缩放），再调价与库存。 */
export function settleMonthlyMarket(state: WorldState, content: WorldContent): MarketMove[] {
  const moves: MarketMove[] = [];
  const { consumptionPerCapitaScale, priceAdjustFloor, priceAdjustCeiling } =
    content.balance.economy;

  for (const marketKey of sortedIds(state.markets)) {
    const market = state.markets[marketKey];
    if (!market) continue;

    const region = state.regions[market.regionId];
    const good = content.goods.find((candidate) => candidate.id === market.goodId);
    if (!region || !good) continue;

    const demand = Math.max(
      1,
      Math.round(region.population * good.consumptionPerCapita * consumptionPerCapitaScale),
    );
    market.demand = demand;

    // 本月投放量 = 本地生产 + 上月到港进口；stock 是缓冲库存，不参与竞价，
    // 否则只要有一个月库存结余，价格就会被永久压到下限。
    const supply = market.production + market.importedUnits;
    const available = market.stock + market.production;
    const shortage = Math.max(0, demand - supply);
    const surplusUnit = Math.max(0, supply - demand) / Math.max(1, demand);

    // 管制会压低有效价格上限：审批/限价让高价难以完全传导。
    const country = state.countries[region.countryId];
    const regulation = country?.policies.regulation ?? 0.5;
    const capRatio = Math.max(0.2, 1 - 0.7 * regulation);
    const effectiveCeiling = Math.round(market.floor + (market.ceiling - market.floor) * capRatio);

    const imbalance = (demand - supply) / Math.max(demand, supply, 1);
    const alpha = Math.min(priceAdjustCeiling, Math.max(priceAdjustFloor, good.alpha));
    // 长期锚定基准价：竞争性供给会让价格缓慢回归，避免一次性冲击永久顶在上下限。
    const anchor = (good.basePrice - market.price) * 0.03;
    const raw = market.price * (1 + alpha * imbalance) + anchor;
    const priceBefore = market.price;
    market.price = Math.round(Math.min(effectiveCeiling, Math.max(market.floor, raw)));

    // 库存结转：先吃库存再吃本月产出；不足则清空（缺口留给贸易）。
    market.stock = Math.max(0, Math.round(available - Math.min(demand, available)));
    market.production = 0;
    market.importedUnits = 0;

    // 价格偏离基准价的可观测指标（sim 报告用，0 = 恰好等于基准价）。
    state.stats.priceDeviationSum += Math.abs(market.price - good.basePrice) / good.basePrice;
    state.stats.priceSamples += 1;

    moves.push({
      regionId: market.regionId,
      goodId: market.goodId,
      priceBefore,
      priceAfter: market.price,
      demand,
      supply,
      shortage: Math.round(shortage * (1 - Math.min(1, surplusUnit * 10))),
    });
  }

  return moves;
}

/** 某商品在某地区的当前价格，未找到返回 0。 */
export function priceOf(state: WorldState, regionId: string, goodId: string): number {
  return state.markets[marketKeyOf(regionId, goodId)]?.price ?? 0;
}
