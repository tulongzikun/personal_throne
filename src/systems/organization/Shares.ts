/**
 * 股权交易（M6.2 第 3 阶段）。
 *
 * 只做份额的搬移与估值换算，不碰命令校验；校验在 CommandBus。
 * 约定：份额用 0–1 的小数表示，`null` 代表「未登记份额」（无主，可被买入）。
 */

import type { CharacterId, Organization } from '../../core/WorldState';
import { shareOf, valuation } from './Organization';

/** 接管字号所需的最低持股（34%，避免 50% 才会有意义的僵局）。 */
export const LEADERSHIP_MIN_SHARE = 0.34;

/** 份额精度：0.1% —— 避免浮点尾差让相等判断失败。 */
export function roundShare(share: number): number {
  return Math.round(share * 1000) / 1000;
}

/** 单个百分点的价格，至少 1 铜币。 */
export function sharePrice(org: Organization, share: number): number {
  return Math.max(1, Math.round(valuation(org) * share));
}

/** 用现金最多能买到的份额（向上取整到 0.1%）。 */
export function affordableShare(org: Organization, cash: number): number {
  const unit = Math.max(1, valuation(org));
  return roundShare(Math.max(0, cash / unit));
}

/** 未登记份额：不在任何股东名下的部分。 */
export function unassignedShare(org: Organization): number {
  const assigned = org.shares.reduce((sum, entry) => sum + entry.share, 0);
  return roundShare(Math.max(0, 1 - assigned));
}

/** 把 `share` 从 `fromId`（null = 未登记份额）转给 `toId`（null = 回到未登记）。 */
export function moveShares(
  org: Organization,
  fromId: CharacterId | null,
  toId: CharacterId | null,
  share: number,
): void {
  const amount = roundShare(Math.max(0, share));
  if (amount <= 0) return;

  if (fromId !== null) {
    const entry = org.shares.find((item) => item.characterId === fromId);
    if (entry) {
      entry.share = roundShare(Math.max(0, entry.share - amount));
      if (entry.share <= 0) {
        org.shares = org.shares.filter((item) => item !== entry);
      }
    }
  }

  if (toId === null) return;
  const existing = org.shares.find((item) => item.characterId === toId);
  if (existing) {
    existing.share = roundShare(existing.share + amount);
  } else {
    org.shares = [...org.shares, { characterId: toId, share: roundShare(amount) }];
  }
}

/** 玩家能否接管字号：份额够、且已超过现任领袖。 */
export function canClaimLeadership(
  org: Organization,
  playerId: CharacterId,
): { ok: boolean; reason: string } {
  if (org.lifecycle === 'dissolved') return { ok: false, reason: '字号已经解散' };
  const mine = shareOf(org, playerId);
  if (org.leadership.leaderId === playerId) return { ok: false, reason: '你已经是领袖' };
  const leader = shareOf(org, org.leadership.leaderId);
  if (mine < LEADERSHIP_MIN_SHARE) {
    return {
      ok: false,
      reason: `需持股 ${(LEADERSHIP_MIN_SHARE * 100).toFixed(0)}% 才能接管，当前 ${(mine * 100).toFixed(1)}%`,
    };
  }
  if (mine <= leader) {
    return {
      ok: false,
      reason: `现任领袖持股 ${(leader * 100).toFixed(1)}%，你还没有超过对方`,
    };
  }
  return { ok: true, reason: '' };
}

/** 按份额降序排好的股东列表（含玩家）。 */
export function rankedHolders(org: Organization): { characterId: CharacterId; share: number }[] {
  return [...org.shares].sort((a, b) => b.share - a.share);
}
