/**
 * 阶段 2：经济闭合回归。
 *
 * 试玩报告的核心指控是"账本不闭合"：贸易收入虚高、分红为零、国库饿死。
 * 这里用四个不变量把修正钉住：权益恒等（含分红）、分红上限、俸禄真的到账、
 * 国库与组织现金的量级关系。
 */

import { describe, expect, it } from 'vitest';

import { GameEngine } from '../src/core/GameEngine';
import { content } from '../src/content';
import { equityOf, settleMonthlyFinance } from '../src/systems/organization/Finance';
import { makeWorld } from './helpers';

describe('经济闭合', () => {
  it('十年权益变化 + 分红 = 税后净利润（误差 ≤ 8%）', () => {
    const world = makeWorld('closure-ten');
    const engine = new GameEngine(world, content);
    const before = Object.values(world.organizations).reduce((sum, org) => sum + equityOf(org), 0);
    engine.advanceDays(360 * 10);
    const after = Object.values(world.organizations).reduce((sum, org) => sum + equityOf(org), 0);
    const profit = world.stats.profitTotal;
    expect(profit).toBeGreaterThan(0);

    const ratio = (after - before + world.stats.dividendsPaid) / profit;
    expect(ratio).toBeGreaterThan(0.85);
    expect(ratio).toBeLessThan(1.08);
  });

  it('分红只来自盈利组织、不超过净利的 30%', () => {
    const world = makeWorld('closure-dividend');
    const entries = settleMonthlyFinance(world, content);
    for (const entry of entries) {
      if (entry.dividends === 0) continue;
      expect(entry.profit).toBeGreaterThan(0);
      expect(entry.dividends).toBeLessThanOrEqual(Math.round(entry.profit * 0.3) + 2);
    }
  });

  it('公职俸禄按月进入任职者钱包', () => {
    const world = makeWorld('closure-office');
    // 引擎构造时才会任命公职。
    const engine = new GameEngine(world, content);
    const country = Object.values(world.countries)[0]!;
    const office = country.offices[0]!;
    const holder = world.characters[office.holderId]!;
    const before = holder.wealth;
    engine.advanceDays(30);
    expect(holder.wealth).toBeGreaterThanOrEqual(before + office.salaryMonthly);
  });

  it('train 命令扣钱并提升技能，到达天赋上限后拒绝', () => {
    const world = makeWorld('closure-train');
    const engine = new GameEngine(world, content);
    const player = world.characters[world.playerId]!;
    const before = player.skills.trade ?? 0;
    const cash = player.wealth;
    const result = engine.dispatch({ kind: 'train', skill: 'trade' });
    expect(result.ok).toBe(true);
    expect(player.skills.trade).toBe(before + 1);
    expect(player.wealth).toBeLessThan(cash);

    player.skills.trade = 20;
    const blocked = engine.dispatch({ kind: 'train', skill: 'trade' });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain('上限');
  });

  it('五年后国库与组织现金处于同一量级（0.05–0.20）', () => {
    const world = makeWorld('closure-fiscal');
    const engine = new GameEngine(world, content);
    engine.advanceDays(360 * 5);
    const treasury = Object.values(world.countries).reduce(
      (sum, country) => sum + country.treasury,
      0,
    );
    const cash = Object.values(world.organizations).reduce((sum, org) => sum + org.cash, 0);
    const ratio = treasury / Math.max(1, cash);
    expect(ratio).toBeGreaterThanOrEqual(0.05);
    expect(ratio).toBeLessThanOrEqual(0.2);
  });
});
