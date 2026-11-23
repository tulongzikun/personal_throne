// @vitest-environment jsdom
/**
 * P0 止血包：把「系统替玩家做主」和「读数说不清楚」两类问题钉住。
 *
 * - 玩家不再被自动配婚（计划 §11 Q2/Q3）；
 * - 哈希搬进调试页，顶栏只留能一眼看懂的读数；
 * - ☰ 菜单是唯一入口，帮助按「看/做/查」分组；
 * - 行动力用完时建议面板不再推荐做不到的事；
 * - 每个标签页记住自己的滚动位置。
 */

import { describe, expect, it } from 'vitest';

import { App } from '../src/ui/App';
import { makeEngine } from './helpers';

function boot(seed = 'p0-safety') {
  const root = document.createElement('div');
  document.body.append(root);
  const engine = makeEngine(seed);
  const app = new App(root, engine);
  app.start();
  return { app, engine, root };
}

function clickText(root: HTMLElement, selector: string, text: string): HTMLElement {
  const node = [...root.querySelectorAll<HTMLElement>(selector)].find(
    (element) => element.textContent?.trim().startsWith(text) === true,
  );
  if (!node) throw new Error(`找不到「${text}」`);
  node.click();
  return node;
}

describe('P0：玩家不再被系统配婚', () => {
  it('模拟 30 年后玩家仍然单身，也没有被塞进婚姻池', () => {
    const engine = makeEngine('p0-marriage');
    engine.advanceDays(30 * 360);
    const player = engine.state.characters[engine.state.playerId];
    expect(player).toBeDefined();
    // 玩家可能已经死在 45 岁以后；活着就必须是单身。
    if (player?.alive) expect(player.spouseId).toBeNull();
  });

  it('其他人照常结婚，世界没有因此停摆', () => {
    const engine = makeEngine('p0-marriage-npc');
    engine.advanceDays(20 * 360);
    const married = Object.values(engine.state.characters).filter(
      (character) => character.alive && character.spouseId !== null,
    );
    expect(married.length).toBeGreaterThan(0);
  });
});

describe('P0：顶栏与菜单', () => {
  it('哈希不在顶栏，菜单里能找到存档、新开一局、帮助、调试', () => {
    const { root } = boot();
    expect(root.querySelector('.topbar__value--mono')).toBeNull();

    const menuButton = root.querySelector<HTMLButtonElement>('.topbar__menu-btn');
    expect(menuButton).not.toBeNull();
    menuButton?.click();

    const items = [...root.querySelectorAll('.topbar__menu-item')].map((item) =>
      item.textContent?.trim(),
    );
    expect(items.slice(0, 4)).toEqual(['存档管理', '导出存档', '导入存档', '新开一局']);
    expect(items[4]?.startsWith('帮助')).toBe(true);
    expect(items[5]).toBe('调试信息');
  });

  it('Esc 关掉菜单，不把 Esc 漏给别处', () => {
    const { root } = boot();
    root.querySelector<HTMLButtonElement>('.topbar__menu-btn')?.click();
    const menu = root.querySelector<HTMLElement>('#topbar-menu');
    expect(menu?.hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu?.hidden).toBe(true);
  });

  it('新开一局先确认，取消不会动当前这局', () => {
    const { root, engine } = boot('p0-confirm');
    const before = engine.state.meta.worldId;
    root.querySelector<HTMLButtonElement>('.topbar__menu-btn')?.click();
    clickText(root, '.topbar__menu-item', '新开一局');
    const dialog = [...root.querySelectorAll<HTMLElement>('.modal')].find(
      (node) => !node.hidden && node.textContent?.includes('新开一局？') === true,
    );
    expect(dialog).toBeDefined();
    clickText(dialog ?? root, '.btn', '取消');
    expect(engine.state.meta.worldId).toBe(before);
  });
});

describe('P0：帮助与建议事项', () => {
  it('帮助按「看 / 做 / 查」分组', () => {
    const { root } = boot('p0-help');
    root.querySelector<HTMLButtonElement>('.topbar__menu-btn')?.click();
    clickText(root, '.topbar__menu-item', '帮助');
    const titles = [...root.querySelectorAll('.help__title')].map((node) => node.textContent);
    expect(titles).toEqual(['看', '做', '查']);
  });

  it('行动力为 0 时只提示等待，不推荐做不到的事', () => {
    const { app, root, engine } = boot('p0-ap');
    const player = engine.state.characters[engine.state.playerId];
    if (!player) throw new Error('缺少玩家');
    player.actionPoints = 0;
    // 直接改状态后让面板重绘一次（它只读状态，不缓存）。
    (app as unknown as { suggestionsPanel: { render(): void } }).suggestionsPanel.render();
    const wait = root.querySelector('.suggestions__item--wait');
    expect(wait?.textContent).toContain('这个月没行动力了');
    expect(root.querySelector('.suggestions__go')).toBeNull();
  });
});

describe('P0：标签页滚动记忆', () => {
  it('切走再切回，停在原来的位置', () => {
    const { root } = boot('p0-scroll');
    const characterTab = root.querySelector<HTMLButtonElement>('#tab-character');
    const regionTab = root.querySelector<HTMLButtonElement>('#tab-region');
    characterTab?.click();
    const section = root.querySelector<HTMLElement>('#panel-character');
    if (!section) throw new Error('缺少人物面板');
    section.scrollTop = 180;

    regionTab?.click();
    characterTab?.click();
    expect(section.scrollTop).toBe(180);
  });
});
