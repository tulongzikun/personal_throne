import { describe, expect, it } from 'vitest';
import { isAtWar, totalArmySize } from '../src/systems/military/WarSystem';
import { makeEngine } from './helpers/index';

function playerCountry(engine: ReturnType<typeof makeEngine>) {
  const state = engine.state;
  const player = state.characters[state.playerId]!;
  const region = state.regions[player.location.regionId]!;
  return state.countries[region.countryId]!;
}

/** 让玩家成为本国统治者，便于测试军团命令。 */
function asRuler(engine: ReturnType<typeof makeEngine>) {
  const country = playerCountry(engine);
  country.rulerId = engine.state.playerId;
  return country;
}

describe('军团指挥', () => {
  it('征兵增加兵力并按人数扣国库，超过人口 2% 被拒', () => {
    const engine = makeEngine('war-levy');
    const country = asRuler(engine);
    const army = engine.state.armies[`army:${country.id}`]!;
    const sizeBefore = army.size;
    const treasuryBefore = country.treasury;

    const result = engine.dispatch({ kind: 'levy_army', units: 60 });

    expect(result.ok).toBe(true);
    expect(army.size).toBe(sizeBefore + 60);
    expect(country.treasury).toBe(
      treasuryBefore - 60 * engine.content.balance.war.levyCostPerSoldier,
    );
    expect(totalArmySize(engine.state, country.id)).toBe(army.size);

    const tooMany = engine.dispatch({
      kind: 'levy_army',
      units: Math.ceil(country.population * 0.03),
    });
    expect(tooMany.ok).toBe(false);
  });

  it('行军把军队指向相邻地区并转入行军状态', () => {
    const engine = makeEngine('war-march');
    const country = asRuler(engine);
    const army = engine.state.armies[`army:${country.id}`]!;
    const here = engine.state.regions[army.locationRegionId]!;
    const next = here.links.map((link) => engine.state.regions[link.to]).find(Boolean)!;

    const result = engine.dispatch({ kind: 'march_army', regionId: next.id });

    expect(result.ok).toBe(true);
    expect(army.targetRegionId).toBe(next.id);
    expect(army.stance).toBe('march');
  });

  it('宣战与议和改写双向战争状态，且不能重复宣战', () => {
    const engine = makeEngine('war-diplomacy');
    const own = asRuler(engine);
    const target = Object.values(engine.state.countries).find((country) => country.id !== own.id)!;

    const first = engine.dispatch({ kind: 'declare_war', targetCountryId: target.id });
    expect(first.ok).toBe(true);
    expect(isAtWar(engine.state, own.id, target.id)).toBe(true);
    expect(isAtWar(engine.state, target.id, own.id)).toBe(true);

    const again = engine.dispatch({ kind: 'declare_war', targetCountryId: target.id });
    expect(again.ok).toBe(false);

    const peace = engine.dispatch({ kind: 'offer_peace', targetCountryId: target.id });
    expect(peace.ok).toBe(true);
    expect(isAtWar(engine.state, own.id, target.id)).toBe(false);
  });

  it('没有统治权也没有高级公职时无法指挥军团', () => {
    const engine = makeEngine('war-denied');
    const country = playerCountry(engine);
    engine.state.characters[engine.state.playerId]!.offices = [];
    const result = engine.dispatch({ kind: 'levy_army', units: 10 });

    expect(result.ok).toBe(false);
    expect(result.error ?? '').toMatch(/统治权|公职/);
    expect(engine.state.armies[`army:${country.id}`]?.size ?? 0).toBeGreaterThanOrEqual(0);
  });
});
