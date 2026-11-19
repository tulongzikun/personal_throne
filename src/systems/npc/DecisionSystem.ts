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
