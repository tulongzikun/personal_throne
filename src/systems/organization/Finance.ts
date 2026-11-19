/**
 * 组织财务：月度损益、税费、利息与权益变化。
 *
 * 恒等式（R5 的检查对象）：
 *   equity = cash + assets − liabilities
 *   equity_after = equity_before + profit − tax_paid
 * 投资（现金→资产）、借款（现金↑ 负债↑）、还款（现金↓ 负债↓）都不改变权益，
 * 只有经营损益与税费会改变权益。任何偏离都说明记账有 bug。
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
  readonly profit: number;
  readonly equityBefore: number;
  readonly equityAfter: number;
}

const SALES_REALIZATION = 0.9;
const MATERIAL_RATE = 0.3;

export function equityOf(org: { cash: number; assets: number; liabilities: number }): number {
  return org.cash + org.assets - org.liabilities;
}

export function settleMonthlyFinance(state: WorldState, content: WorldContent): FinanceEntry[] {
  const entries: FinanceEntry[] = [];
  const { interestRateMonthly, profitTaxRate, adminRateOfRevenue } = content.balance.finance;
  const { productionPerWorker } = content.balance.economy;

  for (const orgId of sortedIds(state.organizations)) {
    const org = state.organizations[orgId];
    if (!org) continue;
    if ((state.tiers[org.id] ?? 3) > 2) continue;
    if (org.lifecycle === 'dissolved') continue;

    const price =
      org.industry === 'service'
        ? Math.max(1, Math.round(org.payrollMonthly / Math.max(1, org.members)))
        : (priceOfIndustry(state, org, content) ?? 0);

    const output = org.members * productionPerWorker * Math.max(0.1, org.scale) * org.efficiency;
    // 只有卖得掉的产量才算收入：同地区同行业的组织按产量份额瓜分当月需求，
    // 否则组织会凭空"卖出"超过市场需求的货，现金与国库无限膨胀。
    const sellable = org.industry === 'service' ? output : sellableUnits(state, org, output);
    const revenue = Math.round(sellable * price * SALES_REALIZATION);
    const materialCost = Math.round(revenue * MATERIAL_RATE);
    const payroll = Math.min(org.cash + revenue, org.payrollMonthly);
    const admin = Math.round(revenue * adminRateOfRevenue) + Math.round(payroll * 0.05);
    const interest = Math.round(org.liabilities * interestRateMonthly);

    // 运输成本只来自本月贸易登记；lastMonthCost 是上月合计，不能再次计入。
    const transportCost = Math.max(0, org.lastMonthTransport);
    org.lastMonthTransport = 0;
    const grossProfit = revenue - materialCost - payroll - admin - interest - transportCost;
    const tax = grossProfit > 0 ? Math.round(grossProfit * profitTaxRate) : 0;

    const equityBefore = equityOf(org);
    org.cash = Math.max(0, org.cash + grossProfit - tax);
    org.lastMonthRevenue = revenue;
    org.lastMonthCost = materialCost + payroll + admin + interest + transportCost + tax;
    // 税费进入所属国家国库（M3 起按政策与腐败系数打折）。
    const region = state.regions[org.homeRegionId];
    const country = region ? state.countries[region.countryId] : undefined;
    if (country && tax > 0) country.treasury += tax;

    // 留存现金超过 12 个月工资的部分转为资产（再投资），避免现金无限堆积；
    // 现金 → 资产不改变权益，只改变结构。
    const buffer = org.payrollMonthly * 12;
    if (org.cash > buffer) {
      const invest = Math.round(org.cash - buffer);
      org.cash -= invest;
      org.assets += invest;
    }

    // 经营好坏驱动生命周期迁移。
    org.lifecycle = nextLifecycle(org, grossProfit);

    entries.push({
      orgId: org.id,
      revenue,
      materialCost,
      payroll,
      admin,
      interest,
      tax,
      profit: grossProfit,
      equityBefore,
      equityAfter: equityOf(org),
    });
  }

  return entries;
}

/** 按产量份额把当月市场可吸纳量分配给组织（最多等于自身产量）。 */
function sellableUnits(
  state: WorldState,
  org: { homeRegionId: string; industry: string; id: string },
  output: number,
): number {
  const market = state.markets[marketKeyOf(org.homeRegionId, org.industry)];
  if (!market) return output;
  let regionalOutput = 0;
  for (const other of Object.values(state.organizations)) {
    if (other.homeRegionId !== org.homeRegionId) continue;
    if (other.industry !== org.industry) continue;
    if (other.lifecycle === 'dissolved') continue;
    regionalOutput += other.members * 8 * Math.max(0.1, other.scale) * other.efficiency;
  }
  if (regionalOutput <= 0) return 0;
  const share = output / regionalOutput;
  return Math.min(output, market.demand * share);
}

function priceOfIndustry(
  state: WorldState,
  org: { homeRegionId: string; industry: string },
  content: WorldContent,
): number | null {
  if (org.industry === 'service') return null;
  const good = content.goods.find((candidate) => candidate.id === org.industry);
  if (!good) return null;
  const market = state.markets[marketKeyOf(org.homeRegionId, good.id)];
  return market?.price ?? good.basePrice;
}

function nextLifecycle(
  org: {
    cash: number;
    payrollMonthly: number;
    liabilities: number;
    assets: number;
    lifecycle: string;
  },
  profit: number,
):
  | 'founded'
  | 'growing'
  | 'stable'
  | 'expanding'
  | 'crisis'
  | 'restructuring'
  | 'shrinking'
  | 'dissolved' {
  const monthsOfPayroll =
    org.payrollMonthly > 0 ? org.cash / org.payrollMonthly : Number.POSITIVE_INFINITY;

  if (org.lifecycle === 'crisis') {
    if (profit > 0 && monthsOfPayroll >= 3) return 'stable';
    if (org.liabilities > org.assets && monthsOfPayroll < 1) return 'restructuring';
    return 'crisis';
  }
  if (org.lifecycle === 'restructuring') {
    if (profit > 0 && monthsOfPayroll >= 2) return 'stable';
    return 'restructuring';
  }
  if (monthsOfPayroll < 1) return 'crisis';
  if (profit < 0 && monthsOfPayroll < 2) return 'shrinking';
  if (profit > 0 && monthsOfPayroll >= 6) return 'expanding';
  if (profit > 0) return 'growing';
  return 'stable';
}
