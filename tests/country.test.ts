/**
 * 国家系统：预算恒等式、政策三阶段与游说命令。
 */

import { describe, expect, it } from 'vitest';
import { content, makeWorld } from './helpers/index';
import { applyCommand } from '../src/core/CommandBus';
import { Random } from '../src/core/Random';
import { monthKeyOf } from '../src/core/WorldState';
import { capitalOf } from '../src/systems/country/Offices';
import { settleMonthlyCountry } from '../src/systems/country/CountrySystem';
import {
  capitalWeight,
  evaluatePolicyPressure,
  runPolicyRound,
} from '../src/systems/country/PolicySystem';

function context(day: number, rng: Random) {
  return { day, periodKey: monthKeyOf(day), phase: 3 as const, rng };
}

describe('国家预算', () => {
  it('月度预算满足收支恒等式，且国库/债务不为负', () => {
    const world = makeWorld('budget');
    const before = new Map(
      Object.values(world.countries).map((country) => [
        country.id,
        { treasury: country.treasury, debt: country.debt },
      ]),
    );
    const rng = new Random('budget');
    const budgets = settleMonthlyCountry(world, content, context(30, rng));

    expect(budgets.length).toBe(7);
    for (const budget of budgets) {
      expect(budget.balance).toBe(budget.revenue - budget.expense);
      expect(budget.treasuryAfter).toBeGreaterThanOrEqual(0);
      expect(budget.debtAfter).toBeGreaterThanOrEqual(0);

      const start = before.get(budget.countryId);
      expect(start).toBeDefined();
      if (!start) continue;
      const repaid = start.debt - budget.debtAfter;
      // 期初国库 + 结余 − 还债 − 公共工程 = 期末国库
      expect(start.treasury + budget.balance - repaid - budget.publicWorks).toBe(
        budget.treasuryAfter,
      );
    }
  });

  it('赤字会转化为债务而不是负国库', () => {
    const world = makeWorld('deficit');
    const country = world.countries['c_kingdom'];
    expect(country).toBeDefined();
    if (!country) return;
    country.treasury = 0;
    country.policies.militaryShare = 0.9;
    country.policies.taxRate = 0;

    const rng = new Random('deficit');
    const budget = settleMonthlyCountry(world, content, context(30, rng)).find(
      (entry) => entry.countryId === 'c_kingdom',
    );
    expect(budget?.balance).toBeLessThan(0);
    expect(budget?.treasuryAfter).toBe(0);
    expect(budget?.debtAfter).toBeGreaterThan(0);
  });
});

describe('政策三阶段', () => {
  it('民生短缺会产生监管压力', () => {
    const world = makeWorld('pressure');
    for (const market of Object.values(world.markets)) {
      market.stock = 0;
    }
    const pressures = evaluatePolicyPressure(world, 'c_kingdom');
    expect(pressures.some((pressure) => pressure.policy === 'regulation')).toBe(true);
  });

  it('年度赤字会触发增税提案，且政策始终在 0–1 内', () => {
    const world = makeWorld('policy');
    const country = world.countries['c_kingdom'];
    expect(country).toBeDefined();
    if (!country) return;
    // 战争级的财政崩溃：债务远超年收入，才够 0.7 的压力门槛。
    country.debt = 200000;
    country.treasury = 0;
    country.legitimacy = 0.45;
    country.stability = 0.4;

    const proposals = runPolicyRound(
      world,
      context(90, new Random('policy')),
      90,
      content.balance.policy,
    );
    expect(proposals.length).toBeGreaterThan(0);

    for (const value of Object.values(world.countries['c_kingdom']?.policies ?? {})) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('共和制的资本权重会随国内组织资产变化', () => {
    const world = makeWorld('capital');
    const before = capitalWeight(world, 'c_league');
    world.organizations['o_bluewave']!.assets += 100_000;
    const after = capitalWeight(world, 'c_league');
    expect(after).toBeGreaterThan(before);
  });
});

describe('游说命令', () => {
  it('降低关税会同时扣减组织现金', () => {
    const world = makeWorld('lobby');
    const country = world.countries['c_kingdom'];
    expect(country).toBeDefined();
    if (!country) return;
    const player = world.characters[world.playerId]!;
    player.regionId = capitalOf(world, 'c_kingdom')!;
    const cashBefore = new Map(
      Object.values(world.organizations).map((org) => [org.id, org.cash] as const),
    );
    const before = country.policies.tariffRate;

    const result = applyCommand(
      world,
      { kind: 'lobby', countryId: 'c_kingdom', policy: 'tariffRate', delta: -0.1 },
      content,
    );

    expect(result.ok).toBe(true);
    expect(country.policies.tariffRate).toBeLessThan(before);
    const spent = Object.values(world.organizations).some(
      (org) => org.cash < (cashBefore.get(org.id) ?? org.cash),
    );
    expect(spent).toBe(true);
  });

  it('单次游说幅度超过 0.2 会被拒绝', () => {
    const world = makeWorld('lobby-deny');
    const result = applyCommand(
      world,
      { kind: 'lobby', countryId: 'c_kingdom', policy: 'taxRate', delta: 0.5 },
      content,
    );
    expect(result.ok).toBe(false);
  });
});
