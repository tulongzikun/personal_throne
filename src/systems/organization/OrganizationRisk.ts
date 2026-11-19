/**
 * 组织风险：合法性、冲突、治理、效率的月度演化。
 *
 * 这些指标都在 0–1 之间，演化带均值回归与随机扰动：
 *   x' = x + θ(μ − x) + σ·ε     ε ~ N(0,1)（用两个均匀分布近似，走命名流）
 * 规模越大，治理越难（目标治理值随成员数下降），冲突越容易累积——
 * 这是"组织分裂/政变"事件的输入，而不是结果（结果由 EventEngine 判定）。
 */

import type { SettleContext } from '../../core/WorldState';
import type { WorldContent, WorldState } from '../../core/WorldState';
import { sortedIds } from '../../core/WorldState';

export interface RiskDelta {
  readonly orgId: string;
  readonly conflict: number;
  readonly legitimacy: number;
  readonly governance: number;
  readonly efficiency: number;
  /** 分裂风险指数（GDD §11 示例公式的归一化版本）。 */
  readonly splitRisk: number;
}

const MEAN_REVERSION = 0.18;
const NOISE = 0.03;

function gaussian(rng: SettleContext['rng'], key: string): number {
  const u1 = Math.max(
    1e-9,
    rng.nextFloat({ stream: 'orgrisk', entityId: `${key}:a`, periodKey: 'p' }),
  );
  const u2 = rng.nextFloat({ stream: 'orgrisk', entityId: `${key}:b`, periodKey: 'p' });
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number(value.toFixed(4))));
}

export function settleMonthlyRisk(
  state: WorldState,
  content: WorldContent,
  ctx: SettleContext,
): RiskDelta[] {
  const deltas: RiskDelta[] = [];

  for (const orgId of sortedIds(state.organizations)) {
    const org = state.organizations[orgId];
    if (!org) continue;
    if ((state.tiers[org.id] ?? 3) > 2) continue;
    if (org.lifecycle === 'dissolved') continue;

    const sizePressure = Math.min(1, org.members / 400);
    const wealthPressure = org.cash > 0 && org.liabilities > org.assets ? 1 : 0;
    const governanceTarget = clamp01(0.85 - sizePressure * 0.35 - wealthPressure * 0.2);
    const conflictTarget = clamp01(
      0.1 + sizePressure * 0.35 + wealthPressure * 0.25 - org.leadership.legitimacy * 0.2,
    );
    const efficiencyTarget = clamp01(0.45 + org.governance * 0.4 - org.conflict * 0.3);

    const before = {
      conflict: org.conflict,
      legitimacy: org.leadership.legitimacy,
      governance: org.governance,
      efficiency: org.efficiency,
    };

    org.conflict = clamp01(
      org.conflict +
        MEAN_REVERSION * (conflictTarget - org.conflict) +
        NOISE * gaussian(ctx.rng, `${org.id}:c`),
    );
    org.governance = clamp01(
      org.governance +
        MEAN_REVERSION * (governanceTarget - org.governance) +
        NOISE * gaussian(ctx.rng, `${org.id}:g`),
    );
    org.efficiency = clamp01(
      org.efficiency +
        MEAN_REVERSION * (efficiencyTarget - org.efficiency) +
        NOISE * 0.5 * gaussian(ctx.rng, `${org.id}:e`),
    );
    // 合法性：盈利与治理提升合法性，冲突与亏损侵蚀它。
    const legitimacyTarget = clamp01(
      0.5 +
        (org.lastMonthRevenue > org.lastMonthCost ? 0.15 : -0.1) +
        org.governance * 0.3 -
        org.conflict * 0.4,
    );
    org.leadership.legitimacy = clamp01(
      org.leadership.legitimacy +
        MEAN_REVERSION * (legitimacyTarget - org.leadership.legitimacy) +
        NOISE * gaussian(ctx.rng, `${org.id}:l`),
    );

    // 分裂风险：冲突、低合法性、治理差、缺钱；规模提供缓冲。
    const splitRisk = clamp01(
      1.5 * org.conflict +
        0.8 * (1 - org.leadership.legitimacy) -
        1.0 * org.governance -
        1.1 * (org.cash > org.payrollMonthly * 3 ? 1 : 0) +
        0.5 * (org.members > 200 ? 1 : 0),
    );

    deltas.push({
      orgId: org.id,
      conflict: Number((org.conflict - before.conflict).toFixed(4)),
      legitimacy: Number((org.leadership.legitimacy - before.legitimacy).toFixed(4)),
      governance: Number((org.governance - before.governance).toFixed(4)),
      efficiency: Number((org.efficiency - before.efficiency).toFixed(4)),
      splitRisk,
    });

    void content;
  }

  return deltas;
}
