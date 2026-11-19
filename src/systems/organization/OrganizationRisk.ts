/**
 * 组织风险：冲突、合法性、治理、效率的月度漂移，以及四类风险的强度函数。
 *
 * 风险强度只读 `balance.risk` 的系数表：
 *   hazard = lambda0 × exp(Σ coef × feature)
 *   risk   = clamp01(hazard × scale)
 * 代码里没有写死的系数——调整 balance.json 就会改变风险与事件触发率。
 */

import type { SettleContext, WorldContent, WorldState } from '../../core/WorldState';
import { sortedIds } from '../../core/WorldState';
import { readFeature } from '../../core/EventEngine';
import type { RiskTable } from '../../core/WorldState';

export interface RiskDelta {
  readonly orgId: string;
  readonly conflict: number;
  readonly legitimacy: number;
  readonly governance: number;
  readonly efficiency: number;
  readonly split: number;
  readonly bankruptcy: number;
  readonly corruption: number;
  readonly unrest: number;
}

const MEAN_REVERSION = 0.18;
const NOISE = 0.03;

export function settleMonthlyRisk(
  state: WorldState,
  content: WorldContent,
  ctx: SettleContext,
): RiskDelta[] {
  const deltas: RiskDelta[] = [];
  const tables = content.balance.risk;

  for (const orgId of sortedIds(state.organizations)) {
    const org = state.organizations[orgId];
    if (!org) continue;
    if (org.lifecycle === 'dissolved') continue;

    const sizePressure = Math.min(1, org.members / 400);
    const wealthPressure = org.liabilities > org.assets ? 1 : 0;
    // 债务压力：现实里组织内斗的导火索是"钱不够"，不是性格。
    const debtPressure = Math.min(1, org.liabilities / Math.max(1, org.assets));
    const profitable = org.lastMonthProfit >= 0;
    const target = {
      governance: 0.88 - sizePressure * 0.4 - wealthPressure * 0.25,
      conflict:
        0.12 +
        sizePressure * 0.3 +
        wealthPressure * 0.22 +
        debtPressure * 0.25 +
        (1 - org.efficiency) * 0.15 -
        org.leadership.legitimacy * 0.18,
      efficiency: 0.45 + org.governance * 0.4 - org.conflict * 0.3,
      legitimacy: 0.5 + (profitable ? 0.15 : -0.1) + org.governance * 0.3 - org.conflict * 0.4,
    };

    const noise = (suffix: string): number =>
      (ctx.rng.nextFloat({
        stream: 'orgrisk',
        entityId: `${org.id}:${suffix}`,
        periodKey: 'p',
      }) -
        0.5) *
      2 *
      NOISE;

    org.governance = clamp01(
      org.governance + (target.governance - org.governance) * MEAN_REVERSION + noise('g'),
    );
    org.conflict = clamp01(
      org.conflict + (target.conflict - org.conflict) * MEAN_REVERSION + noise('c'),
    );
    org.efficiency = clamp01(
      org.efficiency + (target.efficiency - org.efficiency) * MEAN_REVERSION + noise('e'),
    );
    org.leadership.legitimacy = clamp01(
      org.leadership.legitimacy +
        (target.legitimacy - org.leadership.legitimacy) * MEAN_REVERSION +
        noise('l'),
    );

    const targetEntity = { scope: 'organization' as const, entityId: org.id };
    org.risk = {
      split: riskOf(state, targetEntity, tables.split),
      bankruptcy: riskOf(state, targetEntity, tables.bankruptcy),
      corruption: riskOf(state, targetEntity, tables.corruption),
      unrest: riskOf(state, targetEntity, tables.unrest),
    };

    deltas.push({
      orgId: org.id,
      conflict: org.conflict,
      legitimacy: org.leadership.legitimacy,
      governance: org.governance,
      efficiency: org.efficiency,
      split: org.risk.split,
      bankruptcy: org.risk.bankruptcy,
      corruption: org.risk.corruption,
      unrest: org.risk.unrest,
    });
  }

  return deltas;
}

export function riskOf(
  state: WorldState,
  target: { scope: 'organization'; entityId: string },
  table: RiskTable,
): number {
  let exponent = 0;
  for (const term of table.terms) {
    exponent += term.coef * readFeature(state, target, term.path);
  }
  const hazard = table.lambda0 * Math.exp(exponent);
  return Number(clamp01(hazard * table.scale).toFixed(4));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number(value.toFixed(4))));
}
