/**
 * 阶段 1：信号分级与死者过滤的回归用例。
 *
 * - `relationOf` 只读状态，按「自己 > 家族 > 组织 > 地区 > 国家 > 远方」判定。
 * - `entitiesOfScope('character')` 必须过滤已故人物，否则百年模拟里过半事件
 *   会落在尸体上（试玩报告的 P0 之一）。
 */

import { describe, expect, it } from 'vitest';

import { collectCandidates } from '../src/core/EventEngine';
import { GameEngine } from '../src/core/GameEngine';
import { content } from '../src/content';
import { isRelated, relationOf, subjectOf } from '../src/ui/signals';
import { makeWorld } from './helpers';

describe('信号分级', () => {
  it('自己相关的事件判为 self', () => {
    const state = makeWorld();
    const relation = relationOf(state, { refs: [{ type: 'character', id: state.playerId }] });
    expect(relation).toBe('self');
    expect(isRelated(relation)).toBe(true);
  });

  it('家族成员的事件判为 family', () => {
    const state = makeWorld();
    const player = state.characters[state.playerId]!;
    const other = Object.values(state.characters).find((character) => character.id !== player.id)!;
    state.families['fam_test'] = {
      id: 'fam_test',
      name: '测试家族',
      culture: 'silvermoon',
      memberIds: [player.id, other.id],
    };
    player.familyId = 'fam_test';
    other.familyId = 'fam_test';

    expect(relationOf(state, { refs: [{ type: 'character', id: other.id }] })).toBe('family');
  });

  it('玩家持股的组织、所在地区、所在国家分别判为 org / region / country', () => {
    const state = makeWorld();
    const player = state.characters[state.playerId]!;
    const org = Object.values(state.organizations).find((candidate) =>
      candidate.shares.some((share) => share.characterId === player.id),
    )!;
    const region = state.regions[player.location.regionId]!;

    expect(relationOf(state, { refs: [{ type: 'organization', id: org.id }] })).toBe('org');
    expect(relationOf(state, { refs: [{ type: 'region', id: region.id }] })).toBe('region');
    expect(relationOf(state, { refs: [{ type: 'country', id: region.countryId }] })).toBe(
      'country',
    );
  });

  it('无关的远方事件判为 world，且不触发弹窗', () => {
    const state = makeWorld();
    const player = state.characters[state.playerId]!;
    const stranger = Object.values(state.characters).find(
      (character) => character.id !== player.id && character.regionId !== player.location.regionId,
    )!;
    const relation = relationOf(state, { refs: [{ type: 'character', id: stranger.id }] });
    expect(relation).toBe('world');
    expect(isRelated(relation)).toBe(false);
  });

  it('主体取第一个可识别实体，供标题行使用', () => {
    const state = makeWorld();
    const org = Object.values(state.organizations)[0]!;
    const subject = subjectOf(state, { refs: [{ type: 'organization', id: org.id }] });
    expect(subject).toEqual({ kind: 'organization', id: org.id, label: org.name });
  });
});

describe('事件目标过滤', () => {
  it('20 年推进后，候选事件不再指向已故人物', () => {
    const world = makeWorld('signals-dead-check');
    const game = new GameEngine(world, content);
    game.advanceDays(360 * 20);

    const candidates = collectCandidates(world, content, world.clock.day, 2);
    const characterTargets = candidates.filter(
      (candidate) => candidate.target.scope === 'character',
    );
    expect(characterTargets.length).toBeGreaterThan(0);
    for (const candidate of characterTargets) {
      expect(world.characters[candidate.target.entityId]?.alive).toBe(true);
    }
  });
});
