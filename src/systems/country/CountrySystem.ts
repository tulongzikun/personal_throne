/**
 * 国家系统：月度预算与合法性/稳定性的缓慢演化。
 *
 * 预算（整数铜币，唯一权威在 `Country.treasury`）：
 *   收入 = 人头税（关税与利润税由贸易/财务系统直接入库，不在这里重复计入）
 *   支出 = 军费（militaryShare）+ 行政 + 债务利息
 *   赤字 → 债务，盈余 → 先还债再入国库。
 * 政体变更不在此处——M3 起由"政权更迭"事件链处理。
 */

import type { Country, SettleContext, WorldContent, WorldState } from '../../core/WorldState';
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
    if (!country || country.extinct) continue;

    // 灭国状态机：领土被别人全部占走的国家先挂账 48 个月（可能被和约还回来），
    // 之后判定灭亡——清掉债务、退出所有战争与外交，避免"0 地区 0 人口却背着 9 亿国债"。
    if (country.regionIds.length === 0) {
      country.vacantMonths += 1;
      country.population = 0;
      country.monthlyRevenue = 0;
      country.monthlyExpense = 0;
      if (country.vacantMonths >= 48) {
        country.extinct = true;
        country.treasury = 0;
        country.debt = 0;
        country.creditors = {};
        country.atWarWith = [];
        country.warExhaustion = 0;
        country.military = 0;
        for (const other of Object.values(state.countries)) {
          other.atWarWith = other.atWarWith.filter((id) => id !== countryId);
          delete other.diplomacy[countryId];
        }
      }
      continue;
    }
    country.vacantMonths = 0;

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
    payCreditors(state, country, interest);
    const baseExpense = military + admin + interest + salaries;

    // 刚性收支：公共工程属于"有余钱才做"的可选支出，不参与赤字判定。
    const balance = revenue - baseExpense;
    country.treasury += balance;
    // 俸禄在 baseExpense 里已经扣过一次，这里只把钱记到在任者名下，
    // 不能再从国库扣第二遍（此前重复扣款会让国库凭空少一截）。
    if (balance >= 0) {
      for (const office of country.offices) {
        const holder = state.characters[office.holderId];
        if (!holder || !holder.alive) continue;
        holder.wealth += office.salaryMonthly;
      }
    }
    if (country.treasury < 0) {
      borrow(state, country, -country.treasury);
      country.treasury = 0;
    } else if (country.debt > 0) {
      repayDebt(state, country, Math.min(country.debt, country.treasury));
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

/** 选一个债权方：本国境内现金最多的银行，其次本国现金最多的组织。 */
function pickCreditor(state: WorldState, country: { regionIds: readonly string[] }): string | null {
  const inCountry = Object.values(state.organizations).filter(
    (org) =>
      org &&
      org.lifecycle !== 'dissolved' &&
      country.regionIds.includes(org.homeRegionId) &&
      org.cash > 0,
  );
  const bank = inCountry.filter((org) => org.type === 'bank').sort((a, b) => b.cash - a.cash)[0];
  const best = bank ?? inCountry.sort((a, b) => b.cash - a.cash)[0];
  return best?.id ?? null;
}

/** 借债：本金记到债权人名下，钱从债权人账上转进国库。 */
function borrow(state: WorldState, country: Country, amount: number): void {
  if (amount <= 0) return;
  const creditorId = pickCreditor(state, country);
  country.debt += amount;
  country.treasury += 0;
  if (!creditorId) return;
  const creditor = state.organizations[creditorId];
  if (!creditor) return;
  const lend = Math.min(amount, Math.max(0, Math.round(creditor.cash * 0.5)));
  if (lend <= 0) return;
  creditor.cash -= lend;
  country.creditors[creditorId] = (country.creditors[creditorId] ?? 0) + lend;
}

/** 还本：按债权人持仓比例把现金还回去（钱不会凭空消失）。 */
function repayDebt(state: WorldState, country: Country, amount: number): void {
  if (amount <= 0) return;
  const holdings: [string, number][] = Object.entries(country.creditors).filter(
    ([, value]) => value > 0,
  );
  const total = holdings.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) {
    country.debt = Math.max(0, country.debt - amount);
    country.treasury -= amount;
    return;
  }
  let paid = 0;
  for (const [orgId, value] of holdings) {
    const share = Math.round((amount * value) / total);
    const org = state.organizations[orgId];
    if (org) org.cash += share;
    country.creditors[orgId] = Math.max(0, value - share);
    if (country.creditors[orgId] === 0) delete country.creditors[orgId];
    paid += share;
  }
  country.debt = Math.max(0, country.debt - paid);
  country.treasury -= paid;
}

/** 付息：按债权人持仓比例付，钱进组织现金。 */
function payCreditors(state: WorldState, country: Country, interest: number): void {
  if (interest <= 0) return;
  const holdings = Object.entries(country.creditors).filter(([, value]) => value > 0);
  const total = holdings.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) return;
  for (const [orgId, value] of holdings) {
    const org = state.organizations[orgId];
    if (!org) continue;
    org.cash += Math.round((interest * value) / total);
  }
}
