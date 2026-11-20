import { describe, expect, it } from 'vitest';

import { content, makeEngine, makeWorld } from './helpers';
import { ambitionOf, chapterOf } from '../src/systems/goals/Ambition';
import { bestTradeRoute, suggestGoals, titleOf } from '../src/systems/goals/Goals';

describe('建议事项', () => {
  it('永远给满三条，且每条都带真实数字', () => {
    const world = makeWorld('goals-1');
    const suggestions = suggestGoals(world, content);
    expect(suggestions).toHaveLength(3);
    for (const suggestion of suggestions) {
      expect(suggestion.title.length).toBeGreaterThan(0);
      expect(suggestion.detail).toMatch(/\d/);
    }
  });

  it('健康差时先建议休息', () => {
    const world = makeWorld('goals-2');
    const player = world.characters[world.playerId]!;
    player.health = 40;
    const suggestions = suggestGoals(world, content);
    expect(suggestions[0]?.id).toBe('rest');
    expect(suggestions[0]?.detail).toContain('40');
  });

  it('持股不足三成时给出买入或攒钱的建议', () => {
    const world = makeWorld('goals-3');
    const suggestions = suggestGoals(world, content);
    const shares = suggestions.find((item) => item.id === 'shares' || item.id === 'shares-save');
    expect(shares).toBeDefined();
    expect(shares?.detail).toMatch(/铜币/);
    expect(shares?.detail).toMatch(/34%/);
  });

  it('第一条商路在当前世界里是有利可图的', () => {
    const world = makeWorld('goals-4');
    const route = bestTradeRoute(world, content);
    expect(route).not.toBeNull();
    expect(route!.profit).toBeGreaterThan(0);
    expect(route!.days).toBeGreaterThan(0);
  });

  it('称号按公职 > 领袖 > 生涯取值', () => {
    const world = makeWorld('goals-5');
    const player = world.characters[world.playerId]!;
    expect(titleOf(world, player.id)).toBe('学徒');
    const org = world.organizations[player.organizationId!]!;
    org.leadership.leaderId = player.id;
    expect(titleOf(world, player.id)).toBe(`${org.name}之主`);
    player.offices.push({
      id: 'office_test',
      title: '首相',
      countryId: 'c_kingdom',
      orgId: null,
      rank: 1,
      salaryMonthly: 100,
      sinceDay: 1,
    });
    expect(titleOf(world, player.id)).toBe('在朝之臣');
  });

  it('建议里的命令可以直接执行', () => {
    const engine = makeEngine('goals-7');
    const player = engine.state.characters[engine.state.playerId]!;
    player.health = 30;
    const first = suggestGoals(engine.state, engine.content)[0]!;
    expect(first.command).toBeDefined();
    const result = engine.dispatch(first.command!);
    expect(result.ok).toBe(true);
    expect(engine.state.characters[engine.state.playerId]!.health).toBeGreaterThan(30);
  });

  it('野心与章节随时间推进', () => {
    const world = makeWorld('goals-6');
    const ambition = ambitionOf(world)!;
    expect(ambition.progress).toBeGreaterThanOrEqual(0);
    expect(ambition.progress).toBeLessThanOrEqual(1);
    const first = chapterOf(world);
    const engine = makeEngine('goals-6');
    engine.advanceDays(360 * 21);
    const later = chapterOf(engine.state);
    expect(later.index).toBeGreaterThan(first.index);
  });
});
