/**
 * 关系网与生涯路径（M4.3）。
 *
 * 这两块都在"人物"层：关系是社交资源，生涯是身份台阶。
 * 均只测规则本身 + 与引擎/存档的接缝。
 */

import { describe, expect, it } from 'vitest';
import { makeEngine, makeWorld, content } from './helpers/index';
import {
  bumpRelation,
  decayRelations,
  findRelation,
  linkKin,
  relationScore,
  relationsOf,
  setRelation,
} from '../src/systems/character/Relations';
import {
  careerTitle,
  canSwitchCareer,
  nextCareerStep,
  primarySkill,
  settleYearlyCareer,
  switchCareer,
} from '../src/systems/character/Career';
import { SCHEMA_VERSION } from '../src/core/WorldState';
import { migrateWorldState } from '../src/storage/Migration';

describe('关系网', () => {
  it('写入/叠加/夹取，自己对自己不建关系', () => {
    const world = makeWorld();
    expect(setRelation(world, 'c_player', 'c_player', 'ally', 50)).toBeNull();
    setRelation(world, 'c_player', 'c_grainwheel_hob', 'ally', 40);
    bumpRelation(world, 'c_player', 'c_grainwheel_hob', 'ally', 90);
    expect(findRelation(world, 'c_player', 'c_grainwheel_hob', 'ally')?.value).toBe(100);
    bumpRelation(world, 'c_player', 'c_grainwheel_hob', 'ally', -260);
    // −160 → 夹到 −100，仍保留记录。
    expect(findRelation(world, 'c_player', 'c_grainwheel_hob', 'ally')?.value).toBe(-100);
  });

  it('双向亲缘与敌对，relationScore 取双向之和', () => {
    const world = makeWorld();
    linkKin(world, 'c_player', 'c_grainwheel_hob', 55);
    expect(findRelation(world, 'c_grainwheel_hob', 'c_player', 'family')?.value).toBe(55);
    expect(relationScore(world, 'c_player', 'c_grainwheel_hob')).toBe(110);
    bumpRelation(world, 'c_grainwheel_hob', 'c_player', 'rival', -30);
    expect(relationScore(world, 'c_player', 'c_grainwheel_hob')).toBe(80);
  });

  it('关系按强度绝对值排序，并在年度衰减后清掉死记录', () => {
    const world = makeWorld();
    setRelation(world, 'c_player', 'a', 'ally', 20);
    setRelation(world, 'c_player', 'b', 'feud', -70);
    setRelation(world, 'c_player', 'c', 'debt', 1);
    const list = relationsOf(world, 'c_player');
    expect(list.map((relation) => relation.to)).toEqual(['b', 'a', 'c']);

    decayRelations(world, 0.5);
    expect(findRelation(world, 'c_player', 'c', 'debt')).toBeNull();
    expect(findRelation(world, 'c_player', 'b', 'feud')?.value).toBe(-35);
  });

  it('婚姻会在人口学里生成双向亲族关系', () => {
    const engine = makeEngine();
    engine.advanceDays(20 * 360);
    const families = Object.values(engine.state.families);
    expect(families.length).toBeGreaterThan(0);
    const kin = engine.state.relations.filter((relation) => relation.type === 'family');
    expect(kin.length).toBeGreaterThan(0);
    expect(kin.every((relation) => relation.value > 0)).toBe(true);
  });
});

describe('生涯路径', () => {
  it('三级阶梯与主技能', () => {
    expect(careerTitle('merchant', 0)).toBe('学徒');
    expect(careerTitle('merchant', 3)).toBe('商会主');
    expect(careerTitle('politician', 2)).toBe('大臣');
    const world = makeWorld();
    const player = world.characters[world.playerId]!;
    expect(primarySkill(player)).toBe(player.skills.trade ?? 0);
    expect(nextCareerStep(player)?.rank).toBe(1);
  });

  it('财富与技能达标且在岗就年度晋升，跌破 30% 会降级', () => {
    const world = makeWorld();
    const player = world.characters[world.playerId]!;
    player.wealth = 1000;
    player.skills.trade = 3;
    player.lastActionDay = 300;
    const changes = settleYearlyCareer(world, 360);
    expect(
      changes.some((change) => change.characterId === player.id && change.direction === 'up'),
    ).toBe(true);
    expect(player.careerRank).toBeGreaterThanOrEqual(1);

    player.wealth = 10;
    const down = settleYearlyCareer(world, 720);
    expect(
      down.some((change) => change.characterId === player.id && change.direction === 'down'),
    ).toBe(true);
  });

  it('转行要求站稳且有钱，成功后等级归零', () => {
    const world = makeWorld();
    const player = world.characters[world.playerId]!;
    expect(canSwitchCareer(world, player.id, 'politician')).not.toBeNull();

    player.careerRank = 1;
    player.wealth = 5000;
    expect(canSwitchCareer(world, player.id, 'politician')).toBeNull();
    const result = switchCareer(world, player.id, 'politician', 360);
    expect(result.ok).toBe(true);
    expect(player.classId).toBe('politician');
    expect(player.careerRank).toBe(0);
  });

  it('命令只能给自己转行，并通过引擎写历史', () => {
    const engine = makeEngine();
    const player = engine.state.characters[engine.state.playerId]!;
    player.careerRank = 1;
    player.wealth = 5000;

    const rejected = engine.dispatch({
      kind: 'change_career',
      characterId: 'c_grainwheel_hob',
      classId: 'politician',
    });
    expect(rejected.ok).toBe(false);

    const accepted = engine.dispatch({
      kind: 'change_career',
      characterId: player.id,
      classId: 'politician',
    });
    expect(accepted.ok).toBe(true);
    expect(player.classId).toBe('politician');
    expect(engine.state.history.some((record) => record.summary.includes('转行'))).toBe(true);
  });
});

describe('存档 v5', () => {
  it('v4 存档迁移后补齐生涯字段', () => {
    const world = makeWorld();
    const legacy = JSON.parse(JSON.stringify(world));
    legacy.meta.schemaVersion = 4;
    for (const character of Object.values(legacy.characters) as Record<string, unknown>[]) {
      delete character['careerRank'];
      delete character['careerSinceDay'];
    }
    const migrated = migrateWorldState(legacy);
    expect(migrated.meta.schemaVersion).toBe(SCHEMA_VERSION);
    for (const character of Object.values(migrated.characters)) {
      expect(character.careerRank).toBe(0);
      expect(character.careerSinceDay).toBe(0);
    }
    expect(content.version).toBeTruthy();
  });
});
