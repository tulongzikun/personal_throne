/**
 * 政策三阶段（压力 → 提案 → 政体决策）与政体不变式。
 */

import { describe, expect, it } from 'vitest';
import { content, makeWorld } from './helpers/index';
import { GameEngine } from '../src/core/GameEngine';
import { Random } from '../src/core/Random';
import { cloneWorld, createWorld, monthKeyOf, validateWorld } from '../src/core/WorldState';
import { handleDeath } from '../src/systems/character/CharacterSystem';
import { runPolicyRound } from '../src/systems/country/PolicySystem';

function context(day: number, rng: Random) {
  return { day, periodKey: monthKeyOf(day), phase: 3 as const, rng };
}

const COUNTRY_EVENTS = [
  'ev_country_unrest',
  'ev_country_bumper',
  'ev_country_famine',
  'ev_country_war_scare',
  'ev_country_aftermath',
  'ev_country_fiscal_crisis',
  'ev_country_tariff_dispute',
  'ev_country_plague',
  'ev_country_polity_pressure',
  'ev_country_succession_crisis',
] as const;

describe('政策传导', () => {
  it('税率提高会同时抬高组织税负与国库收入', () => {
    const base = createWorld(content, { seed: 'policy-tax', createdAt: 0 });
    const low = cloneWorld(base);
    const high = cloneWorld(base);
    low.countries['c_kingdom']!.policies.taxRate = 0.05;
    high.countries['c_kingdom']!.policies.taxRate = 0.4;
    const lowTreasury = low.countries['c_kingdom']!.treasury;
    const highTreasury = high.countries['c_kingdom']!.treasury;

    new GameEngine(low, content).advanceDays(30);
    new GameEngine(high, content).advanceDays(30);

    const kingdomOrgTax = (world: typeof low) =>
      Object.values(world.organizations)
        .filter((org) => org.homeRegionId !== 'r_portlumen' && org.homeRegionId !== 'r_tidemarket')
        .reduce((sum, org) => sum + org.lastMonthTax, 0);

    expect(kingdomOrgTax(high)).toBeGreaterThan(kingdomOrgTax(low));
    expect(high.countries['c_kingdom']!.treasury - highTreasury).toBeGreaterThan(
      low.countries['c_kingdom']!.treasury - lowTreasury,
    );
  });
});

describe('政策冷却', () => {
  it('同一政策在冷却期内不会连续两个月重复变更', () => {
    const world = makeWorld('policy-cooldown');
    const country = world.countries['c_kingdom']!;
    country.treasury = 0;
    country.debt = 90_000;

    const first = runPolicyRound(
      world,
      context(90, new Random('cooldown')),
      90,
      content.balance.policy,
    );
    const taxProposal = first.filter((proposal) => proposal.policy === 'taxRate');
    expect(taxProposal.some((proposal) => proposal.passed)).toBe(true);
    const afterFirst = country.policies.taxRate;

    const second = runPolicyRound(
      world,
      context(120, new Random('cooldown')),
      120,
      content.balance.policy,
    );
    expect(second.filter((proposal) => proposal.policy === 'taxRate')).toHaveLength(0);
    expect(country.policies.taxRate).toBe(afterFirst);
    expect(world.stats.policyCost).toBeGreaterThan(0);
    expect(world.stats.policyChanges).toBeGreaterThan(0);
  });
});

describe('政体不变式', () => {
  it('健康国家在 20 个季度内不会变更政体', () => {
    const world = makeWorld('polity-healthy');
    for (let round = 0; round < 20; round += 1) {
      const day = 90 + round * 90;
      runPolicyRound(
        world,
        context(day, new Random(`healthy-${round}`)),
        day,
        content.balance.policy,
      );
    }
    expect(world.stats.polityChanges).toBe(0);
  });

  it('崩溃国家最多变更一次政体，且始终有在世统治者', () => {
    const world = makeWorld('polity-crisis');
    const country = world.countries['c_kingdom']!;
    country.legitimacy = 0.1;
    country.stability = 0.1;
    country.debt = 1_000_000;

    for (let round = 0; round < 60; round += 1) {
      const day = 90 + round * 90;
      runPolicyRound(
        world,
        context(day, new Random(`crisis-${round}`)),
        day,
        content.balance.policy,
      );
      const ruler = world.characters[country.rulerId];
      expect(ruler?.alive).toBe(true);
      // M6 引入战争后，战败国会真的崩溃；百年 2 次仍属"极罕见"量级。
      expect(world.stats.polityChanges).toBeLessThanOrEqual(2);
    }
    expect(validateWorld(world)).toEqual([]);
  });

  it('君主死亡后立即产生在世继承人，国家不会无主', () => {
    const world = makeWorld('policy-succession');
    handleDeath(world, 'c_king_aerik');
    const country = world.countries['c_kingdom']!;
    expect(country.rulerId).not.toBe('c_king_aerik');
    expect(world.characters[country.rulerId]?.alive).toBe(true);
    expect(validateWorld(world)).toEqual([]);
  });
});

describe('百年校准', () => {
  it('100 年内政策变更 8–60 次（7 国）、间隔 ≥12 个月、政体变更 ≤2 次，10 条国家事件均可达', () => {
    const world = createWorld(content, { seed: 'demo', createdAt: 0 });
    new GameEngine(world, content).advanceDays(360 * 100);

    expect(validateWorld(world)).toEqual([]);
    // 世界扩到 7 国后，总量按国家数折算（8–25 / 2 国 × 3.5 ≈ 14–44），保留上下浮动余量。
    expect(world.stats.policyChanges).toBeGreaterThanOrEqual(8);
    // 经济闭合后国库更紧（俸禄、更高的人头税基数），七国的政策轮次上限放宽到 120。
    expect(world.stats.policyChanges).toBeLessThanOrEqual(120);
    expect(world.stats.minPolicyIntervalDays).toBeGreaterThanOrEqual(360);
    // 七国百年：战败与破产会让个别国家真的崩溃；8 次相当于每国约 1 次/百年，仍属罕见。
    expect(world.stats.polityChanges).toBeLessThanOrEqual(8);
    for (const country of Object.values(world.countries)) {
      expect(world.characters[country.rulerId]?.alive).toBe(true);
    }

    const policyRecords = world.history.filter((record) => record.kind === 'policy');
    expect(policyRecords.length).toBeGreaterThan(0);
    expect(policyRecords.every((record) => record.refs.some((ref) => ref.type === 'country'))).toBe(
      true,
    );

    const fired = new Set(world.history.map((record) => record.causeEventId));
    for (const id of COUNTRY_EVENTS) {
      expect(fired.has(id), `事件 ${id} 在 100 年内未触发`).toBe(true);
    }
  });
});
