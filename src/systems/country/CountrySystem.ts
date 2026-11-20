/**
 * 国家系统：月度预算与合法性/稳定性的缓慢演化。
 *
 * 预算（整数铜币，唯一权威在 `Country.treasury`）：
 *   收入 = 人头税（关税与利润税由贸易/财务系统直接入库，不在这里重复计入）
 *   支出 = 军费（militaryShare）+ 行政 + 债务利息
 *   赤字 → 债务，盈余 → 先还债再入国库。
 * 政体变更不在此处——M3 起由"政权更迭"事件链处理。
 */

import type { SettleContext, WorldContent, WorldState } from '../../core/WorldState';
import { sortedIds } from '../../core/WorldState';

export interface CountryBudget {
  readonly countryId: string;
  readonly revenue: number;
  readonly expense: number;
  readonly balance: number;
  /** 可选支出（公共工程），不计入 balance。 */
  readonly publicWorks: number;
  readonly treasuryAfter: number;
  readonly debtAfter: number;
  /** 本月合法性与稳定性的变化量（M4 事件读取用）。 */
  readonly legitimacyDelta: number;
  readonly stabilityDelta: number;
}

const ADMIN_RATE = 0.12;
const HEAD_TAX_PER_CAPITA = 0.1;

export function settleMonthlyCountry(
  state: WorldState,
  content: WorldContent,
  ctx: SettleContext,
): CountryBudget[] {
  const budgets: CountryBudget[] = [];
  const { interestRateMonthly } = content.balance.finance;

  for (const countryId of sortedIds(state.countries)) {
    const country = state.countries[countryId];
    if (!country) continue;

    const regions = country.regionIds.map((id) => state.regions[id]).filter(Boolean);
    const population = regions.reduce((sum, region) => sum + (region?.population ?? 0), 0);
    country.population = population;

    const headTax = Math.round(population * HEAD_TAX_PER_CAPITA * country.policies.taxRate);
    // 关税不再在这里按人口抽象估算：TradeSystem 按到港货值实收并直接进国库，
    // 两套口径并存会导致"同一笔贸易被征两次税"，账目无法对平。
    const revenue = headTax;

    // 公职俸禄：官职表里的月薪由国库支付给在任者；国库付不出时当月欠俸（记入债务压力）。
    let salaries = 0;
    for (const office of country.offices) {
      const holder = state.characters[office.holderId];
      if (!holder || !holder.alive) continue;
      salaries += office.salaryMonthly;
    }
    const military = Math.round(country.policies.militaryShare * (revenue + 100));
    // 管制越重，行政成本越高（审批、稽查、价格管制）。
    const admin = Math.round(revenue * (ADMIN_RATE + 0.04 * country.policies.regulation));
    const interest = Math.round(country.debt * interestRateMonthly);
    const baseExpense = military + admin + interest + salaries;

    // 刚性收支：公共工程属于"有余钱才做"的可选支出，不参与赤字判定。
    const balance = revenue - baseExpense;
    country.treasury += balance;
    if (balance >= 0) {
      for (const office of country.offices) {
        const holder = state.characters[office.holderId];
        if (!holder || !holder.alive) continue;
        holder.wealth += office.salaryMonthly;
        country.treasury -= office.salaryMonthly;
      }
    }
    if (country.treasury < 0) {
      country.debt += -country.treasury;
      country.treasury = 0;
    } else if (country.debt > 0) {
      const repay = Math.min(country.debt, country.treasury);
      country.debt -= repay;
      country.treasury -= repay;
    }

    // 公共工程：国库超过 6 个月刚性开支的部分，一半用于道路/水利/赈济，
    // 既是财政泄压阀，也让"长期盈余 → 国库无限膨胀"不发生。
    const reserveTarget = baseExpense * 30;
    const publicWorks =
      country.treasury > reserveTarget ? Math.round((country.treasury - reserveTarget) * 0.55) : 0;
    country.treasury -= publicWorks;

    country.monthlyRevenue = revenue;
    // 公共工程单独记账：它是有余钱才做的可选支出，不进入赤字压力。
    country.monthlyExpense = baseExpense;
    country.military = Math.max(1, Math.round(military / 10));

    // 治理指标缓慢演化：赤字与短缺侵蚀合法性，稳定与合法性相互支撑。
    const deficitPressure = balance < 0 ? 0.01 : 0;
    const failedChecks = ctx.rng.nextFloat({
      stream: 'country',
      entityId: country.id,
      periodKey: ctx.periodKey,
    });
    const legitimacyBefore = country.legitimacy;
    const stabilityBefore = country.stability;
    country.legitimacy = clamp01(
      country.legitimacy - deficitPressure + (failedChecks > 0.95 ? -0.01 : 0.002),
    );
    country.stability = clamp01(country.stability * 0.98 + country.legitimacy * 0.02 + 0.001);

    budgets.push({
      countryId: country.id,
      revenue,
      expense: baseExpense,
      balance,
      publicWorks,
      treasuryAfter: country.treasury,
      debtAfter: country.debt,
      legitimacyDelta: Number((country.legitimacy - legitimacyBefore).toFixed(4)),
      stabilityDelta: Number((country.stability - stabilityBefore).toFixed(4)),
    });
  }

  return budgets;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number(value.toFixed(4))));
}
