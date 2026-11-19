/**
 * 组织生命周期状态机（M2）：active → crisis（宽限）→ restructuring → dissolved。
 *
 * 设计约束：
 * - 不新增 OrgLifecycle 成员（UI 有穷举表），宽限期用 `crisis` + `graceUntilDay` 表示；
 * - 破产不是瞬间消失：先宽限，再重组（出售资产、展期、裁员），仍不清偿才清算；
 * - 清算顺序固定为 债主 → 员工欠薪 → 股东；资不抵债的差额记入股东损失与历史，
 *   绝不允许负资产凭空消失。
 *
 * 本模块只改状态，返回的 `events` 由 GameEngine 写入 History（审计可追溯）。
 */

import type { OrgId, SettleContext, WorldContent, WorldState } from '../../core/WorldState';
import { sortedIds } from '../../core/WorldState';
import { equityOf } from './Finance';

export interface LifecycleEvent {
  readonly kind: 'finance' | 'milestone' | 'command' | 'trade';
  readonly summary: string;
  readonly refs: readonly { readonly kind: string; readonly id: string }[];
}

export interface LifecycleResult {
  readonly dissolved: readonly OrgId[];
  readonly events: readonly LifecycleEvent[];
}

export function settleOrganizationLifecycle(
  state: WorldState,
  content: WorldContent,
  ctx: SettleContext,
): LifecycleResult {
  const events: LifecycleEvent[] = [];
  const dissolved: OrgId[] = [];
  const contract = content.balance.contract;

  for (const orgId of sortedIds(state.organizations)) {
    const org = state.organizations[orgId];
    if (!org || org.lifecycle === 'dissolved') continue;
    if ((state.tiers[org.id] ?? 3) > 2) continue;

    const equity = equityOf(org);
    const payroll = org.payrollMonthly;
    const solvent = equity >= 0 && (payroll === 0 || org.cash >= payroll * 0.6);

    if (solvent) {
      const wasDistressed = org.lifecycle === 'crisis' || org.lifecycle === 'restructuring';
      org.distressMonths = 0;
      org.graceUntilDay = 0;
      org.restructureUntilDay = 0;
      if (wasDistressed) {
        org.lifecycle = 'stable';
        events.push({
          kind: 'milestone',
          summary: `${ctx.day} ${org.name} 摆脱财务危机，恢复稳定经营`,
          refs: [{ kind: 'organization', id: org.id }],
        });
      } else if (org.lifecycle === 'shrinking' && org.lastMonthProfit > 0) {
        org.lifecycle = 'stable';
      }
      continue;
    }

    // 进入危机：先给宽限期，允许融资/出售资产自救。
    org.distressMonths += 1;
    if (org.lifecycle !== 'restructuring') org.lifecycle = 'crisis';
    if (org.graceUntilDay === 0) {
      org.graceUntilDay = ctx.day + Math.max(1, contract.graceMonths) * 30;
      events.push({
        kind: 'finance',
        summary: `${ctx.day} ${org.name} 资不抵债（权益 ${equity}），进入 ${contract.graceMonths} 个月宽限期，截止 ${org.graceUntilDay}`,
        refs: [{ kind: 'organization', id: org.id }],
      });
    }

    if (org.lifecycle === 'crisis' && ctx.day >= org.graceUntilDay) {
      const restructuring = restructure(state, content, org, ctx);
      events.push(...restructuring);
      if ((org.lifecycle as string) === 'dissolved') {
        dissolved.push(org.id);
      }
      continue;
    }

    if (org.lifecycle === 'restructuring' && ctx.day >= org.restructureUntilDay) {
      const record = liquidate(state, content, org, ctx);
      events.push(record);
      dissolved.push(org.id);
      continue;
    }

    if (org.lifecycle === 'restructuring') {
      const sale = sellAssets(state, content, org, ctx);
      if (sale) events.push(sale);
      if (equityOf(org) >= 0 && (org.payrollMonthly === 0 || org.cash >= org.payrollMonthly)) {
        org.lifecycle = 'stable';
        org.distressMonths = 0;
        org.graceUntilDay = 0;
        org.restructureUntilDay = 0;
        events.push({
          kind: 'milestone',
          summary: `${ctx.day} ${org.name} 重组成功，恢复偿付能力`,
          refs: [{ kind: 'organization', id: org.id }],
        });
      }
    }
  }

  return { dissolved, events };
}

/** 出售资产偿债：按 haircut 变现，损失计入历史；随后裁员 10% 降薪。 */
function sellAssets(
  state: WorldState,
  content: WorldContent,
  org: WorldState['organizations'][string],
  ctx: SettleContext,
): LifecycleEvent | null {
  const claims = org.liabilities + org.unpaidWages;
  const needed = Math.max(0, claims - org.cash);
  if (needed <= 0 || org.assets <= 0) return null;

  const sale = Math.min(org.assets, needed);
  const proceeds = Math.round(sale * (1 - content.balance.contract.liquidationHaircut));
  const loss = sale - proceeds;
  org.assets -= sale;
  org.cash += proceeds;

  const payCreditors = Math.min(org.cash, org.liabilities);
  org.cash -= payCreditors;
  org.liabilities -= payCreditors;

  const payWages = Math.min(org.cash, org.unpaidWages);
  org.cash -= payWages;
  org.unpaidWages -= payWages;
  org.liabilities = Math.max(0, org.liabilities - payWages);

  const cut = Math.max(0, Math.round(org.members * 0.1));
  if (cut > 0) {
    org.members -= cut;
    const perHead = Math.max(1, Math.round(org.payrollMonthly / Math.max(1, org.members + cut)));
    org.payrollMonthly = perHead * org.members;
  }
  org.scale = Math.max(0.1, Number((org.scale * 0.96).toFixed(4)));

  void state;
  return {
    kind: 'finance',
    summary: `${ctx.day} ${org.name} 重组：出售资产 ${sale}（变现 ${proceeds}，损失 ${loss}），偿还债主 ${payCreditors}、欠薪 ${payWages}，裁员 ${cut}`,
    refs: [{ kind: 'organization', id: org.id }],
  };
}

function restructure(
  state: WorldState,
  content: WorldContent,
  org: WorldState['organizations'][string],
  ctx: SettleContext,
): LifecycleEvent[] {
  const events: LifecycleEvent[] = [];
  const sale = sellAssets(state, content, org, ctx);
  if (sale) events.push(sale);

  // 贷款展期 6 个月，避免到期违约与重组同时爆发。
  for (const contract of Object.values(state.contracts)) {
    if (contract.fromOrgId !== org.id) continue;
    if (contract.status !== 'open' || contract.kind !== 'loan') continue;
    contract.endDay += 180;
    contract.nextDueDay += 180;
  }

  org.lifecycle = 'restructuring';
  state.stats.restructurings += 1;
  org.restructureUntilDay = ctx.day + Math.max(1, content.balance.contract.restructureMonths) * 30;
  events.push({
    kind: 'finance',
    summary: `${ctx.day} ${org.name} 进入重组期（截止 ${org.restructureUntilDay}）：出售资产、贷款展期 ${content.balance.contract.restructureMonths} 个月`,
    refs: [{ kind: 'organization', id: org.id }],
  });
  return events;
}

/** 清算：债主 → 员工欠薪 → 股东；资不抵债的差额由股东承担并记入历史。 */
export function liquidate(
  state: WorldState,
  content: WorldContent,
  org: WorldState['organizations'][string],
  ctx: SettleContext,
): LifecycleEvent {
  const haircut = content.balance.contract.liquidationHaircut;
  const proceeds = org.cash + Math.round(org.assets * (1 - haircut));
  const claims = org.liabilities + org.unpaidWages;

  const creditorPaid = Math.min(proceeds, org.liabilities);
  let rest = proceeds - creditorPaid;
  const wagePaid = Math.min(rest, org.unpaidWages);
  rest -= wagePaid;
  const shareholderPaid = Math.max(0, rest);
  const shortfall = Math.max(0, claims - proceeds);

  // 股东按持股比例分配剩余，也按持股比例承担超额损失（财富下限 0）。
  const shares = org.shares.length > 0 ? org.shares : [];
  for (const share of shares) {
    const character = state.characters[share.characterId];
    if (!character) continue;
    if (shareholderPaid > 0) {
      character.wealth += Math.round(shareholderPaid * share.share);
    }
    if (shortfall > 0) {
      const loss = Math.round(shortfall * share.share);
      character.wealth = Math.max(0, character.wealth - loss);
    }
  }

  const debtLoss = Math.max(0, org.liabilities - creditorPaid);
  org.cash = 0;
  org.assets = 0;
  org.liabilities = 0;
  org.unpaidWages = 0;
  org.members = 0;
  org.payrollMonthly = 0;
  org.lifecycle = 'dissolved';
  org.graceUntilDay = 0;
  org.restructureUntilDay = 0;
  org.liquidation = {
    day: ctx.day,
    proceeds,
    creditorPaid,
    wagePaid,
    shareholderPaid,
    shortfall,
  };
  state.stats.bankruptcies += 1;
  state.stats.dissolved += 1;

  const leader = state.characters[org.leadership.leaderId];
  if (leader) leader.organizationId = null;

  for (const contract of Object.values(state.contracts)) {
    if (contract.status !== 'open') continue;
    if (contract.fromOrgId === org.id || contract.toOrgId === org.id) {
      contract.status = 'cancelled';
    }
  }
  for (const market of Object.values(state.markets)) {
    delete market.shareByOrg[org.id];
  }

  return {
    kind: 'milestone',
    summary:
      `${ctx.day} ${org.name} 破产清算：变现 ${proceeds}，债主 ${creditorPaid}，欠薪 ${wagePaid}，` +
      `股东 ${shareholderPaid}，资不抵债差额 ${shortfall}（债务损失 ${debtLoss} 由股东承担）`,
    refs: [{ kind: 'organization', id: org.id }],
  };
}
