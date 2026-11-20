/**
 * 组织财务：月度损益、市场份额、欠薪、税费、利息与权益变化。
 *
 * 恒等式（R5 的检查对象）：
 *   equity = cash + assets − liabilities
 *   equity_after = equity_before + profit − tax_paid
 * 投资（现金→资产）、借款（现金↑ 负债↑）、还款（现金↓ 负债↓）都不改变权益，
 * 只有经营损益与税费会改变权益。现金不足以支付的成本不会凭空消失：
 * 工资缺口记为欠薪，其余缺口记为应付账款（两者都进 liabilities）。
 *
 * 收入不再只按产量分配：同地区同行业按「价格 / 质量 / 商誉」计算吸引力，
 * 再乘以产能权重得到市场份额（`market.shareByOrg`，份额和 ≈ 1）。
 */

import type { OrgId, WorldContent, WorldState } from '../../core/WorldState';
import { marketKeyOf, sortedIds } from '../../core/WorldState';

export interface FinanceEntry {
  readonly orgId: OrgId;
  readonly revenue: number;
  readonly materialCost: number;
  readonly payroll: number;
  readonly admin: number;
  readonly interest: number;
  readonly tax: number;
  readonly tariff: number;
  readonly transport: number;
  readonly profit: number;
  readonly unpaid: number;
  /** 本月按股份派发的现金分红（权益流出，不属于费用）。 */
  readonly dividends: number;
  readonly marketShare: number;
  readonly equityBefore: number;
  readonly equityAfter: number;
}

const SALES_REALIZATION = 0.9;
const MATERIAL_RATE = 0.3;

export function equityOf(org: { cash: number; assets: number; liabilities: number }): number {
  return org.cash + org.assets - org.liabilities;
}

interface Position {
  share: number;
  sellable: number;
  output: number;
  price: number;
}

export function settleMonthlyFinance(state: WorldState, content: WorldContent): FinanceEntry[] {
  const entries: FinanceEntry[] = [];
  const { interestRateMonthly, profitTaxRate, adminRateOfRevenue } = content.balance.finance;
  const positions = computePositions(state, content);

  for (const orgId of sortedIds(state.organizations)) {
    const org = state.organizations[orgId];
    if (!org) continue;
    if ((state.tiers[org.id] ?? 3) > 2) continue;
    if (org.lifecycle === 'dissolved') continue;

    const position = positions.get(org.id);
    const price = position?.price ?? fallbackPrice(state, org);
    const sellable = position?.sellable ?? 0;
    const revenue = Math.round(sellable * price * SALES_REALIZATION);
    const materialCost = Math.round(revenue * MATERIAL_RATE);
    const payroll = org.payrollMonthly;
    const admin = Math.round(revenue * adminRateOfRevenue) + Math.round(payroll * 0.05);
    // 风险溢价：破产风险越高，债权人要求的利率越高（系数表在 balance.risk）。
    const rate = interestRateMonthly + org.risk.bankruptcy * 0.005;
    const interest = Math.round(org.liabilities * rate);

    // 贸易口径：tradeCost 由 TradeSystem 汇总（发船时 采购+运费，到港补关税），
    // 现金已在发生时扣过，这里只做损益归集，避免运费/关税重复计。
    const tradeRevenue = Math.max(0, org.lastMonthTradeRevenue);
    const tradeCogs = Math.max(0, org.tradeCost);
    org.tradeCost = 0;
    org.lastMonthTransport = 0;
    org.lastMonthTariff = 0;
    org.lastMonthTradeRevenue = 0;

    const grossProfit =
      revenue + tradeRevenue - tradeCogs - materialCost - payroll - admin - interest;
    // 有效税率随国家税制变化：政策税率 0.1 → 基准的 75%，0.35 → 基准的 137.5%。
    const homeRegion = state.regions[org.homeRegionId];
    const taxCountry = homeRegion ? state.countries[homeRegion.countryId] : undefined;
    const effectiveTaxRate = clamp(
      taxCountry ? profitTaxRate * (0.5 + taxCountry.policies.taxRate * 2.5) : profitTaxRate,
      0.02,
      0.5,
    );
    const tax = grossProfit > 0 ? Math.round(grossProfit * effectiveTaxRate) : 0;

    const equityBefore = equityOf(org);
    const net =
      org.cash + revenue + tradeRevenue - tradeCogs - materialCost - admin - interest - tax;
    let wagesPaid = payroll;
    let unpaid = 0;
    let arrears = 0;
    if (net < 0) {
      unpaid = payroll;
      wagesPaid = 0;
      arrears = -net;
    } else if (net < payroll) {
      unpaid = payroll - net;
      wagesPaid = net;
    }
    org.cash = Math.max(0, net - wagesPaid);
    org.unpaidWages += unpaid;
    org.liabilities += unpaid + arrears;

    org.lastMonthRevenue = revenue + tradeRevenue;
    org.lastMonthCost = tradeCogs + materialCost + payroll + admin + interest + tax;
    org.lastMonthProfit = grossProfit - tax;
    state.stats.profitTotal += org.lastMonthProfit;
    org.lastMonthTax = tax;
    org.marketShare = position?.share ?? 0;

    // 税费进入所属国家国库（M3 起按政策与腐败系数打折）。
    const region = state.regions[org.homeRegionId];
    const country = region ? state.countries[region.countryId] : undefined;
    if (country && tax > 0) country.treasury += tax;

    // 现金恢复后先补欠薪：现金↓、负债↓，权益不变。
    if (org.unpaidWages > 0 && org.cash > payroll * 2) {
      const repay = Math.min(org.unpaidWages, Math.round(org.cash - payroll * 2));
      if (repay > 0) {
        org.cash -= repay;
        org.liabilities = Math.max(0, org.liabilities - repay);
        org.unpaidWages -= repay;
      }
    }

    // 留存现金超过 12 个月工资的部分转为资产（再投资），避免现金无限堆积；
    // 现金 → 资产不改变权益，只改变结构；资产上限为两年工资，防止规模失控。
    const buffer = org.payrollMonthly * 12;
    const assetRoom = Math.max(0, org.payrollMonthly * 24 - org.assets);
    if (org.cash > buffer && assetRoom > 0) {
      const invest = Math.min(Math.round(org.cash - buffer), assetRoom);
      org.cash -= invest;
      org.assets += invest;
    }

    // 分红：盈利且现金厚于三个月工资时，把当月净利润的 30% 按股份分给在世股东。
    // 现金与损益同时减少，权益不变；未登记股份对应的分红留在组织里。
    const profitAfterTax = grossProfit - tax;
    let dividends = 0;
    if (profitAfterTax > 0 && org.cash > payroll * 3) {
      const pool = Math.round(profitAfterTax * 0.3);
      let paid = 0;
      if (pool > 0) {
        for (const holder of org.shares) {
          const character = state.characters[holder.characterId];
          if (!character || !character.alive) continue;
          const amount = Math.round(pool * holder.share);
          if (amount <= 0) continue;
          character.wealth += amount;
          paid += amount;
        }
      }
      if (paid > 0) {
        org.cash = Math.max(0, org.cash - paid);
        state.stats.dividendsPaid += paid;
        dividends = paid;
      }
    }

    entries.push({
      orgId: org.id,
      revenue,
      materialCost,
      payroll: wagesPaid,
      admin,
      interest,
      tax,
      tariff: 0,
      transport: 0,
      profit: grossProfit,
      unpaid,
      dividends,
      marketShare: org.marketShare,
      equityBefore,
      equityAfter: equityOf(org),
    });
  }

  return entries;
}

/** 计算同地区同行业各组织的市场份额与可售量。 */
function computePositions(state: WorldState, content: WorldContent): Map<OrgId, Position> {
  const positions = new Map<OrgId, Position>();
  const { productionPerWorker } = content.balance.economy;
  const { qualityWeight, reputationWeight, priceWeight } = content.balance.market;

  const groups = new Map<string, OrgId[]>();
  for (const orgId of sortedIds(state.organizations)) {
    const org = state.organizations[orgId];
    if (!org || org.lifecycle === 'dissolved') continue;
    if ((state.tiers[org.id] ?? 3) > 2) continue;
    const key = `${org.homeRegionId}:${org.industry}`;
    const list = groups.get(key) ?? [];
    list.push(org.id);
    groups.set(key, list);
  }

  for (const [key, ids] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const [regionId, industry] = key.split(':') as [string, string];
    const market =
      industry === 'service' ? undefined : state.markets[marketKeyOf(regionId, industry)];
    const demand =
      market && market.demand > 0
        ? market.demand
        : Math.max(1, Math.round((state.regions[regionId]?.population ?? 0) * 0.01));

    const outputs: number[] = [];
    const weights: number[] = [];
    for (const id of ids) {
      const org = state.organizations[id];
      if (!org) continue;
      // 定价指数向战略目标缓慢漂移：扩张 = 低价换份额，收缩 = 高价保利润。
      const target = org.strategy === 'expand' ? 0.9 : org.strategy === 'contract' ? 1.08 : 1;
      org.priceIndex = Number(
        Math.min(1.4, Math.max(0.7, org.priceIndex + (target - org.priceIndex) * 0.12)).toFixed(4),
      );
      const quality = 0.35 + 0.65 * org.efficiency;
      const reputation =
        0.35 + 0.4 * Math.max(0, org.governance) + 0.25 * Math.max(0, org.leadership.legitimacy);
      const attractiveness =
        (Math.pow(quality, qualityWeight) * Math.pow(reputation, reputationWeight)) /
        Math.pow(Math.max(0.25, org.priceIndex), priceWeight);
      const capital = 1 + 0.12 * Math.log1p(org.assets / Math.max(1, org.payrollMonthly * 6));
      outputs.push(
        org.members * productionPerWorker * Math.max(0.1, org.scale) * org.efficiency * capital,
      );
      weights.push(attractiveness);
    }

    const totalOutput = outputs.reduce((sum, value) => sum + value, 0);
    const rawWeights = weights.map((weight, index) => {
      const capacity = totalOutput > 0 ? (outputs[index] as number) / totalOutput : 0;
      return weight * (0.6 + 0.4 * capacity);
    });
    const totalWeight = rawWeights.reduce((sum, value) => sum + value, 0);

    if (market) market.shareByOrg = {};
    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index] as OrgId;
      const org = state.organizations[id];
      if (!org) continue;
      const share = totalWeight > 0 ? (rawWeights[index] as number) / totalWeight : 1 / ids.length;
      const output = outputs[index] as number;
      const sellable =
        industry === 'service' ? output : Math.min(output, Math.max(0, demand) * share);
      const price =
        industry === 'service'
          ? Math.max(
              1,
              Math.round((org.payrollMonthly / Math.max(1, org.members)) * org.priceIndex),
            )
          : Math.round((market?.price ?? fallbackPrice(state, org)) * org.priceIndex);
      if (market) market.shareByOrg[id] = Number(share.toFixed(6));
      positions.set(id, { share, sellable, output, price });
    }
  }

  return positions;
}

function fallbackPrice(state: WorldState, org: { homeRegionId: string; industry: string }): number {
  if (org.industry === 'service') return 1;
  const market = state.markets[marketKeyOf(org.homeRegionId, org.industry)];
  return market?.price ?? 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
