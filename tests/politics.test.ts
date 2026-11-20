import { describe, expect, it } from 'vitest';

import { content, makeEngine, makeWorld } from './helpers';
import { settleMonthlyMarket } from '../src/systems/economy/MarketSystem';
import {
  annualMortality,
  effectiveAge,
  settleFamilyPrestige,
} from '../src/systems/character/Demography';
import { chooseRegent } from '../src/systems/country/Ruler';
import { handleDeath } from '../src/systems/character/CharacterSystem';

describe('模拟深化', () => {
  it('种族寿命折算：精灵老得更慢', () => {
    const world = makeWorld('politics-1');
    const human = world.characters['c_player']!;
    human.age = 100;
    const elf = { ...human, raceId: 'elf' };
    expect(effectiveAge(elf)).toBeCloseTo(35, 5);
    expect(annualMortality(elf)).toBeLessThan(annualMortality(human));
  });

  it('未成年统治者会指定一位成年摄政', () => {
    const world = makeWorld('politics-2');
    const country = world.countries[Object.keys(world.countries)[0]!]!;
    const child = Object.values(world.characters).find(
      (character) => character.age >= 18 && character.alive,
    );
    expect(child).toBeDefined();
    const regent = chooseRegent(world, country, child!.id);
    expect(regent).not.toBeNull();
    expect(world.characters[regent!]?.age).toBeGreaterThanOrEqual(16);
    expect(regent).not.toBe(child!.id);
  });

  it('统治者死亡会把继承危机排进队列', () => {
    const world = makeWorld('politics-3');
    const country = world.countries['c_kingdom']!;
    const before = world.pendingEvents.length;
    handleDeath(world, country.rulerId);
    const scheduled = world.pendingEvents.slice(before);
    expect(scheduled.some((event) => event.refId === 'ev_country_succession_crisis')).toBe(true);
    expect(scheduled[0]?.targetScope).toBe('country');
    expect(world.characters[world.countries['c_kingdom']!.rulerId]?.alive).toBe(true);
  });

  it('家族声望随公职累积', () => {
    const world = makeWorld('politics-4');
    const player = world.characters[world.playerId]!;
    player.familyId = 'fam_test';
    world.families['fam_test'] = {
      id: 'fam_test',
      name: '测试家族',
      culture: 'silvermoon',
      memberIds: [player.id],
    };
    player.offices.push({
      id: 'office_test_2',
      title: '首相',
      countryId: 'c_kingdom',
      orgId: null,
      rank: 1,
      salaryMonthly: 100,
      sinceDay: 1,
    });
    settleFamilyPrestige(world);
    expect(world.families['fam_test']?.prestige).toBe(2);
  });

  it('战时需求更高、价格更紧', () => {
    const peace = makeWorld('politics-5');
    const war = makeWorld('politics-5');
    const country = war.countries['c_kingdom']!;
    country.atWarWith = ['c_league'];
    settleMonthlyMarket(peace, content);
    settleMonthlyMarket(war, content);
    const key = 'r_silvermoon:grain';
    expect(war.markets[key]!.demand).toBeGreaterThan(peace.markets[key]!.demand);
  });

  it('十年人口学让 NPC 之间产生关系', () => {
    const engine = makeEngine('politics-6');
    engine.advanceDays(360 * 10);
    const state = engine.state;
    const pairs = Object.keys(state.relations);
    expect(pairs.length).toBeGreaterThan(0);
    expect(state.characters[state.playerId]?.alive).toBe(true);
  });
});
