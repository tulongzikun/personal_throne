/**
 * 技能与生涯的实际收益（M7.8「成长看得见」）。
 *
 * 设计目标：每一级技能、每一阶生涯都要对应一个能被玩家算出来的数字，
 * 而不是只写进称号或事件条件里。所有函数都是纯函数，数值全部集中在文件顶部，
 * 方便后续校准时只改常数。
 */

import type { Character } from '../../core/WorldState';

/** 每级贸易带来的买卖价优惠（1%）。 */
export const TRADE_PER_LEVEL = 0.01;
/** 买卖价的最大优惠幅度，避免高技能把价差完全抹平。 */
export const TRADE_MAX_DISCOUNT = 0.12;
/** 单次贩货的基础数量，贸易每级 +1。 */
export const TRADE_CARRY_BASE = 5;
/** 每级谈判压低的契约利率（2%）。 */
export const NEGOTIATION_PER_LEVEL = 0.02;
/** 契约利率的下限系数：再能谈也不会低于原价的一半。 */
export const NEGOTIATION_FLOOR = 0.5;
/** 每级说服为游说增加的幅度。 */
export const PERSUASION_LOBBY_PER_LEVEL = 0.01;
/** 每级洞察提高的打听成功率。 */
export const INSIGHT_GOSSIP_PER_LEVEL = 0.08;

function levelOf(character: Character, skill: string): number {
  const value = character.skills[skill] ?? 0;
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** 贸易折扣：0.06 → 6%，封顶 12%。 */
export function tradeDiscount(character: Character): number {
  return Math.min(TRADE_MAX_DISCOUNT, levelOf(character, 'trade') * TRADE_PER_LEVEL);
}

/** 采购价系数：贸易 6 级时 1.05 − 0.06 = 0.99。 */
export function purchaseFactor(character: Character): number {
  return Math.max(0.9, 1.05 - tradeDiscount(character));
}

/** 出售价系数：贸易 6 级时 0.95 + 0.06 = 1.01。 */
export function saleFactor(character: Character): number {
  return Math.min(1.1, 0.95 + tradeDiscount(character));
}

/** 单次贩货上限：基础 5 + 贸易等级。 */
export function tradeCarryCapacity(character: Character): number {
  return TRADE_CARRY_BASE + levelOf(character, 'trade');
}

/** 契约利率系数：谈判 5 级 → 0.9，下限 0.5。 */
export function contractRateFactor(character: Character): number {
  return Math.max(NEGOTIATION_FLOOR, 1 - levelOf(character, 'negotiation') * NEGOTIATION_PER_LEVEL);
}

/** 违约金系数：谈判每级 −5%，下限 0.5。 */
export function contractPenaltyFactor(character: Character): number {
  return Math.max(0.5, 1 - levelOf(character, 'negotiation') * 0.05);
}

/** 游说幅度加成：说服每级 +0.01（仍然受单次 0.2 的硬上限约束）。 */
export function lobbyBonus(character: Character): number {
  return Math.min(0.05, levelOf(character, 'persuasion') * PERSUASION_LOBBY_PER_LEVEL);
}

/** 打听成功率加成：洞察每级 +8%，封顶 60%。 */
export function gossipChance(character: Character): number {
  return Math.min(0.6, 0.25 + levelOf(character, 'insight') * INSIGHT_GOSSIP_PER_LEVEL);
}

/** 生涯四阶的月俸（0/1/2/3 级）。 */
export const CAREER_SALARY: readonly number[] = [0, 40, 120, 300];

export function careerSalary(rank: number): number {
  const index = Math.max(0, Math.min(CAREER_SALARY.length - 1, Math.round(rank)));
  return CAREER_SALARY[index] ?? 0;
}

/**
 * 界面上给每个技能一行「它到底干什么用」，用于玩家卡与人物卡的 title 提示。
 */
export function skillEffectSummary(skill: string, level: number, max?: number): string {
  const cap = max === undefined ? '' : `（上限 ${max}）`;
  switch (skill) {
    case 'trade':
      return `贸易 ${level}${cap}：采购 −${Math.round(Math.min(0.12, level * 0.01) * 100)}%、出售 +${Math.round(Math.min(0.12, level * 0.01) * 100)}%，单次可贩 ${5 + level} 单位`;
    case 'negotiation':
      return `谈判 ${level}${cap}：契约利率 −${Math.round(Math.min(0.5, level * 0.02) * 100)}%、违约金 −${Math.round(Math.min(0.5, level * 0.05) * 100)}%`;
    case 'persuasion':
      return `说服 ${level}${cap}：游说幅度 +${Math.min(0.05, level * 0.01).toFixed(2)}、公职评分`;
    case 'insight':
      return `洞察 ${level}${cap}：打听成功率 ${Math.round(Math.min(0.6, 0.25 + level * 0.08) * 100)}%`;
    case 'law':
      return `律法 ${level}${cap}：公职评分、继承危机中保住职位`;
    case 'melee':
      return `格斗 ${level}${cap}：遇袭存活、军团战力`;
    case 'tactics':
      return `战术 ${level}${cap}：军团战力、元帅评分`;
    case 'appraisal':
      return `估值 ${level}${cap}：股份与资产估值更准`;
    case 'stealth':
      return `潜行 ${level}${cap}：走私与潜入类事件`;
    case 'intimidation':
      return `威吓 ${level}${cap}：恐吓类事件选项`;
    case 'craft':
      return `工艺 ${level}${cap}：制造与修缮`;
    default:
      return `${skill} ${level}${cap}`;
  }
}
