import { describe, expect, it } from 'vitest';
import { content, makeEngine, makeWorld } from './helpers/index';
import { chooseRegent, chooseRuler, installRuler } from '../src/systems/country/Ruler';
import { settleMonthlyCountry } from '../src/systems/country/CountrySystem';
import { buildCharacter } from '../src/core/WorldState';
import { Random } from '../src/core/Random';
import { seedRulerDynasties } from '../src/systems/character/Dynasty';

describe('阶段 4：继承法与僵尸国', () => {
  it('王朝：未开局的在位者会被补上配偶与两个孩子', () => {
    const engine = makeEngine('dynasty');
    const country = engine.state.countries['c_highvale']!;
    const ruler = engine.state.characters[country.rulerId]!;
    expect(ruler.spouseId).toBeTruthy();
    const children = Object.values(engine.state.characters).filter((c) =>
      c.parentIds.includes(ruler.id),
    );
    expect(children.length).toBeGreaterThanOrEqual(2);
    // 幂等：再补一次不新增
    const before = Object.keys(engine.state.characters).length;
    expect(seedRulerDynasties(engine.state, content)).toBe(0);
    expect(Object.keys(engine.state.characters).length).toBe(before);
  });

  it('primogeniture：在位者死亡后由在世子女中年长者继位', () => {
    const world = makeWorld('primogeniture');
    const country = world.countries['c_highvale']!;
    expect(country.succession).toBe('primogeniture');
    const ruler = world.characters[country.rulerId]!;
    world.characterSeq += 1;
    const elder = buildCharacter({
      id: 'c_test_elder',
      name: '长女',
      raceId: 'human',
      classId: 'noble',
      age: 30,
      regionId: country.regionIds[0]!,
      organizationId: null,
      wealth: 0,
      skills: {},
      traits: {},
      parentIds: [ruler.id, null],
      generation: ruler.generation + 1,
    });
    const younger = buildCharacter({
      id: 'c_test_younger',
      name: '次子',
      raceId: 'human',
      classId: 'noble',
      age: 24,
      regionId: country.regionIds[0]!,
      organizationId: null,
      wealth: 0,
      skills: {},
      traits: {},
      parentIds: [ruler.id, null],
      generation: ruler.generation + 1,
    });
    world.characters[elder.id] = elder;
    world.characters[younger.id] = younger;
    ruler.alive = false;
    expect(chooseRuler(world, country)).toBe(elder.id);
  });

  it('摄政有年龄上限：70 岁以上的人不再摄政', () => {
    const world = makeWorld('regent');
    const country = world.countries['c_highvale']!;
    const ruler = world.characters[country.rulerId]!;
    world.characterSeq += 1;
    const ancient = buildCharacter({
      id: 'c_test_ancient',
      name: '人瑞',
      raceId: 'human',
      classId: 'noble',
      age: 128,
      regionId: country.regionIds[0]!,
      organizationId: null,
      wealth: 0,
      skills: { law: 9, persuasion: 9 },
      traits: { authority: 0.9 },
    });
    world.characters[ancient.id] = ancient;
    expect(chooseRegent(world, country, ruler.id)).not.toBe(ancient.id);
  });

  it('0 地区国挂账 48 个月后灭亡，且不能复活', () => {
    const world = makeWorld('extinct');
    const country = world.countries['c_steppe']!;
    country.regionIds = [];
    const ctx = { day: 30, periodKey: 'm', phase: 4 as never, rng: new Random('extinct') };
    for (let month = 0; month < 47; month += 1) settleMonthlyCountry(world, content, ctx);
    expect(country.extinct).toBe(false);
    settleMonthlyCountry(world, content, ctx);
    expect(country.extinct).toBe(true);
    expect(country.debt).toBe(0);
    // 已经被别人占了地又还回来，也不会复活
    country.regionIds = [Object.keys(world.regions)[0]!];
    settleMonthlyCountry(world, content, ctx);
    expect(country.extinct).toBe(true);
  });

  it('已解散的组织不会因为旧领袖死亡重新进入危机', () => {
    const engine = makeEngine('dissolved');
    const org = Object.values(engine.state.organizations).find((o) => o.lifecycle !== 'dissolved')!;
    org.lifecycle = 'dissolved';
    const leaderId = org.leadership.leaderId;
    const leader = engine.state.characters[leaderId]!;
    leader.alive = false;
    engine.advanceDays(30);
    expect(engine.state.organizations[org.id]!.lifecycle).toBe('dissolved');
  });

  it('任何组织的股份合计都不会超过 100%', () => {
    const engine = makeEngine('shares');
    engine.advanceDays(360 * 20);
    for (const org of Object.values(engine.state.organizations)) {
      const total = org.shares.reduce((sum, entry) => sum + entry.share, 0);
      expect(total).toBeLessThanOrEqual(1.0001);
      expect(total).toBeGreaterThanOrEqual(-1e-9);
    }
    // 保守起见，让 installRuler 也跑一遍（避免死循环/异常）
    const country = Object.values(engine.state.countries)[0]!;
    expect(installRuler(engine.state, country, country.polity)).toBeTruthy();
  });
});
