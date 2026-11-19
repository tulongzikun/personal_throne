/**
 * 组织系统：月度结算编排。
 *
 * 顺序固定（铁律：先财务再风险再结构）：
 *   1. Finance       —— 损益、税费、利息、权益；
 *   2. OrganizationRisk —— 冲突/合法性/治理/效率漂移与分裂风险指标；
 *   3. 结构          —— 规模随盈利与效率微调，成员流入流出；
 *   4. 生命周期      —— 解散判定（M2 起由重组/破产事件接管，这里只兜底）。
 */

import type { SettleContext, WorldContent, WorldState } from '../../core/WorldState';
import { sortedIds } from '../../core/WorldState';
import { settleMonthlyFinance, type FinanceEntry } from './Finance';
import { settleMonthlyRisk, type RiskDelta } from './OrganizationRisk';

export interface OrganizationSettlement {
  readonly finance: readonly FinanceEntry[];
  readonly risk: readonly RiskDelta[];
  readonly dissolved: readonly string[];
}

export function monthlyOrganizationSettlement(
  state: WorldState,
  content: WorldContent,
  ctx: SettleContext,
): OrganizationSettlement {
  const finance = settleMonthlyFinance(state, content);
  const risk = settleMonthlyRisk(state, content, ctx);
  const dissolved: string[] = [];

  for (const orgId of sortedIds(state.organizations)) {
    const org = state.organizations[orgId];
    if (!org) continue;
    if ((state.tiers[org.id] ?? 3) > 2) continue;

    const profit = org.lastMonthRevenue - org.lastMonthCost;
    const growth = profit > 0 ? 0.02 : -0.01;
    org.scale = Math.max(0.1, Number((org.scale * (1 + growth)).toFixed(4)));

    // 成员随规模缓慢调整，工资同步重算（保持 per-head 工资不跳变）。
    const perHead = Math.max(1, Math.round(org.payrollMonthly / Math.max(1, org.members)));
    const targetMembers = Math.max(1, Math.round(org.members * (1 + growth)));
    const delta = targetMembers - org.members;
    if (delta !== 0) {
      org.members = targetMembers;
      org.payrollMonthly = perHead * org.members;
    }

    if (org.lifecycle === 'dissolved') {
      org.members = 0;
      org.payrollMonthly = 0;
      const leader = state.characters[org.leadership.leaderId];
      if (leader) leader.organizationId = null;
      dissolved.push(org.id);
    }
  }

  return { finance, risk, dissolved };
}
