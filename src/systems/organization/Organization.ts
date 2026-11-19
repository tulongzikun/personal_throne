/**
 * 组织相关的纯计算与查询：股权、估值、继承顺序。
 * 不修改状态——所有变更走 OrganizationSystem / CommandBus。
 */

import type { Character, CharacterId, OrgId, WorldState } from '../../core/WorldState';
import type { Organization } from '../../core/WorldState';
import { sortedIds } from '../../core/WorldState';

/** 已归属股份合计（未归属部分视为管理层/公众持有）。 */
export function assignedShares(org: Organization): number {
  return org.shares.reduce((sum, share) => sum + share.share, 0);
}

export function shareOf(org: Organization, characterId: CharacterId): number {
  return org.shares.find((share) => share.characterId === characterId)?.share ?? 0;
}

/** 最大股东（并列时按 ID 稳定排序，保证可复现）。 */
export function majorityHolder(org: Organization): CharacterId | null {
  const sorted = [...org.shares].sort((a, b) =>
    b.share === a.share ? (a.characterId < b.characterId ? -1 : 1) : b.share - a.share,
  );
  return sorted[0]?.characterId ?? null;
}

/** 领导权继承顺序：最大股东 → 合法性最高的在世成员 → 无（组织进入空缺状态）。 */
export function successionOrder(state: WorldState, orgId: OrgId): CharacterId[] {
  const org = state.organizations[orgId];
  if (!org) return [];

  const holders = [...org.shares].sort((a, b) =>
    b.share === a.share ? (a.characterId < b.characterId ? -1 : 1) : b.share - a.share,
  );
  const order = holders
    .map((share) => share.characterId)
    .filter((id) => state.characters[id]?.alive === true);

  const members = sortedIds(state.characters)
    .map((id) => state.characters[id])
    .filter((character): character is Character => character !== undefined)
    .filter(
      (character) =>
        character.alive && character.organizationId === orgId && !order.includes(character.id),
    )
    .sort((a, b) => (b.traits.loyalty ?? 0) - (a.traits.loyalty ?? 0) || (a.id < b.id ? -1 : 1));

  return [...order, ...members.map((character) => character.id)];
}

/** 粗略估值：净资产 + 月利润年化 × 倍数（倍数随治理质量浮动）。 */
export function valuation(org: Organization): number {
  const equity = org.cash + org.assets - org.liabilities;
  const profit = org.lastMonthRevenue - org.lastMonthCost;
  const multiple = 6 + org.governance * 6 - org.conflict * 4;
  return Math.round(equity + Math.max(0, profit) * multiple);
}

/** 组织是否仍具有偿付能力（用于放贷与合同签署）。 */
export function isSolvent(org: Organization): boolean {
  return org.liabilities <= org.assets * 1.5 && org.cash >= 0;
}

/** 面向玩家/验收的四态口径：其余经营状态统一视为 active。 */
export type OrgStage = 'active' | 'crisis' | 'restructuring' | 'dissolved';

export function stageOf(org: Organization): OrgStage {
  if (org.lifecycle === 'dissolved') return 'dissolved';
  if (org.lifecycle === 'restructuring') return 'restructuring';
  if (org.lifecycle === 'crisis') return 'crisis';
  return 'active';
}
