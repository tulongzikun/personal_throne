/**
 * NPC 决策：U(a) = Σ wᵢ·ExpectedEffectᵢ − RiskCost − ActionCost（GDD §10.4）。
 *
 * 重要 NPC（组织领袖）每月评估一次战略，普通 NPC 只做群体统计（M4 接入）。
 * 决策带"粘性"：只有效用提升超过阈值才换战略，避免每月抖动。
 */

import type { OrgStrategy, SettleContext, WorldState } from '../../core/WorldState';
import { sortedIds } from '../../core/WorldState';

export interface Decision {
  readonly characterId: string;
  readonly orgId: string;
  readonly from: OrgStrategy;
  readonly to: OrgStrategy;
  readonly utility: number;
  readonly reason: string;
}

const UTILITY_MARGIN = 0.03;

interface UtilityInputs {
  readonly revenue: number;
  readonly cost: number;
  readonly cash: number;
  readonly payroll: number;
  readonly conflict: number;
  readonly governance: number;
  readonly legitimacy: number;
}

/** 单条战略的期望效用。值域大致在 −2..2，仅用于相互比较。 */
export function strategyUtility(strategy: OrgStrategy, input: UtilityInputs): number {
  const margin = input.revenue - input.cost;
  const runway = input.payroll > 0 ? input.cash / input.payroll : 6;
  const base = Math.tanh(margin / Math.max(1, input.revenue)) * 0.6;

  switch (strategy) {
    case 'expand':
      // 扩张：利润越高越想做；缺现金时风险厌恶上升。
      return base + 0.25 * Math.tanh(runway / 6) - 0.15 * input.conflict;
    case 'steady':
      // 稳健：保住利润率与治理，风险最低。
      return base + 0.1 * input.governance - 0.05 * input.conflict;
    case 'contract':
      // 接单：用治理换稳定收入，现金紧张时最优。
      return 0.1 + 0.15 * Math.tanh(runway / 3) - 0.1 * (1 - input.legitimacy);
    case 'pivot':
      // 转型：只在利润率很差时才有吸引力。
      return -base * 0.8 + 0.3 * (1 - input.governance) + 0.1 * input.conflict;
  }
}

export function settleMonthlyDecisions(state: WorldState, _ctx: SettleContext): Decision[] {
  const decisions: Decision[] = [];

  for (const orgId of sortedIds(state.organizations)) {
    const org = state.organizations[orgId];
    if (!org || org.lifecycle === 'dissolved') continue;
    if ((state.tiers[org.id] ?? 3) > 2) continue;

    const leader = state.characters[org.leadership.leaderId];
    if (!leader || !leader.alive) continue;

    const inputs: UtilityInputs = {
      revenue: Math.max(1, org.lastMonthRevenue),
      cost: org.lastMonthCost,
      cash: org.cash,
      payroll: org.payrollMonthly,
      conflict: org.conflict,
      governance: org.governance,
      legitimacy: org.leadership.legitimacy,
    };

    const strategies: OrgStrategy[] = ['expand', 'steady', 'contract', 'pivot'];
    const scored = strategies.map((strategy) => ({
      strategy,
      utility: strategyUtility(strategy, inputs),
    }));
    scored.sort((a, b) =>
      b.utility === a.utility ? (a.strategy < b.strategy ? -1 : 1) : b.utility - a.utility,
    );

    const best = scored[0];
    const current = scored.find((entry) => entry.strategy === org.strategy);
    if (!best) continue;
    if (current && best.utility - current.utility < UTILITY_MARGIN) continue;

    const from = org.strategy;
    org.strategy = best.strategy;
    decisions.push({
      characterId: leader.id,
      orgId: org.id,
      from,
      to: best.strategy,
      utility: Number(best.utility.toFixed(3)),
      reason: `${leader.name} 评估边际利润 ${Math.round(inputs.revenue - inputs.cost)}，现金流 ${Math.round(
        inputs.payroll > 0 ? inputs.cash / inputs.payroll : 0,
      )} 个月`,
    });
  }

  return decisions;
}

/* ------------------------------------------------------------------ */
/* 国家层面决策（M3）：增税 / 削减军费 / 借债                            */
/* ------------------------------------------------------------------ */

export type CabinetAction = 'raise_tax' | 'cut_military' | 'borrow';

export interface CabinetInputs {
  readonly deficitRatio: number;
  readonly debtRatio: number;
  readonly stability: number;
  readonly legitimacy: number;
  readonly militaryShare: number;
  readonly taxRate: number;
  readonly threat: number;
}

export interface CountryDecision {
  readonly countryId: string;
  readonly characterId: string;
  readonly action: CabinetAction;
  readonly utility: number;
  readonly reason: string;
}

/** 内阁三条路线的效用：赤字越大越想增税/削军，债务越高越不敢借。 */
export function cabinetUtility(action: CabinetAction, input: CabinetInputs): number {
  const deficit = clamp01(input.deficitRatio);
  const unrest = clamp01(1 - input.stability);
  const threat = clamp01(input.threat);
  switch (action) {
    case 'raise_tax':
      // 增税直接补赤字，但高税率与低稳定会放大政治成本。
      return 0.9 * deficit + 0.2 - 0.6 * input.taxRate - 0.5 * unrest;
    case 'cut_military':
      // 削军对赤字有效，但外部威胁高时代价很大。
      return (
        0.7 * deficit + Math.max(0, input.militaryShare - 0.1) * 1.2 - 0.8 * threat - 0.3 * unrest
      );
    case 'borrow':
      // 借债最快，但债务率越高越接近不可持续。
      return 0.6 * deficit + 0.15 - 0.9 * clamp01(input.debtRatio / 3) - 0.2 * unrest;
  }
}

export interface CountryDecisionResult {
  readonly decisions: readonly CountryDecision[];
  /** 借债实际入账金额（非借债决策为 0），供历史与统计使用。 */
  readonly borrowed: Readonly<Record<string, number>>;
}

/**
 * 重要 NPC（统治者/执政官）每月评估一次财政路线。
 * 只是"选择路线"，真正改税率/军费仍走政策三阶段（带 12 个月冷却），
 * 因此不会出现每月改税的抖动。
 */
export function settleCountryDecisions(
  state: WorldState,
  ctx: SettleContext,
): CountryDecisionResult {
  void ctx;
  const decisions: CountryDecision[] = [];
  const borrowed: Record<string, number> = {};

  for (const countryId of sortedIds(state.countries)) {
    const country = state.countries[countryId];
    if (!country) continue;
    const ruler = state.characters[country.rulerId];
    if (!ruler || !ruler.alive) continue;

    const revenue = Math.max(1, country.monthlyRevenue);
    const input: CabinetInputs = {
      deficitRatio: (country.monthlyExpense - revenue) / revenue,
      debtRatio: country.debt / Math.max(1, revenue * 12),
      stability: country.stability,
      legitimacy: country.legitimacy,
      militaryShare: country.policies.militaryShare,
      taxRate: country.policies.taxRate,
      threat: Object.values(country.diplomacy).some((value) => value < -30) ? 1 : 0,
    };

    const actions: CabinetAction[] = ['raise_tax', 'cut_military', 'borrow'];
    const scored = actions.map((action) => ({ action, utility: cabinetUtility(action, input) }));
    scored.sort((a, b) =>
      b.utility === a.utility ? (a.action < b.action ? -1 : 1) : b.utility - a.utility,
    );
    const best = scored[0];
    if (!best) continue;

    const previous = country.cabinetAction;
    // 首次必然选一条；之后只有效用明显改善才换路线（粘性 0.03）。
    if (previous !== null && best.utility - country.cabinetUtility < 0.03) continue;

    country.cabinetAction = best.action;
    country.cabinetUtility = Number(best.utility.toFixed(3));
    if (best.action === 'borrow' && previous !== 'borrow' && input.debtRatio < 1.5) {
      const loan = Math.round(revenue * 2);
      country.treasury += loan;
      country.debt += loan;
      borrowed[countryId] = loan;
    }

    decisions.push({
      characterId: ruler.id,
      countryId,
      action: best.action,
      utility: Number(best.utility.toFixed(3)),
      reason: `${ruler.name} 选择 ${best.action}：赤字 ${(input.deficitRatio * 100).toFixed(0)}%、债务 ${(input.debtRatio * 100).toFixed(0)}% 年收入、稳定 ${(input.stability * 100).toFixed(0)}`,
    });
  }

  return { decisions, borrowed };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
