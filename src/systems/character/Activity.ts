/**
 * 个人行动与健康（M7 阶段 3）。
 *
 * 设计约束：
 * - 玩家每月 3 点行动力；个人动词（移动/贩货/社交/休息/训练/存取）各消耗 1 点。
 * - 行动力在每月最后一天刷新，容错上限 6 点（最多攒一个月）。
 * - 健康 0–100：消耗行动力扣 1（长途移动扣 2），休息回复；健康越低死亡率越高。
 * 全部是纯函数或就地小改，不推进时间（时间只由 GameClock 推进）。
 */

import type { Character, CharacterId, WorldState } from '../../core/WorldState';

export const MONTHLY_ACTION_POINTS = 3;
export const MAX_ACTION_POINTS = 6;
export const HEALTH_MAX = 100;
export const REST_HEALTH = 12;

export type PersonalAction =
  | 'move'
  | 'trade_goods'
  | 'seek_audience'
  | 'gift'
  | 'gossip'
  | 'rest'
  | 'train'
  | 'deposit'
  | 'withdraw';

export function actionPointsOf(state: WorldState, id: CharacterId): number {
  return state.characters[id]?.actionPoints ?? 0;
}

/** 校验能否行动；返回中文原因或 `null`（可以行动）。 */
export function actionBlocker(state: WorldState, id: CharacterId): string | null {
  const character = state.characters[id];
  if (!character) return '人物不存在';
  if (!character.alive) return '你已经不在人世';
  if (character.actionPoints <= 0) {
    return `本月行动力已用尽（每月 ${MONTHLY_ACTION_POINTS} 点，下月初恢复）`;
  }
  if (character.health <= 5) return '健康见底，先休息（行动力 1 点可恢复）';
  return null;
}

/** 只花时间、不占注意力：健康掉一点，行动力不动。 */
export function spendTime(character: Character, healthCost = 1): void {
  character.health = Math.max(0, character.health - healthCost);
}

export function spendAction(character: Character, healthCost = 1): void {
  character.actionPoints = Math.max(0, character.actionPoints - 1);
  character.health = Math.max(0, character.health - healthCost);
}

export function heal(character: Character, amount: number): number {
  const before = character.health;
  character.health = Math.min(HEALTH_MAX, character.health + amount);
  return character.health - before;
}

/** 每月刷新：所有在世人物的行动力回到 3 点。 */
export function refreshMonthlyActions(state: WorldState): void {
  for (const character of Object.values(state.characters)) {
    if (!character.alive) continue;
    character.actionPoints = MONTHLY_ACTION_POINTS;
  }
}

/** 健康对年死亡率的乘数：满血 0.6，垂死 1.4。 */
export function healthRiskFactor(character: Character): number {
  const missing = (HEALTH_MAX - character.health) / HEALTH_MAX;
  return 0.6 + missing * 0.8;
}

/** 当前地区可直达（1 跳）的邻居。 */
export function neighborsOf(state: WorldState, regionId: string): { id: string; days: number }[] {
  const region = state.regions[regionId];
  if (!region) return [];
  return region.links
    .filter((link) => state.regions[link.to] !== undefined)
    .map((link) => ({ id: link.to, days: Math.max(1, link.days) }));
}

/**
 * 商队能到的市场：两跳以内，取最短天数。
 * 贩货允许"经一个中转地"，这样小地区的货也能卖到隔壁国的边城，
 * 而不是只有一条邻街的价格可比。
 */
export function tradeReach(state: WorldState, regionId: string): { id: string; days: number }[] {
  const best = new Map<string, number>();
  for (const hop of neighborsOf(state, regionId)) {
    best.set(hop.id, Math.min(best.get(hop.id) ?? Infinity, hop.days));
    for (const second of neighborsOf(state, hop.id)) {
      if (second.id === regionId) continue;
      const days = hop.days + second.days;
      best.set(second.id, Math.min(best.get(second.id) ?? Infinity, days));
    }
  }
  return [...best.entries()]
    .map(([id, days]) => ({ id, days }))
    .sort((x, y) => (x.id < y.id ? -1 : 1));
}
