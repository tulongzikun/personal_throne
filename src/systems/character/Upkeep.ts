/**
 * 生活开销（阶段 1：让"做事"成为最优解）。
 *
 * 玩家的人物不是抽象账本：宅子、仆役、车马、应酬会随身家一起涨。
 * 每月按身家的固定比例扣一笔开销，最低 10 铜——钱越多，躺着越贵。
 *
 * NPC 不参与：他们的身家早已按组织/家族口径摊销，且大规模扣钱会让
 * 婚姻门槛、遗产分配等既有内容失衡。这里只对玩家生效。
 */

import type { WorldState } from '../../core/WorldState';

/** 每月开销占身家的比例（0.4%/月 ≈ 4.8%/年）。 */
export const UPKEEP_RATE = 0.004;
/** 最低月开销：再穷也要吃饭。 */
export const UPKEEP_MIN = 10;

export function monthlyUpkeep(wealth: number): number {
  return Math.max(UPKEEP_MIN, Math.round(wealth * UPKEEP_RATE));
}

/** 扣当月开销，返回实际扣掉的铜币（钱不够时扣到 0 为止）。 */
export function settleMonthlyUpkeep(state: WorldState): number {
  const player = state.characters[state.playerId];
  if (!player?.alive) return 0;
  const fee = Math.min(player.wealth, monthlyUpkeep(player.wealth));
  if (fee <= 0) return 0;
  player.wealth -= fee;
  return fee;
}
