/**
 * 区域间贸易（M2）：商路运力、运输延迟、在途损耗与跨国关税。
 *
 * 关键规则：
 * - 离港即从来源库存扣货，抵达日才进入目的地库存（`state.shipments` 可观测）；
 * - 运力 = min(链路容量, 缺口) + 目的地商路扩容（open_route 投资）；
 * - 商路所有者 = 开通该地区商路的组织（`market.routeOwnerId`），否则为来源地
 *   资产最大的组织；所有者按来源价买货、按目的地价卖出，自负运费与关税；
 * - 跨国货流按目的地国家 `tariffRate` 收关税，进入该国国库（可审计）。
 */

import type { OrgId, RegionId, TradeFlow, WorldContent, WorldState } from '../../core/WorldState';
import { marketKeyOf, sortedIds } from '../../core/WorldState';
import { priceOf } from '../economy/MarketSystem';

export interface TradeSettlement {
  readonly flows: readonly TradeFlow[];
  readonly arrivals: readonly ShipmentArrival[];
}

export interface ShipmentArrival {
  readonly id: string;
  readonly orgId: OrgId | null;
  readonly goodId: string;
  readonly units: number;
  readonly lost: number;
  readonly revenue: number;
  readonly tariff: number;
}

export function settleMonthlyTrade(state: WorldState, content: WorldContent): TradeSettlement {
  const arrivals = settleShipments(state, content);
  const flows = planFlows(state, content);
  return { flows, arrivals };
}

/** 处理到港货物：损耗后入库，所有者收货款、付关税。 */
export function settleShipments(state: WorldState, content: WorldContent): ShipmentArrival[] {
  const arrivals: ShipmentArrival[] = [];
  for (const id of sortedIds(state.shipments)) {
    const shipment = state.shipments[id];
    if (!shipment || shipment.status !== 'in_transit') continue;
    if (state.clock.day < shipment.arriveDay) continue;

    const arrived = Math.max(0, shipment.units - shipment.lost);
    const destination = state.markets[marketKeyOf(shipment.toRegionId, shipment.goodId)];
    if (!destination) {
      delete state.shipments[id];
      continue;
    }
    destination.stock += arrived;
    // 进口进入"待计价供给"：下个月的市场结算把到港量计入供给，
    // 否则本地无产能的地区即使买到了货，价格仍会一路顶到上限。
    destination.importedUnits += arrived;

    const destinationRegion = state.regions[shipment.toRegionId];
    const country = destinationRegion ? state.countries[destinationRegion.countryId] : undefined;
    const owner = shipment.ownerOrgId ? state.organizations[shipment.ownerOrgId] : undefined;

    let tariff = 0;
    if (content.balance.trade.tariffEnabled && country && shipment.tariffDue > 0) {
      tariff = shipment.tariffDue;
      const pay = Math.min(owner?.cash ?? 0, tariff);
      if (owner) {
        owner.cash -= pay;
        owner.liabilities += tariff - pay;
        owner.lastMonthTariff += tariff;
      }
      country.treasury += tariff;
      state.stats.tariffRevenue += tariff;
    }

    let revenue = 0;
    if (owner) {
      // 贸易按目的地市价的 95% 成交（批发折扣小于本地零售的 10%）。
      revenue = Math.round(arrived * destination.price * 0.95);
      owner.cash += revenue;
      owner.tradeRevenue += revenue;
      owner.lastMonthTradeRevenue += revenue;
      owner.tradeCost += shipment.transportCost + tariff;
      owner.lastMonthTransport += shipment.transportCost;
      state.stats.tradeRevenue += revenue;
      state.stats.tradeCost += shipment.transportCost + tariff;
    }

    arrivals.push({
      id: shipment.id,
      orgId: shipment.ownerOrgId,
      goodId: shipment.goodId,
      units: arrived,
      lost: shipment.lost,
      revenue,
      tariff,
    });
    delete state.shipments[id];
  }
  return arrivals;
}

/** 按月规划新的货流：来源剩余 → 目的地缺口，受运力与现金约束。 */
function planFlows(state: WorldState, content: WorldContent): TradeFlow[] {
  const flows: TradeFlow[] = [];
  const { stockMonthsTarget } = content.balance.economy;
  const { unitTransportCost, lossRate } = content.balance.trade;

  for (const regionId of sortedIds(state.regions)) {
    const region = state.regions[regionId];
    if (!region) continue;
    for (const link of region.links) {
      const target = state.regions[link.to];
      if (!target) continue;
      // 双向链接只处理一次，按 ID 字典序定向。
      if (region.id > target.id) continue;

      for (const good of content.goods) {
        const source = state.markets[marketKeyOf(region.id, good.id)];
        const dest = state.markets[marketKeyOf(target.id, good.id)];
        if (!source || !dest) continue;

        const surplus = source.stock - source.demand * Math.min(1, stockMonthsTarget * 0.6);
        const gap = Math.max(0, dest.demand - (dest.stock + dest.production));
        if (surplus <= 0 || gap <= 0) continue;

        const market = state.markets[marketKeyOf(target.id, good.id)];
        const destinationRegion = state.regions[target.id];
        const country = destinationRegion
          ? state.countries[destinationRegion.countryId]
          : undefined;
        const sameCountry = region.countryId === target.countryId;
        const freedom = country?.policies.tradeFreedom ?? 0.5;
        const routeOwner = market?.routeOwnerId
          ? state.organizations[market.routeOwnerId]
          : undefined;
        const owner =
          routeOwner && routeOwner.lifecycle !== 'dissolved'
            ? routeOwner
            : pickOwner(state, region.id);

        // 贸易开放度提高商路有效容量，也放大玩家/组织开通的进口配额。
        const routeCapacity = Math.round(link.capacity * (0.7 + 0.6 * freedom));
        const importBoost = market ? Math.round(market.importCapacity * (0.5 + freedom)) : 0;
        const capacity = Math.min(routeCapacity + importBoost, surplus, gap);
        if (capacity <= 0) continue;

        // 批发采购：按来源地市价的 90% 买入，留出贸易利差。
        const purchasePrice = Math.max(1, Math.round(priceOf(state, region.id, good.id) * 0.9));
        const freight = Math.round(unitTransportCost * Math.max(1, link.days));
        const tariffPerUnit =
          content.balance.trade.tariffEnabled && !sameCountry && country
            ? Math.round(dest.price * country.policies.tariffRate)
            : 0;
        const costPerUnit = purchasePrice + freight + tariffPerUnit;
        // 亏损的货流不会发船：预期售价不足以覆盖采购、运费与关税时跳过。
        const expectedRevenue = Math.round(dest.price * 0.95);
        if (expectedRevenue - costPerUnit < 0) continue;
        const affordable = owner ? Math.floor(owner.cash / Math.max(1, costPerUnit)) : capacity;
        const units = Math.min(capacity, affordable);
        if (units <= 0) continue;

        const purchase = units * purchasePrice;
        const transportCost = Math.round(units * unitTransportCost * Math.max(1, link.days));
        // 开放度降低在途损耗（保险、港口效率、更成熟的商路）。
        const lost = Math.round(units * lossRate * (1 - 0.3 * freedom));

        if (owner) {
          owner.cash -= purchase + transportCost;
          owner.tradeInvestment += purchase;
          owner.tradeCost += transportCost;
          owner.lastMonthTransport += transportCost;
        }
        source.stock = Math.max(0, source.stock - units);

        const tariffDue =
          content.balance.trade.tariffEnabled && !sameCountry && country
            ? Math.round(units * dest.price * country.policies.tariffRate)
            : 0;

        const shipmentId = `sh_${state.clock.day}_${region.id}_${target.id}_${good.id}`;
        state.shipments[shipmentId] = {
          id: shipmentId,
          fromRegionId: region.id,
          toRegionId: target.id,
          goodId: good.id,
          units,
          lost,
          ownerOrgId: owner?.id ?? null,
          departDay: state.clock.day,
          arriveDay: state.clock.day + Math.max(1, link.days),
          transportCost,
          tariffDue,
          status: 'in_transit',
        };

        flows.push({
          from: region.id,
          to: target.id,
          goodId: good.id,
          units,
          transportCost,
          tariff: tariffDue,
          arriveDay: state.clock.day + Math.max(1, link.days),
          ownerOrgId: owner?.id ?? null,
        });
      }
    }
  }
  return flows;
}

function pickOwner(
  state: WorldState,
  regionId: RegionId,
): WorldState['organizations'][string] | undefined {
  let best: WorldState['organizations'][string] | undefined;
  for (const id of sortedIds(state.organizations)) {
    const org = state.organizations[id];
    if (!org || org.lifecycle === 'dissolved') continue;
    if (org.homeRegionId !== regionId) continue;
    if (!best || org.assets > best.assets) best = org;
  }
  return best;
}
