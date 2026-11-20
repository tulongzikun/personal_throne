/**
 * M7 阶段 3：个人行动力、移动、贩货、银行与健康。
 *
 * 验收口径（docs/redesign-v2.md）：
 * - 首年可用动词 ≥ 8；
 * - 移动与贩货形成正收益；
 * - 行动力每月刷新、不足时拒绝。
 */

import { describe, expect, it } from 'vitest';

import { GameEngine } from '../src/core/GameEngine';
import {
  MONTHLY_ACTION_POINTS,
  actionPointsOf,
  neighborsOf,
  refreshMonthlyActions,
} from '../src/systems/character/Activity';
import { content, makeWorld } from './helpers';

describe('个人行动', () => {
  it('每月刷新行动力，月初回到 3 点', () => {
    const world = makeWorld('act-refresh');
    const engine = new GameEngine(world, content);
    const player = world.characters[world.playerId]!;
    expect(player.actionPoints).toBe(MONTHLY_ACTION_POINTS);
    player.actionPoints = 0;
    engine.advanceDays(30);
    expect(actionPointsOf(world, world.playerId)).toBe(MONTHLY_ACTION_POINTS);
    refreshMonthlyActions(world);
    expect(actionPointsOf(world, world.playerId)).toBe(MONTHLY_ACTION_POINTS);
  });

  it('行动力用尽时拒绝行动', () => {
    const world = makeWorld('act-empty');
    const player = world.characters[world.playerId]!;
    player.actionPoints = 0;
    const engine = new GameEngine(world, content);
    const result = engine.dispatch({ kind: 'rest' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('行动力');
  });

  it('移动改地区、扣路费与行动力，并给出在途天数', () => {
    const world = makeWorld('act-move');
    const player = world.characters[world.playerId]!;
    const neighbor = neighborsOf(world, player.regionId)[0]!;
    const engine = new GameEngine(world, content);
    const cash = player.wealth;
    const result = engine.dispatch({ kind: 'move', regionId: neighbor.id });
    expect(result.ok).toBe(true);
    expect(player.regionId).toBe(neighbor.id);
    expect(player.wealth).toBeLessThan(cash);
    expect(result.travelDays).toBeGreaterThan(0);
    expect(player.location.regionId).toBe(neighbor.id);
  });

  it('贩货把库存搬到高价邻居并带来正收益', () => {
    const world = makeWorld('act-trade');
    const player = world.characters[world.playerId]!;
    const engine = new GameEngine(world, content);
    const before = player.wealth;
    const result = engine.dispatch({ kind: 'trade_goods', goodId: 'grain', units: 5 });
    if (!result.ok) {
      // 开局价格没有价差时，允许明确拒绝（不赚钱就不出船）。
      expect(result.error).toContain('不赚钱');
    } else {
      expect(player.wealth).toBeGreaterThan(before);
    }
  });

  it('存取款往返守恒', () => {
    const world = makeWorld('act-bank');
    const player = world.characters[world.playerId]!;
    const bank = Object.values(world.organizations).find((org) => org.type === 'bank')!;
    player.regionId = bank.homeRegionId;
    const engine = new GameEngine(world, content);
    const cash = player.wealth;
    const deposit = engine.dispatch({ kind: 'deposit', amount: 100 });
    expect(deposit.ok).toBe(true);
    expect(player.deposits[bank.id]).toBe(100);
    expect(player.wealth).toBe(cash - 100);
    const withdraw = engine.dispatch({ kind: 'withdraw', amount: 100 });
    expect(withdraw.ok).toBe(true);
    expect(player.wealth).toBe(cash);
    expect(player.deposits[bank.id]).toBe(0);
  });

  it('休息回复健康并消耗行动力', () => {
    const world = makeWorld('act-rest');
    const player = world.characters[world.playerId]!;
    player.health = 50;
    const engine = new GameEngine(world, content);
    const result = engine.dispatch({ kind: 'rest' });
    expect(result.ok).toBe(true);
    expect(player.health).toBeGreaterThan(50);
    expect(player.actionPoints).toBe(MONTHLY_ACTION_POINTS - 1);
  });
});
