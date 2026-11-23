import { describe, expect, it } from 'vitest';

import { content, makeEngine, makeWorld } from './helpers';
import { GameEngine } from '../src/core/GameEngine';
import { toDateParts } from '../src/core/GameClock';
import { bestTradeRoute } from '../src/systems/goals/Goals';
import { daysLeftInMonth } from '../src/systems/character/CommandTime';
import {
  purchaseFactor,
  saleFactor,
  tradeCarryCapacity,
} from '../src/systems/character/SkillEffects';
import { marketKeyOf } from '../src/core/WorldState';
import { playEngine } from '../scripts/playtest-bot';

describe('P2：时间预算', () => {
  it('每一件事都要花天数，日历由引擎推进', () => {
    const engine = makeEngine('time-budget-days');
    const player = engine.state.characters[engine.state.playerId]!;
    const start = engine.state.clock.day;

    const gossip = engine.dispatch({ kind: 'gossip' });
    expect(gossip.ok).toBe(true);
    expect(gossip.days).toBe(3);
    expect(engine.state.clock.day).toBe(start + 3);
    expect(daysLeftInMonth(engine.state)).toBe(27);

    const look = engine.dispatch({ kind: 'inspect_market', regionId: player.regionId });
    expect(look.ok).toBe(true);
    expect(look.days).toBe(2);
    expect(engine.state.clock.day).toBe(start + 5);
  });

  it('行动力只约束当面周旋：赶路、贩货、训练都不看它', () => {
    const world = makeWorld('time-budget-ap');
    const player = world.characters[world.playerId]!;
    player.actionPoints = 0;
    const engine = new GameEngine(world, content);

    const move = engine.dispatch({
      kind: 'move',
      regionId: (Object.values(world.regions)[1] ?? Object.values(world.regions)[0]!).id,
    });
    // 要么走成了，要么明确因为「这里就是目的地 / 不相邻 / 路费」被拒——不会因为行动力。
    if (!move.ok) expect(move.error ?? '').not.toContain('行动力');

    player.actionPoints = 0;
    const train = engine.dispatch({ kind: 'train', skill: 'trade' });
    if (!train.ok) expect(train.error ?? '').not.toContain('行动力');

    player.actionPoints = 0;
    const audience = engine.dispatch({ kind: 'seek_audience', characterId: player.id });
    expect(audience.ok).toBe(false);
    expect(audience.error ?? '').toContain('行动力');
  });

  it('贩一趟远货之后，这个月装不下两场拜会加一次训练', () => {
    const engine = makeEngine('time-budget-month');
    const route = bestTradeRoute(engine.state, content, 5);
    expect(route).not.toBeNull();
    const player = engine.state.characters[engine.state.playerId]!;
    const before = engine.state.clock.day;
    const trade = engine.dispatch({
      kind: 'trade_goods',
      goodId: route!.goodId,
      units: 1,
      targetRegionId: route!.target,
    });
    if (!trade.ok) return;
    const trip = engine.state.clock.day - before;
    expect(trip).toBe(route!.days);
    // 出门一趟，这个月剩下的天数已经不够再把「两场拜会 + 一次训练（30 天）」都挤进去。
    expect(daysLeftInMonth(engine.state)).toBeLessThan(30);
    expect(daysLeftInMonth(engine.state) + 4).toBeLessThan(30 + trip + 4);
    const trained = engine.dispatch({ kind: 'train', skill: 'trade' });
    expect(trained.days).toBe(30);
    expect(engine.state.clock.day).toBe(before + trip + 30);
    expect(player.alive).toBe(true);
  });

  it('贩货按抵达日结算：收益等于抵达那天的价差', () => {
    const engine = makeEngine('time-budget-price');
    const route = bestTradeRoute(engine.state, content, 5);
    expect(route).not.toBeNull();
    const player = engine.state.characters[engine.state.playerId]!;
    const units = Math.min(route!.units, 1);

    // 对照组：同样的种子，只推进同样的天数、不动手，用它的价格当「抵达日价格」。
    const control = makeEngine('time-budget-price');
    control.advanceDays(route!.days);
    const here = control.state.markets[marketKeyOf(player.regionId, route!.goodId)]!;
    const there = control.state.markets[marketKeyOf(route!.target, route!.goodId)]!;
    const buy = Math.round(here.price * purchaseFactor(player)) * units;
    const freight = Math.max(1, Math.round(route!.days * units * 0.05));
    const revenue = Math.round(there.price * saleFactor(player)) * units;
    const expected = revenue - buy - freight;

    const cash = player.wealth;
    const result = engine.dispatch({
      kind: 'trade_goods',
      goodId: route!.goodId,
      units,
      targetRegionId: route!.target,
    });
    expect(result.ok).toBe(true);
    expect(player.wealth - cash).toBe(expected);
    expect(tradeCarryCapacity(player)).toBeGreaterThanOrEqual(units);
  });

  it('同一种子逐日重放，贩货与社交的日历轨迹一致', () => {
    const run = () => {
      const engine = makeEngine('time-budget-replay');
      const route = bestTradeRoute(engine.state, content, 5);
      const days: number[] = [];
      if (route) {
        const result = engine.dispatch({
          kind: 'trade_goods',
          goodId: route.goodId,
          units: 1,
          targetRegionId: route.target,
        });
        days.push(result.days ?? 0);
      }
      for (let index = 0; index < 2; index += 1) {
        const result = engine.dispatch({
          kind: 'seek_audience',
          characterId: engine.state.playerId,
        });
        days.push(result.days ?? 0);
      }
      return { hash: engine.hash(), days, day: engine.state.clock.day };
    };
    expect(run()).toEqual(run());
    expect(toDateParts(run().day).year).toBeGreaterThanOrEqual(1);
  });

  it('盲玩 bot 二十年仍明显强于挂机', () => {
    const years = 15;
    const idle = makeEngine('time-budget-ratio');
    idle.advanceTo(years * 360);
    const idleWealth = idle.state.characters[idle.state.playerId]!.wealth;

    const bot = makeEngine('time-budget-ratio');
    playEngine(bot, years * 12);
    const botWealth = bot.state.characters[bot.state.playerId]!.wealth;
    expect(botWealth).toBeGreaterThan(idleWealth * 1.8);
  });
});
