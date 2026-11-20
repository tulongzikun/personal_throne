// @vitest-environment jsdom
/**
 * 面板级交互测试：在真实 DOM 里挂载左侧玩家卡与右侧地区页。
 *
 * 这两块最近改过：个人行动按「修养 / 生计 / 钱庄」分组、移动从左侧移除、
 * 右侧城市页出现「前往」按钮。用 jsdom 直接断言结构，避免只靠人工看界面。
 */

import { describe, expect, it } from 'vitest';
import { content } from '../src/content/index';
import type { Command } from '../src/core/CommandBus';
import { GameEngine } from '../src/core/GameEngine';
import { createWorld, type WorldState } from '../src/core/WorldState';
import type { UiDeps } from '../src/ui/context';
import { PlayerPanel } from '../src/ui/PlayerPanel';
import { RegionPanel } from '../src/ui/RegionPanel';

interface Harness {
  state: WorldState;
  engine: GameEngine;
  deps: UiDeps;
  notices: string[];
}

function makeHarness(): Harness {
  const state = createWorld(content, { seed: 'ui-panels', createdAt: 0 });
  const engine = new GameEngine(state, content);
  const notices: string[] = [];
  const deps: UiDeps = {
    state: () => engine.state,
    content: () => content,
    dispatch: (command: Command) => engine.dispatch(command),
    advanceDays: (days: number) => engine.advanceDays(days),
    refresh: () => {},
    notify: (message: string) => notices.push(message),
    openRegion: () => {},
    openOrganization: () => {},
    openCharacter: () => {},
  };
  return { state: engine.state, engine, deps, notices };
}

describe('左侧玩家卡：个人行动分组', () => {
  it('按修养/生计/钱庄分组，且不再有移动按钮', () => {
    const { deps } = makeHarness();
    const host = document.createElement('div');
    new PlayerPanel(host, deps);

    const groups = [...host.querySelectorAll('.action-group__title')].map(
      (node) => node.textContent,
    );
    expect(groups).toEqual(['修养', '生计', '钱庄']);

    const labels = [...host.querySelectorAll('.player-card__train button')].map(
      (node) => node.textContent ?? '',
    );
    expect(labels.some((label) => label.startsWith('去'))).toBe(false);
    expect(labels).toContain('休息');
    expect(labels.some((label) => /^贩货 \d+ 单位$/.test(label))).toBe(true);
    expect(labels).toContain('存 100');
    expect(labels).toContain('取 100');
    expect(host.textContent).toContain('移动：在地图或右侧地区页点城市');
  });

  it('休息按钮真正消耗行动力并回血', () => {
    const { deps, engine } = makeHarness();
    const host = document.createElement('div');
    new PlayerPanel(host, deps);

    const player = engine.state.characters[engine.state.playerId]!;
    player.health = 60;
    const before = player.actionPoints;
    new PlayerPanel(host, deps);

    const rest = [...host.querySelectorAll('button')].find((node) => node.textContent === '休息');
    expect(rest).toBeDefined();
    rest!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(player.health).toBeGreaterThan(60);
    expect(player.actionPoints).toBe(before - 1);
  });
});

describe('右侧地区页：前往', () => {
  it('相邻城市显示路程、路费与前往按钮，点击后真的移动', () => {
    const { deps, engine } = makeHarness();
    const host = document.createElement('div');
    const panel = new RegionPanel(host, deps);

    const player = engine.state.characters[engine.state.playerId]!;
    const hop = engine.state.regions[player.regionId]!.links[0]!;
    panel.show(hop.to);

    const hint = host.querySelector('.travel__hint')?.textContent ?? '';
    expect(hint).toContain(`路程 ${hop.days} 天`);
    expect(hint).toContain(`路费 ${hop.days * 2}`);

    const go = [...host.querySelectorAll('.travel button')].find(
      (node) => node.textContent === '前往',
    );
    expect(go).toBeDefined();

    const cashBefore = player.wealth;
    go!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(player.regionId).toBe(hop.to);
    expect(player.wealth).toBe(cashBefore - hop.days * 2);
    expect(player.health).toBeLessThan(100);
  });

  it('本地城市不显示前往按钮；不相邻城市给出转乘提示', () => {
    const { deps, engine } = makeHarness();
    const host = document.createElement('div');
    const panel = new RegionPanel(host, deps);
    const player = engine.state.characters[engine.state.playerId]!;

    panel.show(player.regionId);
    expect(host.querySelector('.travel__hint')?.textContent).toBe('你正在此地。');
    expect(host.querySelector('.travel button')).toBeNull();

    const home = engine.state.regions[player.regionId]!;
    const neighbours = new Set(home.links.map((link) => link.to));
    const far = Object.values(engine.state.regions).find(
      (region) => !neighbours.has(region.id) && region.id !== player.regionId,
    );
    expect(far).toBeDefined();
    panel.show(far!.id);
    expect(host.querySelector('.travel__hint')?.textContent).toContain('没有直达商路');
    expect(host.querySelector('.travel button')).toBeNull();
  });
});
