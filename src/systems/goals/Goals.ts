/**
 * 建议事项：把「我下一步做什么」变成三条带真实数字的可执行建议。
 *
 * 设计约束（docs/redesign-v2.md 阶段 5）：
 * - 永远给 3 条，且每条都能落到一个具体命令或面板；
 * - 每条都要有真实数字（钱、天数、评分、差价），不要空话；
 * - 纯函数：只读状态，不派发命令。
 */

import type { Command } from '../../core/CommandBus';
import type { WorldContent, WorldState } from '../../core/WorldState';
import { careerTitle, nextCareerStep } from '../character/Career';
import { neighborsOf } from '../character/Activity';
import { officeIdOf, officeScore, officeSeatsFor } from '../country/Offices';
import { sharePrice } from '../organization/Shares';
import { valuation } from '../organization/Organization';

export interface Suggestion {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly command?: Command;
}

interface TradeRoute {
  readonly goodId: string;
  readonly units: number;
  readonly target: string;
  readonly days: number;
  readonly profit: number;
}

/** 找一条当前最划算的短途贩运：本地买入价 ×1.05，邻区卖出价 ×0.95，扣运费。 */
export function bestTradeRoute(
  state: WorldState,
  content: WorldContent,
  units = 5,
): TradeRoute | null {
  const player = state.characters[state.playerId];
  if (!player) return null;
  let best: TradeRoute | null = null;
  for (const neighbor of neighborsOf(state, player.regionId)) {
    const freight = Math.max(1, Math.round(neighbor.days * units * 0.05));
    for (const good of content.goods) {
      const here = state.markets[`${player.regionId}:${good.id}`];
      const there = state.markets[`${neighbor.id}:${good.id}`];
      if (!here || !there) continue;
      const profit = Math.round(there.price * 0.95 * units - here.price * 1.05 * units - freight);
      if (profit > 0 && (!best || profit > best.profit)) {
        best = { goodId: good.id, units, target: neighbor.id, days: neighbor.days, profit };
      }
    }
  }
  return best;
}

export function suggestGoals(state: WorldState, content: WorldContent, limit = 3): Suggestion[] {
  const player = state.characters[state.playerId];
  if (!player) return [];
  const out: Suggestion[] = [];
  const hasActions = player.actionPoints > 0;
  const healthy = player.health >= 45;

  if (player.health < 55) {
    out.push({
      id: 'rest',
      title: '先把身体养回来',
      detail: `你的健康只有 ${Math.round(player.health)}/100，休息一次可回到 ${Math.min(100, Math.round(player.health) + 12)}，代价是 1 点行动力。`,
      command: { kind: 'rest' },
    });
  }

  const route = bestTradeRoute(state, content);
  if (route && hasActions && healthy) {
    const good = content.goods.find((item) => item.id === route.goodId);
    out.push({
      id: 'trade',
      title: `贩 ${route.units} ${good?.name ?? route.goodId} 到${state.regions[route.target]?.name ?? route.target}`,
      detail: `这条线一趟净赚约 ${route.profit} 铜币，路上 ${route.days} 天，花 1 点行动力与 1 点健康。`,
      command: { kind: 'trade_goods', goodId: route.goodId, units: route.units },
    });
  }

  const orgId = player.organizationId;
  if (orgId) {
    const org = state.organizations[orgId];
    const share = org?.shares.find((item) => item.characterId === player.id)?.share ?? 0;
    if (org && share < 0.34) {
      const target = Math.min(0.05, 0.34 - share);
      const cost = sharePrice(org, target);
      if (cost <= player.wealth) {
        out.push({
          id: 'shares',
          title: `买入 ${(target * 100).toFixed(0)}% ${org.name} 股份`,
          detail: `你现在持股 ${(share * 100).toFixed(0)}%，再买 ${(target * 100).toFixed(0)}% 需要 ${cost} 铜币（估值 ${valuation(org)}），到 34% 就能接管字号。`,
          command: { kind: 'buy_shares', orgId, share: target },
        });
      } else {
        out.push({
          id: 'shares-save',
          title: `攒 ${cost} 铜币买 ${(target * 100).toFixed(0)}% 股份`,
          detail: `你现有 ${player.wealth} 铜币，还差 ${Math.max(0, cost - player.wealth)}；组织估值 ${valuation(org)}。`,
        });
      }
    }
  }

  const region = state.regions[player.regionId];
  const countryId = region?.countryId;
  if (countryId) {
    const country = state.countries[countryId];
    if (country) {
      for (const seat of officeSeatsFor(country)) {
        const score = officeScore(state, player.id, countryId, seat);
        const officeId = officeIdOf(countryId, seat.id);
        const incumbent = country.offices.find((office) => office.id === officeId);
        if (score >= 0.45 && incumbent?.holderId !== player.id) {
          out.push({
            id: `office-${seat.id}`,
            title: `谋求${country.name}的${seat.title}`,
            detail: `你的评分 ${Math.round(score * 100)}，门槛 45；现任是${incumbent ? (state.characters[incumbent.holderId]?.name ?? '前任') : '空缺'}。`,
            command: { kind: 'seek_office', countryId, officeId },
          });
          break;
        }
      }
    }
  }

  const step = nextCareerStep(player);
  if (step && player.wealth >= step.minWealth) {
    const skill = careerSkillOf(player.classId);
    const level = player.skills[skill] ?? 0;
    out.push({
      id: 'career',
      title: `朝着${step.title}走`,
      detail: `晋升 ${step.title} 要 ${step.minWealth} 铜币与 ${step.minSkill} 级${skillName(skill)}；你现在 ${player.wealth} 铜币、${level} 级。`,
      ...(level < step.minSkill ? { command: { kind: 'train', skill } } : {}),
    });
  }

  if (hasActions) {
    const skill = 'trade';
    const level = player.skills[skill] ?? 0;
    const cost = 150 + level * 120;
    if (player.wealth >= cost) {
      out.push({
        id: 'train',
        title: `花 ${cost} 铜币练${skillName(skill)}`,
        detail: `当前 ${level} 级，训练一次 +1；公职评分里技能占 55%，这是最省钱的升法。`,
        command: { kind: 'train', skill },
      });
    }
  }

  if (out.length < limit) {
    const neighbor = neighborsOf(state, player.regionId)[0];
    if (neighbor) {
      const name = state.regions[neighbor.id]?.name ?? neighbor.id;
      out.push({
        id: 'visit',
        title: `去${name}看看行情`,
        detail: `走 ${neighbor.days} 天、路费 ${neighbor.days * 2} 铜币；那边的地形与货价都和这里不同。`,
        command: { kind: 'move', regionId: neighbor.id },
      });
    }
  }

  // 保底：永远给满三条（数字仍来自状态）。
  while (out.length < limit) {
    const level = player.skills['trade'] ?? 0;
    const cost = 150 + level * 120;
    out.push({
      id: `fallback-${out.length}`,
      title: '歇一天，等下一班商队',
      detail: `你现在有 ${player.wealth} 铜币、${player.actionPoints} 点行动力；休息回 12 点健康，训练一次要 ${cost}。`,
      command: { kind: 'rest' },
    });
  }

  return out.slice(0, limit);
}

function careerSkillOf(classId: string): string {
  if (classId === 'mercenary') return 'melee';
  if (classId === 'politician') return 'persuasion';
  return 'trade';
}

function skillName(skill: string): string {
  const labels: Record<string, string> = {
    trade: '贸易',
    negotiation: '谈判',
    persuasion: '说服',
    intimidation: '威吓',
    insight: '洞察',
    law: '律法',
    melee: '格斗',
    tactics: '战术',
    stealth: '潜行',
    appraisal: '估值',
    craft: '工艺',
  };
  return labels[skill] ?? skill;
}

/** 当前称号：公职 > 组织领袖 > 生涯等级。 */
export function titleOf(state: WorldState, characterId: string): string {
  const character = state.characters[characterId];
  if (!character) return '无名之辈';
  if (character.offices.length > 0) return '在朝之臣';
  const org = character.organizationId ? state.organizations[character.organizationId] : undefined;
  if (org && org.leadership.leaderId === characterId) return `${org.name}之主`;
  return careerTitle(character.classId, character.careerRank);
}
