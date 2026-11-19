/**
 * 开局人物创建（M4.2 / roadmap B6）。
 *
 * 断言口径：
 * - 背景决定职业、出生地区、初始财富、技能与属性倾向；
 * - 3 个天赋各 +2、可重复、单维封顶 16；
 * - 姓名来自对应文化池，重复姓名带序号；
 * - 信仰可继承背景、可改、可为无信仰；阵营随信仰倾向初始化；
 * - 创建结果能通过 `validateWorld`，并与人口学生成的人共用档案结构。
 */

import { describe, expect, it } from 'vitest';
import { content, makeWorld } from './helpers/index';
import { validateWorld } from '../src/core/WorldState';
import {
  ATTRIBUTE_CAP_FROM_TALENTS,
  CharacterCreationError,
  TALENT_PICKS,
  TALENT_TAGS,
  createPlayerCharacter,
  rebuildPlayer,
} from '../src/systems/character/CharacterCreator';

const background = content.backgrounds?.find((entry) => entry.id === 'bg_caravan');
if (!background) throw new Error('测试夹具缺少 bg_caravan');

const picks = ['talent_sturdy', 'talent_clever', 'talent_radiant'];

describe('开局人物创建', () => {
  it('按背景与天赋生成人物，并把玩家指针指过去', () => {
    const world = makeWorld();
    const { character, warnings } = createPlayerCharacter(world, content, {
      backgroundId: background.id,
      talents: picks,
    });

    expect(warnings).toEqual([]);
    expect(character.classId).toBe(background.classId);
    expect(character.location.regionId).toBe(background.regionId);
    expect(character.homeRegionId).toBe(background.regionId);
    expect(character.wealth).toBe(background.wealth);
    expect(character.skills.trade).toBe(background.skills.trade);
    expect(character.attributes.physique).toBe(10 + 2);
    expect(character.attributes.intellect).toBe(10 + 2);
    expect(character.attributes.charisma).toBe((background.attributes.charisma ?? 10) + 2);
    expect(character.generation).toBe(1);
    expect(character.parentIds).toEqual([null, null]);
    expect(character.faith).toBe(background.faithId);
    expect(world.playerId).toBe(character.id);
    expect(world.characters[character.id]).toBe(character);
    expect(validateWorld(world)).toEqual([]);
  });

  it('天赋可重复且单维封顶 16', () => {
    const world = makeWorld();
    const { character, warnings } = createPlayerCharacter(world, content, {
      backgroundId: background.id,
      talents: ['talent_sturdy', 'talent_sturdy', 'talent_sturdy'],
    });
    // 体质 10 + 2×3 = 16，正好在上限。
    expect(character.attributes.physique).toBe(ATTRIBUTE_CAP_FROM_TALENTS);
    expect(warnings).toEqual([]);
  });

  it('背景已给到 12 的属性再叠三层天赋会被夹在上限并给警告', () => {
    const world = makeWorld();
    const { character, warnings } = createPlayerCharacter(world, content, {
      backgroundId: 'bg_fallen_noble',
      talents: ['talent_radiant', 'talent_radiant', 'talent_radiant'],
    });
    expect(character.attributes.charisma).toBe(ATTRIBUTE_CAP_FROM_TALENTS);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('拒绝未知背景与错误数量的天赋', () => {
    const world = makeWorld();
    expect(() =>
      createPlayerCharacter(world, content, { backgroundId: 'bg_missing', talents: picks }),
    ).toThrow(CharacterCreationError);
    expect(() =>
      createPlayerCharacter(world, content, {
        backgroundId: background.id,
        talents: ['talent_sturdy'],
      }),
    ).toThrow(CharacterCreationError);
    expect(() =>
      createPlayerCharacter(world, content, {
        backgroundId: background.id,
        talents: ['talent_sturdy', 'talent_sturdy', 'talent_missing'],
      }),
    ).toThrow(CharacterCreationError);
    expect(picks).toHaveLength(TALENT_PICKS);
  });

  it('姓名来自文化池，重名时加序号', () => {
    const world = makeWorld();
    const first = createPlayerCharacter(world, content, {
      backgroundId: background.id,
      talents: picks,
      name: '自定名',
    });
    const second = createPlayerCharacter(world, content, {
      backgroundId: background.id,
      talents: picks,
      id: 'c_player_two',
    });
    expect(first.character.name).toBe('自定名');
    expect(second.character.name).not.toBe(first.character.name);
    expect(second.character.name.length).toBeGreaterThan(0);
  });

  it('信仰可改为无信仰，阵营随信仰初始化', () => {
    const world = makeWorld();
    const { character } = createPlayerCharacter(world, content, {
      backgroundId: background.id,
      talents: picks,
      faithId: 'faith_coin',
    });
    const faith = content.faiths?.find((entry) => entry.id === 'faith_coin');
    expect(character.faith).toBe('faith_coin');
    expect(character.alignment.law).toBe(faith?.alignmentLean.law ?? 0);

    const secular = createPlayerCharacter(world, content, {
      backgroundId: background.id,
      talents: picks,
      faithId: null,
      id: 'c_player_third',
    });
    expect(secular.character.faith).toBeNull();
  });

  it('重复创建同一 id 不留下孤儿，rebuildPlayer 复用当前玩家 id', () => {
    const world = makeWorld();
    createPlayerCharacter(world, content, { backgroundId: background.id, talents: picks });
    const before = Object.keys(world.characters).length;
    rebuildPlayer(world, content, { backgroundId: 'bg_veteran', talents: picks });
    expect(Object.keys(world.characters).length).toBe(before);
    expect(world.characters[world.playerId]?.classId).toBe('mercenary');
    expect(validateWorld(world)).toEqual([]);
  });

  it('六个天赋标签各对应一个属性', () => {
    expect(new Set(TALENT_TAGS.map((tag) => tag.attribute)).size).toBe(6);
    expect(new Set(TALENT_TAGS.map((tag) => tag.id)).size).toBe(6);
  });

  it('可选国家、地区与组织，入场是白身（无股份、非领袖、生涯 0 级）', () => {
    const world = makeWorld();
    const { character } = createPlayerCharacter(world, content, {
      backgroundId: background.id,
      talents: picks,
      countryId: 'c_league',
      regionId: 'r_tidemarket',
      organizationId: 'o_bluewave',
    });

    expect(character.location.regionId).toBe('r_tidemarket');
    expect(character.homeRegionId).toBe('r_tidemarket');
    expect(character.organizationId).toBe('o_bluewave');
    expect(character.careerRank).toBe(0);
    expect(character.offices).toEqual([]);
    const org = world.organizations['o_bluewave'];
    expect(org?.leadership.leaderId).not.toBe(character.id);
    expect(org?.shares.some((share) => share.characterId === character.id)).toBe(false);
    expect(validateWorld(world)).toEqual([]);
  });

  it('不选组织时 organizationId 为 null', () => {
    const world = makeWorld();
    const { character } = createPlayerCharacter(world, content, {
      backgroundId: background.id,
      talents: picks,
      organizationId: null,
    });
    expect(character.organizationId).toBeNull();
  });

  it('地区必须属于所选国家，未知国家/组织直接拒绝', () => {
    const world = makeWorld();
    expect(() =>
      createPlayerCharacter(world, content, {
        backgroundId: background.id,
        talents: picks,
        countryId: 'c_kingdom',
        regionId: 'r_portlumen',
      }),
    ).toThrow(CharacterCreationError);
    expect(() =>
      createPlayerCharacter(world, content, {
        backgroundId: background.id,
        talents: picks,
        countryId: 'c_missing',
      }),
    ).toThrow(CharacterCreationError);
    expect(() =>
      createPlayerCharacter(world, content, {
        backgroundId: background.id,
        talents: picks,
        organizationId: 'o_missing',
      }),
    ).toThrow(CharacterCreationError);
  });

  it('替换默认主角时，旧股份与领袖位被移交，新主角不再是金穗行领袖', () => {
    const world = makeWorld();
    const org = world.organizations['o_grainwheel'];
    if (!org) throw new Error('测试夹具缺少 o_grainwheel');
    const sharesBefore = org.shares.reduce((sum, share) => sum + share.share, 0);
    expect(org.leadership.leaderId).toBe('c_player');

    const { character, retired } = createPlayerCharacter(world, content, {
      backgroundId: background.id,
      talents: picks,
      organizationId: null,
    });

    expect(retired?.sharesRemoved).toBe(1);
    expect(retired?.leadershipsHanded).toBe(1);
    const sharesAfter = org.shares.reduce((sum, share) => sum + share.share, 0);
    expect(sharesAfter).toBeCloseTo(sharesBefore, 6);
    expect(org.shares.some((share) => share.characterId === character.id)).toBe(false);
    expect(org.leadership.leaderId).not.toBe(character.id);
    expect(character.organizationId).toBeNull();
    expect(validateWorld(world)).toEqual([]);
  });
});
