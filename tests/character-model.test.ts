/**
 * 人物档案模型（M4）：六维、阵营九宫格、信仰、地点与 v3→v4 迁移。
 *
 * 这一层只测"纯数据规则"，人口学（出生/婚姻/遗产）在 character-lifecycle.test.ts。
 */

import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTE_KEYS,
  SCHEMA_VERSION,
  buildCharacter,
  validateWorld,
  type Character,
  type WorldState,
} from '../src/core/WorldState';
import { migrateWorldState } from '../src/storage/Migration';
import {
  alignmentCell,
  alignmentLabel,
  applyAlignmentDelta,
  baseAttributes,
  clampAttribute,
  locationLabel,
  normalizeFaith,
  skillCap,
} from '../src/systems/character/Profile';
import { makeWorld } from './helpers/index';

describe('人物档案', () => {
  it('createWorld 为每个人物补齐档案缺省值', () => {
    const world = makeWorld('profile-defaults');
    const player = world.characters[world.playerId];
    expect(player).toBeDefined();
    if (!player) return;

    expect(player.generation).toBe(1);
    expect(typeof player.faith === 'string' || player.faith === null).toBe(true);
    expect(Math.abs(player.alignment.law)).toBeLessThanOrEqual(100);
    expect(Math.abs(player.alignment.good)).toBeLessThanOrEqual(100);
    expect(player.spouseId).toBeNull();
    expect(player.parentIds).toEqual([null, null]);
    expect(player.offices).toEqual([]);
    expect(player.location.regionId).toBe(player.regionId);
    expect(player.location.site).toBe('city');
    expect(player.birthYear).toBe(-player.age);
    for (const key of ATTRIBUTE_KEYS) {
      expect(Number.isInteger(player.attributes[key])).toBe(true);
      expect(player.attributes[key]).toBeGreaterThanOrEqual(1);
      expect(player.attributes[key]).toBeLessThanOrEqual(20);
    }
    expect(validateWorld(world)).toEqual([]);
  });

  it('属性被夹到 1–20，非法值退回缺省', () => {
    expect(clampAttribute(0)).toBe(1);
    expect(clampAttribute(99)).toBe(20);
    expect(clampAttribute(Number.NaN)).toBe(10);
    expect(clampAttribute(13.6)).toBe(14);

    const character = buildCharacter({
      id: 'c_clamp',
      name: '测试人物',
      raceId: 'human',
      classId: 'merchant',
      age: 30,
      regionId: 'r_silvermoon',
      organizationId: null,
      wealth: 100,
      skills: {},
      traits: {},
      attributes: { physique: 40, intellect: -5 },
    });
    expect(character.attributes.physique).toBe(20);
    expect(character.attributes.intellect).toBe(1);
    expect(character.attributes.charisma).toBe(10);
  });

  it('九宫格标签与格位一一对应', () => {
    expect(alignmentLabel({ law: 60, good: 60 })).toBe('守序善良');
    expect(alignmentLabel({ law: 0, good: 60 })).toBe('中立善良');
    expect(alignmentLabel({ law: -60, good: 60 })).toBe('混乱善良');
    expect(alignmentLabel({ law: 0, good: 0 })).toBe('绝对中立');
    expect(alignmentLabel({ law: 0, good: -60 })).toBe('中立邪恶');
    expect(alignmentLabel({ law: -60, good: -60 })).toBe('混乱邪恶');

    expect(alignmentCell({ law: 60, good: 60 })).toBe(0);
    expect(alignmentCell({ law: 0, good: 0 })).toBe(4);
    expect(alignmentCell({ law: -60, good: -60 })).toBe(8);
  });

  it('阵营变化有单次上限，并夹在 −100..100', () => {
    const world = makeWorld('alignment');
    const character = world.characters[world.playerId] as Character;
    character.alignment = { law: 95, good: -95 };

    const changed = applyAlignmentDelta(character, { law: 50, good: -50 });
    expect(changed).toBeGreaterThan(0);
    expect(character.alignment.law).toBe(100);
    expect(character.alignment.good).toBe(-100);
    // 单次总变化不超过 20：95→100 只用了 5 点配额。
    expect(changed).toBeLessThanOrEqual(20);

    character.alignment = { law: 0, good: 0 };
    const applied = applyAlignmentDelta(character, { law: 100, good: 100 });
    expect(applied).toBeCloseTo(20, 5);
  });

  it('种族修正与派生值：矮人体质、精灵智力、技能上限', () => {
    expect(baseAttributes('dwarf').physique).toBe(12);
    expect(baseAttributes('dwarf').agility).toBe(9);
    expect(baseAttributes('elf').intellect).toBe(11);
    expect(baseAttributes('human').physique).toBe(10);
    expect(baseAttributes('human', { charisma: 20 }).charisma).toBe(20);
    expect(skillCap(10)).toBe(6);
    expect(skillCap(20)).toBe(9);
    expect(normalizeFaith(undefined)).toBeNull();
    expect(normalizeFaith('  ')).toBeNull();
    expect(normalizeFaith('faith_dawn')).toBe('faith_dawn');

    const world = makeWorld('label');
    const character = world.characters[world.playerId] as Character;
    expect(locationLabel(character)).toBe('城镇（停留 0 天）');
  });

  it('v3 存档迁移到 v4 时补齐档案字段', () => {
    const legacy = JSON.parse(JSON.stringify(makeWorld('migrate-v4'))) as WorldState;
    legacy.meta.schemaVersion = 3;
    legacy.characters = Object.fromEntries(
      Object.entries(legacy.characters).map(([id, character]) => {
        const raw = { ...character } as Record<string, unknown>;
        for (const key of [
          'sex',
          'birthYear',
          'generation',
          'familyId',
          'parentIds',
          'spouseId',
          'attributes',
          'alignment',
          'faith',
          'homeRegionId',
          'location',
          'offices',
        ]) {
          delete raw[key];
        }
        return [id, raw];
      }),
    ) as unknown as Record<string, Character>;
    delete (legacy as unknown as Record<string, unknown>)['families'];

    const migrated = migrateWorldState(legacy);
    expect(migrated.meta.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.families).toEqual({});
    const player = migrated.characters[migrated.playerId];
    expect(player?.attributes.physique).toBe(10);
    expect(player?.alignment).toEqual({ law: 0, good: 0 });
    expect(player?.faith).toBeNull();
    expect(player?.location.site).toBe('city');
    expect(player?.offices).toEqual([]);
    expect(validateWorld(migrated)).toEqual([]);
  });
});
