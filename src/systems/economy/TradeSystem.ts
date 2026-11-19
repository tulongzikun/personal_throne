/**
 * 贸易：沿地区商路把盈余运往缺口市场。
 *
 * 简化规则（MVP）：
 * - 只在同一国家的陆路/海路之间调运（跨境要等 M3 的关税与许可）；
 * - 单次调运量 = min(来源盈余, 对方缺口, 商路运力, 来源出口上限)；
 * - 运输成本 = 天数 × 单位运费，计入来源组织的运输成本；
 * - 调运本身不改变"总库存"，只改变分布（便于会计恒等式校验）。
 */

import type { WorldContent, WorldState } from '../../core/WorldState';
import { marketKeyOf, sortedIds } from '../../core/WorldState';

const UNIT_TRANSPORT_COST = 1;

export interface TradeFlow {
  readonly from: string;
  readonly to: string;
  readonly goodId: string;
  readonly units: number;
  readonly transportCost: number;
}

export function settleMonthlyTrade(state: WorldState, content: WorldContent): TradeFlow[] {
  const flows: TradeFlow[] = [];

  for (const regionId of sortedIds(state.regions)) {
    const region = state.regions[regionId];
    if (!region) continue;
    if ((state.tiers[regionId] ?? 3) > 2) continue;

    for (const good of content.goods) {
      const source = state.markets[marketKeyOf(regionId, good.id)];
      if (!source) continue;

      const targetStock = Math.round(source.demand * content.balance.economy.stockMonthsTarget);
      const surplus = Math.max(0, source.stock - targetStock);
      if (surplus <= 0) continue;

      for (const link of [...region.links].sort((a, b) => (a.to < b.to ? -1 : 1))) {
        if (surplus <= 0 && flows.length > 0) break;
        const neighbour = state.regions[link.to];
        if (!neighbour || neighbour.countryId !== region.countryId) continue;

        const destination = state.markets[marketKeyOf(link.to, good.id)];
        if (!destination) continue;

        const gap = Math.max(0, destination.demand - (destination.stock + destination.production));
        if (gap <= 0) continue;

        const available = Math.max(0, source.stock - targetStock);
        const units = Math.min(
          available,
          gap,
          link.capacity,
          source.exportCapacity + Math.round(link.capacity / 2),
        );
        if (units <= 0) continue;

        source.stock -= units;
        destination.stock += units;

        const transportCost = Math.round(units * UNIT_TRANSPORT_COST * Math.max(1, link.days));
        flows.push({
          from: regionId,
          to: link.to,
          goodId: good.id,
          units,
          transportCost,
        });
      }
    }
  }

  // 运输成本从本地区最大贸易组织扣除（没有组织则由本地商户承担，不产生负债）。
  for (const flow of flows) {
    const candidates = Object.values(state.organizations)
      .filter((org) => org.homeRegionId === flow.from && org.assets > 0)
      .sort((a, b) => b.assets - a.assets);
    const payer = candidates[0];
    if (payer) {
      // 只登记成本，实际扣现由 Finance 一次性完成，保证
      // equity 恒等式（cash + assets − liabilities）成立。
      payer.lastMonthTransport += flow.transportCost;
    }
  }

  return flows;
}
