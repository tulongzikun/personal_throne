/**
 * 组织系统：会计恒等式、命令语义与领袖继承。
 */

import { describe, expect, it } from 'vitest';
import { content, makeEngine, makeWorld } from './helpers/index';
import { applyCommand } from '../src/core/CommandBus';
import { handleDeath } from '../src/systems/character/CharacterSystem';
import { equityOf, settleMonthlyFinance } from '../src/systems/organization/Finance';
import { successionOrder, valuation } from '../src/systems/organization/Organization';
import { monthlyOrganizationSettlement } from '../src/systems/organization/OrganizationSystem';
import { Random } from '../src/core/Random';
import { monthKeyOf } from '../src/core/WorldState';

describe('组织财务', () => {
  it('每月结算满足 equity_after = equity_before + profit − tax', () => {
    const world = makeWorld('finance');
    const entries = settleMonthlyFinance(world, content);
    expect(entries.length).toBeGreaterThan(0);

    for (const entry of entries) {
      const expected = entry.equityBefore + entry.profit - entry.tax;
      expect(Math.abs(entry.equityAfter - expected), entry.orgId).toBeLessThanOrEqual(1);
    }
  });

  it('权益恒等式与资产负债一致', () => {
    for (const org of Object.values(makeWorld('equity').organizations)) {
      expect(equityOf(org)).toBe(org.cash + org.assets - org.liabilities);
      expect(Number.isFinite(valuation(org))).toBe(true);
    }
  });

  it('月度编排不会让现金、资产、负债出现负数', () => {
    const world = makeWorld('settle');
    const rng = new Random('settle');
    for (let month = 0; month < 24; month += 1) {
      const day = 30 * (month + 1);
      world.clock.day = day;
      monthlyOrganizationSettlement(world, content, {
        day,
        periodKey: monthKeyOf(day),
        phase: 2,
        rng,
      });
    }

    for (const org of Object.values(world.organizations)) {
      expect(org.cash, org.id).toBeGreaterThanOrEqual(0);
      expect(org.assets, org.id).toBeGreaterThanOrEqual(0);
      expect(org.liabilities, org.id).toBeGreaterThanOrEqual(0);
      expect(org.members, org.id).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('组织命令', () => {
  it('投资把现金转为资产，且不改变权益', () => {
    const world = makeWorld('invest');
    const before = world.organizations['o_grainwheel'];
    expect(before).toBeDefined();
    const cashBefore = before?.cash ?? 0;
    const assetsBefore = before?.assets ?? 0;
    const equityBefore = equityOf(before as NonNullable<typeof before>);

    const result = applyCommand(
      world,
      { kind: 'invest', orgId: 'o_grainwheel', amount: 300 },
      content,
    );

    expect(result.ok).toBe(true);
    const after = world.organizations['o_grainwheel'];
    expect(after?.cash).toBe(cashBefore - 300);
    expect(after?.assets).toBe(assetsBefore + 300);
    expect(after ? equityOf(after) : 0).toBe(equityBefore);
  });

  it('超出控制权的组织会被拒绝', () => {
    const world = makeWorld('deny');
    const result = applyCommand(
      world,
      { kind: 'invest', orgId: 'o_ironhand', amount: 100 },
      content,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/控制权/);
  });

  it('成功后写入历史并留下审计摘要', () => {
    const engine = makeEngine('history');
    engine.dispatch({ kind: 'invest', orgId: 'o_grainwheel', amount: 120 });
    const last = engine.state.history[engine.state.history.length - 1];
    expect(last?.kind).toBe('command');
    expect(last?.summary).toMatch(/投资/);
  });
});

describe('领袖继承', () => {
  it('领袖死亡后由最大股东继任，且不会一人兼两职', () => {
    const world = makeWorld('succession');
    const order = successionOrder(world, 'o_grainwheel');
    // 继任顺序含在世股东，故领袖本人（最大股东）仍在首位；死亡后被过滤。
    expect(order[0]).toBe('c_player');
    expect(order.filter((id) => id !== 'c_player')[0]).toBe('c_grainwheel_hob');

    const successions = handleDeath(world, 'c_player');
    expect(successions.some((item) => item.orgId === 'o_grainwheel')).toBe(true);

    const org = world.organizations['o_grainwheel'];
    expect(org?.leadership.leaderId).toBe('c_grainwheel_hob');

    const leaders = Object.values(world.organizations).map((item) => item.leadership.leaderId);
    expect(new Set(leaders).size).toBe(leaders.length);
  });

  it('统治者死亡会转移统治权且不复制资产', () => {
    const world = makeWorld('ruler-death');
    const before = world.characters['c_king_aerik'];
    const treasuryBefore = world.countries['c_kingdom']?.treasury;

    handleDeath(world, 'c_king_aerik');

    expect(world.characters['c_king_aerik']?.alive).toBe(false);
    expect(world.characters['c_king_aerik']?.wealth).toBe(before?.wealth);
    expect(world.countries['c_kingdom']?.rulerId).not.toBe('c_king_aerik');
    expect(world.countries['c_kingdom']?.treasury).toBe(treasuryBefore);
  });
});
