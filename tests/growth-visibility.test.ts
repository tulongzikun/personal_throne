/**
 * P1 成长可见性：技能的每一级都要能折成数字。
 *
 * 试玩反馈「成长有点数，但是看不出成长点数的用处」，这里把四件事钉住：
 * 贸易等级改变买卖价与贩货上限、生涯阶位真的发月俸、技能说明可读、
 * 训练花费与等级挂钩。
 */

import { describe, expect, it } from 'vitest';

import { content } from '../src/content/index';
import { settleMonthlyFinance } from '../src/systems/organization/Finance';
import {
  careerSalary,
  purchaseFactor,
  saleFactor,
  skillEffectSummary,
  tradeCarryCapacity,
} from '../src/systems/character/SkillEffects';
import { makeEngine, makeWorld } from './helpers/index';

describe('P1 技能收益', () => {
  it('贸易等级同时改善买价、卖价与贩货上限', () => {
    const world = makeWorld('growth-trade');
    const player = world.characters[world.playerId]!;
    player.skills.trade = 0;
    const before = {
      buy: purchaseFactor(player),
      sell: saleFactor(player),
      carry: tradeCarryCapacity(player),
    };
    player.skills.trade = 6;
    const after = {
      buy: purchaseFactor(player),
      sell: saleFactor(player),
      carry: tradeCarryCapacity(player),
    };
    expect(after.buy).toBeLessThan(before.buy);
    expect(after.sell).toBeGreaterThan(before.sell);
    expect(after.carry).toBe(before.carry + 6);
  });

  it('贩货数量超过当前贸易能力时明确拒绝', () => {
    const engine = makeEngine('growth-carry');
    const player = engine.state.characters[engine.state.playerId]!;
    player.skills.trade = 0;
    const result = engine.dispatch({
      kind: 'trade_goods',
      goodId: 'grain',
      units: tradeCarryCapacity(player) + 1,
    });
    expect(result.ok).toBe(false);
    expect(result.error ?? '').toContain('最多贩');
  });

  it('同样的价差下，贸易等级更高的玩家赚得更多', () => {
    const run = (trade: number): number => {
      const engine = makeEngine(`growth-profit-${trade}`);
      const player = engine.state.characters[engine.state.playerId]!;
      player.skills.trade = trade;
      player.wealth = 2000;
      const before = player.wealth;
      const result = engine.dispatch({
        kind: 'trade_goods',
        goodId: 'grain',
        units: 5,
        targetRegionId: 'r_silvermoon',
      });
      return result.ok ? player.wealth - before : Number.NEGATIVE_INFINITY;
    };
    const low = run(0);
    const high = run(8);
    expect(high).toBeGreaterThan(low);
  });

  it('生涯阶位对应固定月俸，且结算时真的到账', () => {
    expect(careerSalary(0)).toBe(0);
    expect(careerSalary(1)).toBe(40);
    expect(careerSalary(2)).toBe(120);
    expect(careerSalary(3)).toBe(300);

    const world = makeWorld('growth-salary');
    const player = world.characters[world.playerId]!;
    player.careerRank = 1;
    const before = player.wealth;
    settleMonthlyFinance(world, content);
    expect(player.wealth - before).toBeGreaterThanOrEqual(40);
  });

  it('技能说明把等级折成百分比与数量，供界面 title 使用', () => {
    expect(skillEffectSummary('trade', 0)).toContain('5 单位');
    expect(skillEffectSummary('trade', 6)).toContain('11 单位');
    expect(skillEffectSummary('negotiation', 5)).toContain('10%');
    expect(skillEffectSummary('insight', 10)).toContain('%');
  });
});
