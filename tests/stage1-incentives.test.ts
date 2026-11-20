import { describe, expect, it } from 'vitest';
import { content, makeEngine, makeWorld } from './helpers/index';
import { settleYearlyCareer, SALARY_DUTY_DAYS } from '../src/systems/character/Career';
import { monthlyUpkeep, settleMonthlyUpkeep } from '../src/systems/character/Upkeep';
import { tradeReach } from '../src/systems/character/Activity';
import { bestTradeRoute } from '../src/systems/goals/Goals';

describe('阶段 1：让「做事」成为最优解', () => {
  it('月俸只发给在岗的人：玩家脱岗 60 天后停发，NPC 照发', () => {
    const engine = makeEngine();
    const state = engine.state;
    const player = state.characters[state.playerId]!;
    const mate = Object.values(state.characters).find(
      (person) =>
        person.alive && person.id !== player.id && person.organizationId === player.organizationId,
    )!;
    player.careerRank = 2;
    mate.careerRank = 2;
    const org = state.organizations[player.organizationId!]!;
    org.cash = 1_000_000;
    org.payrollMonthly = 0;
    org.unpaidWages = 0;

    player.lastActionDay = state.clock.day;
    const before = { player: player.wealth, mate: mate.wealth };
    engine.advanceDays(30);
    expect(player.wealth).toBeGreaterThan(before.player);
    const mateGain = mate.wealth - before.mate;
    expect(mateGain).toBeGreaterThan(0);

    // 60 天没出手 → 玩家停发，同组织的 NPC 不受影响。
    engine.advanceDays(SALARY_DUTY_DAYS + 5);
    const stalled = { player: player.wealth, mate: mate.wealth };
    engine.advanceDays(30);
    expect(mate.wealth - stalled.mate).toBeGreaterThan(0);
    expect(player.wealth - stalled.player).toBeLessThan(mate.wealth - stalled.mate);
  });

  it('脱岗满 180 天的玩家不再自动晋升；出手后恢复', () => {
    const world = makeWorld();
    const player = world.characters[world.playerId]!;
    player.wealth = 20_000;
    player.skills.trade = 9;
    player.careerRank = 0;
    player.lastActionDay = 0;

    expect(settleYearlyCareer(world, 400).some((c) => c.characterId === player.id)).toBe(false);
    expect(player.careerRank).toBe(0);

    player.lastActionDay = 400;
    const changes = settleYearlyCareer(world, 420);
    expect(changes.some((c) => c.characterId === player.id && c.direction === 'up')).toBe(true);
  });

  it('每月开销随身家上涨，且不会把身家扣成负数', () => {
    expect(monthlyUpkeep(1_000)).toBe(10);
    expect(monthlyUpkeep(50_000)).toBeGreaterThan(monthlyUpkeep(5_000));
    const world = makeWorld();
    const player = world.characters[world.playerId]!;
    player.wealth = 50_000;
    const fee = settleMonthlyUpkeep(world);
    expect(fee).toBe(monthlyUpkeep(50_000));
    expect(player.wealth).toBe(50_000 - fee);

    player.wealth = 3;
    expect(settleMonthlyUpkeep(world)).toBe(3);
    expect(player.wealth).toBe(0);
  });

  it('贩货可以走两跳：边城市场也在商队视野里', () => {
    const world = makeWorld();
    const player = world.characters[world.playerId]!;
    const reach = tradeReach(world, player.regionId);
    const direct = world.regions[player.regionId]!.links.map((link) => link.to);
    expect(reach.length).toBeGreaterThan(direct.length);
    expect(reach.every((entry) => entry.days >= 1)).toBe(true);
  });

  it('最优路线给的是「现在真能走的一趟」：受现货与本钱约束', () => {
    const world = makeWorld();
    const player = world.characters[world.playerId]!;
    player.wealth = 5_000;
    const route = bestTradeRoute(world, content, 11);
    if (route) {
      const market = world.markets[`${player.regionId}:${route.goodId}`]!;
      expect(route.units).toBeLessThanOrEqual(Math.floor(market.stock));
      expect(route.profit).toBeGreaterThan(0);
    }
  });
});
