/**
 * 命令的时间成本（统一计划 W2：时间预算）。
 *
 * 「30 天」是唯一真正稀缺的资源：做一件事花掉几天，剩下的日子不会等人。
 * 这里只回答「这条命令要花多少天」，真正推进时间的是 `GameEngine.dispatch`
 * ——它先推进天数，再在抵达的那一天结算命令（所以贩货按抵达日价格算）。
 *
 * 行动力（注意力）则相反：每月 3 点，只约束要当面周旋、要托人打听的事。
 */

import type { Command } from '../../core/CommandBus';
import type { WorldState } from '../../core/WorldState';
import { DAYS_PER_MONTH, toDateParts } from '../../core/GameClock';
import { neighborsOf, tradeReach } from './Activity';

/** 固定耗时（天）。没有列出的命令默认 0 天。 */
const FIXED_DAYS: Readonly<Record<string, number>> = {
  seek_audience: 2,
  gift: 1,
  gossip: 3,
  inspect_market: 2,
  attend_court: 1,
  rest: 7,
  train: 30,
  change_career: 3,
  seek_office: 7,
  claim_leadership: 2,
  buy_shares: 1,
  sell_shares: 1,
  buy_asset: 2,
  sell_asset: 2,
  invest: 2,
  restructure: 10,
  recruit: 3,
  take_loan: 3,
  break_contract: 1,
  sign_contract: 1,
  open_route: 3,
  lobby: 2,
  levy_army: 10,
  march_army: 15,
  offer_peace: 3,
};

/** 只需要打个照面、不需要出门的事，不占天数。 */
const INSTANT = new Set([
  'choose',
  'deposit',
  'withdraw',
  'set_strategy',
  'repay_debt',
  'end_month',
]);

/** 这条命令要花多少天（不含已经消耗的日子）。 */
export function commandDays(state: WorldState, command: Command): number {
  if (INSTANT.has(command.kind)) return 0;
  if (command.kind === 'move') {
    const player = state.characters[state.playerId];
    if (!player) return 0;
    const hop = neighborsOf(state, player.regionId).find((link) => link.id === command.regionId);
    return hop?.days ?? 0;
  }
  if (command.kind === 'trade_goods') {
    const player = state.characters[state.playerId];
    if (!player) return 0;
    const links = tradeReach(state, player.regionId);
    const target = command.targetRegionId
      ? links.find((link) => link.id === command.targetRegionId)
      : links[0];
    return target?.days ?? 0;
  }
  return FIXED_DAYS[command.kind] ?? 0;
}

/** 要当面周旋、要托人打听的事才占行动力。 */
export const ATTENTION_COMMANDS: ReadonlySet<string> = new Set([
  'seek_audience',
  'gift',
  'gossip',
  'inspect_market',
  'attend_court',
]);

/** 本月还剩几天（含今天）。 */
export function daysLeftInMonth(state: WorldState): number {
  return DAYS_PER_MONTH - toDateParts(state.clock.day).dayOfMonth + 1;
}
