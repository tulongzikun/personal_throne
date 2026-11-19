/**
 * M6 战争：宣战、行军、会战、围城、议和与厌战。
 *
 * 这些用例把"战争"当成可复现的状态机来测：每一步只推进到需要的时间点，
 * 断言的是**因果**（宣战→双方交战；围城满 3 个月→占领），不是具体数值。
 */

import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/core/GameEngine';
import { applyCommand } from '../src/core/CommandBus';
import type { WorldState } from '../src/core/WorldState';
import { content } from '../src/content/index';
import {
  battlePower,
  declareWar,
  isAtWar,
  makePeace,
  settleMonthlyWar,
  totalArmySize,
} from '../src/systems/military/WarSystem';
import { Random } from '../src/core/Random';
import { makeEngine, makeWorld } from './helpers/index';

function asRuler(state: WorldState, countryId = 'c_kingdom'): void {
  const country = state.countries[countryId];
  if (country) country.rulerId = 'c_player';
}

function ctxOf(state: WorldState) {
  return {
    day: state.clock.day,
    periodKey: 'm-war',
    phase: 2 as const,
    rng: new Random('war-test'),
  };
}

describe('战争', () => {
  it('宣战时双向写入交战列表并压低外交', () => {
    const state = makeWorld('war-declare');
    const result = declareWar(state, content, 'c_kingdom', 'c_league');
    expect(result.ok).toBe(true);
    expect(isAtWar(state, 'c_kingdom', 'c_league')).toBe(true);
    expect(isAtWar(state, 'c_league', 'c_kingdom')).toBe(true);
    expect(state.countries['c_kingdom']?.diplomacy['c_league']).toBe(-100);

    const again = declareWar(state, content, 'c_kingdom', 'c_league');
    expect(again.ok).toBe(false);
  });

  it('宣战后军队按月向敌国推进', () => {
    const engine = makeEngine('war-march');
    asRuler(engine.state);
    const declared = applyCommand(
      engine.state,
      { kind: 'declare_war', targetCountryId: 'c_league' },
      content,
    );
    expect(declared.ok).toBe(true);

    const army = engine.state.armies['army:c_kingdom'];
    expect(army).toBeDefined();
    const start = army?.locationRegionId;
    engine.advanceDays(30);
    const moved = engine.state.armies['army:c_kingdom'];
    expect(moved?.locationRegionId).not.toBe(start);
  });

  it('同地两军会战，败方撤回首都并掉士气', () => {
    const engine = makeEngine('war-battle');
    const state = engine.state;
    declareWar(state, content, 'c_kingdom', 'c_league');
    const mine = state.armies['army:c_kingdom'];
    const theirs = state.armies['army:c_league'];
    expect(mine && theirs).toBeTruthy();
    if (!mine || !theirs) return;

    // 把两军放在同一地区，且我方明显更强，让结果可判定。
    mine.size = 2000;
    mine.training = 0.9;
    mine.morale = 0.95;
    theirs.size = 100;
    theirs.training = 0.2;
    theirs.morale = 0.4;
    theirs.locationRegionId = mine.locationRegionId;

    const before = battlePower(state, mine);
    expect(before).toBeGreaterThan(battlePower(state, theirs));

    const outcomes = settleMonthlyWar(state, content, ctxOf(state));
    expect(outcomes.some((o) => o.kind === 'battle')).toBe(true);
    expect(state.armies['army:c_league']?.size).toBeLessThan(100);
  });

  it('无敌军阻挡时，围城 3 个月即可占领', () => {
    const engine = makeEngine('war-siege');
    const state = engine.state;
    declareWar(state, content, 'c_kingdom', 'c_league');

    const mine = state.armies['army:c_kingdom'];
    const enemyRegion = state.countries['c_league']?.regionIds[0];
    expect(mine && enemyRegion).toBeTruthy();
    if (!mine || !enemyRegion) return;

    // 敌军已被歼灭（直接从棋盘上移除），只测围城节奏。
    delete state.armies['army:c_league'];
    mine.locationRegionId = enemyRegion;
    mine.stance = 'march';
    mine.targetRegionId = enemyRegion;

    for (let i = 0; i < 3; i += 1) {
      state.clock.day += 30;
      settleMonthlyWar(state, content, ctxOf(state));
    }
    expect(state.regions[enemyRegion]?.occupiedBy).toBe('c_kingdom');
  });

  it('议和时占领地割让给占领方', () => {
    const state = makeWorld('war-peace');
    declareWar(state, content, 'c_kingdom', 'c_league');
    const region = state.regions['r_portlumen'];
    expect(region).toBeDefined();
    if (!region) return;

    region.occupiedBy = 'c_kingdom';
    const outcome = makePeace(state, 'c_kingdom', 'c_league', ctxOf(state));
    expect(outcome.kind).toBe('occupation');
    expect(region.countryId).toBe('c_kingdom');
    expect(region.occupiedBy).toBeNull();
    expect(isAtWar(state, 'c_kingdom', 'c_league')).toBe(false);
    expect(state.countries['c_kingdom']?.regionIds).toContain('r_portlumen');
    expect(state.countries['c_league']?.regionIds).not.toContain('r_portlumen');
  });

  it('厌战到阈值会迫使双方停战', () => {
    const engine = makeEngine('war-exhaustion');
    const state = engine.state;
    declareWar(state, content, 'c_kingdom', 'c_league');
    const a = state.countries['c_kingdom'];
    const b = state.countries['c_league'];
    expect(a && b).toBeTruthy();
    if (!a || !b) return;

    a.warExhaustion = 0.69;
    b.warExhaustion = 0.69;
    state.clock.day += 30;
    const outcomes = settleMonthlyWar(state, content, ctxOf(state));
    expect(outcomes.some((o) => o.kind === 'peace')).toBe(true);
    expect(isAtWar(state, 'c_kingdom', 'c_league')).toBe(false);
  });

  it('征兵命令只能由统治者下达，并扣国库', () => {
    const state = makeWorld('war-levy');
    asRuler(state);
    const army = state.armies['army:c_kingdom'];
    expect(army).toBeDefined();
    if (!army) return;

    const before = state.countries['c_kingdom']?.treasury ?? 0;
    const beforeSize = army.size;
    const ok = applyCommand(state, { kind: 'levy_army', units: 40 }, content);
    expect(ok.ok).toBe(true);
    expect(army.size).toBe(beforeSize + 40);
    expect(state.countries['c_kingdom']?.treasury).toBeLessThan(before);

    // 去掉统治权后应被拒绝。
    if (state.countries['c_kingdom']) state.countries['c_kingdom'].rulerId = 'c_king_aerik';
    const denied = applyCommand(state, { kind: 'levy_army', units: 10 }, content);
    expect(denied.ok).toBe(false);
  });

  it('带战争的模拟仍可复现（同种子同哈希）', () => {
    const run = (seed: string): string => {
      const engine = new GameEngine(makeWorld(seed), content);
      engine.advanceDays(360 * 5);
      return engine.hash();
    };
    expect(run('war-determinism')).toBe(run('war-determinism'));
  });

  it('战争会消耗双方兵力并推高厌战', () => {
    const engine = makeEngine('war-cost');
    const state = engine.state;
    declareWar(state, content, 'c_kingdom', 'c_league');
    const before = totalArmySize(state, 'c_kingdom');
    engine.advanceDays(30 * 6);
    const after = totalArmySize(state, 'c_kingdom');
    expect(after).toBeLessThanOrEqual(before);
    const exhaustion =
      (state.countries['c_kingdom']?.warExhaustion ?? 0) +
      (state.countries['c_league']?.warExhaustion ?? 0);
    expect(exhaustion).toBeGreaterThan(0);
  });
});
