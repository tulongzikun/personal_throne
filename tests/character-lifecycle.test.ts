/**
 * 人口学（M4.1）：婚姻、出生、死亡、遗产与股份守恒。
 *
 * 这些用例守住"世界不会因为人死而崩"：配偶指针不悬空、股份恒为 100%、新生人物档案完整。
 */

import { describe, expect, it } from 'vitest';
import { buildCharacter, validateWorld, type WorldState } from '../src/core/WorldState';
import { GameEngine } from '../src/core/GameEngine';
import { settleEstate, shareTotal } from '../src/systems/character/Demography';
import { makeWorld, content } from './helpers/index';

function shareSum(state: WorldState): number {
  return Object.keys(state.organizations)
    .map((orgId) => shareTotal(state, orgId))
    .reduce((sum, value) => sum + value, 0);
}

describe('人口学', () => {
  it('模拟 20 年后人物档案完整、世界自洽', () => {
    const world = makeWorld('lifecycle-20');
    const engine = new GameEngine(world, content);
    engine.advanceDays(20 * 360);

    expect(validateWorld(world)).toEqual([]);
    const living = Object.values(world.characters).filter((character) => character.alive);
    expect(living.length).toBeGreaterThanOrEqual(20);
    for (const character of living) {
      expect(character.attributes.physique).toBeGreaterThanOrEqual(1);
      expect(character.attributes.physique).toBeLessThanOrEqual(20);
      expect(character.location.regionId).toBe(character.regionId);
      if (character.spouseId !== null) {
        const spouse = world.characters[character.spouseId];
        expect(spouse?.alive).toBe(true);
        expect(spouse?.spouseId).toBe(character.id);
      }
    }
    // 出生过：总人数超过初始 20，且婚姻会建立家族。
    expect(Object.keys(world.characters).length).toBeGreaterThan(20);
    const families = Object.values(world.families);
    expect(families.length).toBeGreaterThan(0);
    for (const family of families) {
      expect(family.memberIds.length).toBeGreaterThanOrEqual(2);
      for (const memberId of family.memberIds) {
        expect(world.characters[memberId]?.familyId).toBe(family.id);
      }
    }
  });

  it('婚姻是对称的，死亡会解开配偶指针', () => {
    const world = makeWorld('lifecycle-marriage');
    const engine = new GameEngine(world, content);
    engine.advanceDays(12 * 360);

    for (const character of Object.values(world.characters)) {
      if (!character.alive) {
        expect(character.spouseId).toBeNull();
        continue;
      }
      if (character.spouseId === null) continue;
      const spouse = world.characters[character.spouseId];
      expect(spouse?.spouseId).toBe(character.id);
    }
  });

  it('遗产：现金给继承人，股份不蒸发（恒为 100%）', () => {
    const world = makeWorld('lifecycle-estate');
    const orgId = 'o_grainwheel';
    const org = world.organizations[orgId];
    expect(org).toBeDefined();
    if (!org) return;

    // 造一个持股 10% 的死者，股份从领袖身上划出来，保证总和仍为 1。
    const leaderShare = org.shares.find((entry) => entry.characterId === org.leadership.leaderId);
    expect(leaderShare).toBeDefined();
    if (!leaderShare) return;
    leaderShare.share -= 0.1;
    const heir = buildCharacter({
      id: 'c_heir_test',
      name: '继承人·测试',
      raceId: 'human',
      classId: 'merchant',
      age: 22,
      regionId: 'r_greenfield',
      organizationId: null,
      wealth: 0,
      skills: {},
      traits: {},
      parentIds: ['c_dead_test', null],
    });
    const deceased = buildCharacter({
      id: 'c_dead_test',
      name: '亡者·测试',
      raceId: 'human',
      classId: 'merchant',
      age: 70,
      regionId: 'r_greenfield',
      organizationId: orgId,
      wealth: 1200,
      skills: {},
      traits: {},
    });
    world.characters[heir.id] = heir;
    world.characters[deceased.id] = deceased;
    org.shares.push({ characterId: deceased.id, share: 0.1 });

    const before = shareSum(world);
    const estate = settleEstate(world, deceased.id);
    expect(estate.heirs).toContain('c_heir_test');
    expect(estate.cash).toBe(1200);
    expect(shareSum(world)).toBeCloseTo(before, 6);
    expect(deceased.wealth).toBe(0);
  });

  it('无继承人时股份由其余股东接收，不产生负数或超发', () => {
    const world = makeWorld('lifecycle-noheir');
    const orgId = 'o_ironhand';
    const org = world.organizations[orgId];
    if (!org) return;
    const orphan = buildCharacter({
      id: 'c_orphan_test',
      name: '孤家·测试',
      raceId: 'human',
      classId: 'mercenary',
      age: 66,
      regionId: 'r_silvermoon',
      organizationId: orgId,
      wealth: 0,
      skills: {},
      traits: {},
    });
    world.characters[orphan.id] = orphan;
    const leaderShare = org.shares.find((entry) => entry.characterId === org.leadership.leaderId);
    if (!leaderShare) return;
    leaderShare.share -= 0.05;
    org.shares.push({ characterId: orphan.id, share: 0.05 });
    const before = shareTotal(world, orgId);

    settleEstate(world, orphan.id);
    expect(shareTotal(world, orgId)).toBeCloseTo(before, 6);
    for (const entry of org.shares) {
      expect(entry.share).toBeGreaterThanOrEqual(0);
      expect(world.characters[entry.characterId]?.alive).toBe(true);
    }
  });

  it('出生人物继承父母代际与信仰，属性在合法区间', () => {
    const world = makeWorld('lifecycle-birth');
    const engine = new GameEngine(world, content);
    engine.advanceDays(40 * 360);

    const born = Object.values(world.characters).filter(
      (character) => character.parentIds[0] !== null && character.parentIds[1] !== null,
    );
    expect(born.length).toBeGreaterThan(0);
    for (const child of born) {
      const father = child.parentIds[0] ? world.characters[child.parentIds[0]] : undefined;
      const mother = child.parentIds[1] ? world.characters[child.parentIds[1]] : undefined;
      expect(father).toBeDefined();
      expect(mother).toBeDefined();
      if (!father || !mother) continue;
      expect(child.generation).toBe(Math.max(father.generation, mother.generation) + 1);
      expect([father.faith, mother.faith, null]).toContain(child.faith);
      expect(child.alignment.law).toBeGreaterThanOrEqual(-100);
      expect(child.alignment.law).toBeLessThanOrEqual(100);
    }
  });

  it('同种子的人口学进度可复现', () => {
    const runOnce = (): string => {
      const world = makeWorld('lifecycle-determinism');
      new GameEngine(world, content).advanceDays(15 * 360);
      return Object.keys(world.characters)
        .sort()
        .map((id) => `${id}:${Math.round(world.characters[id]?.wealth ?? 0)}`)
        .join('|');
    };
    expect(runOnce()).toBe(runOnce());
  });
});
