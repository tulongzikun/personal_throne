// @vitest-environment jsdom
/**
 * 阶段 6：界面可读性与可达性。
 *
 * 审计的原始问题：辅助文字对比度 3.14:1、字号小到 8.7px、标签页没有键盘路径、
 * 弹窗不关焦点、开局弹窗后面时间还在跑。这些都能被机器判定，就不该靠肉眼。
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { App } from '../src/ui/App';
import { trapFocus } from '../src/ui/dom';
import { makeEngine } from './helpers';

const css = fs.readFileSync(path.resolve(process.cwd(), 'src/ui/styles/base.css'), 'utf8');

function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!match?.[1]) throw new Error(`找不到色值 --${name}`);
  return match[1];
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = channels.map((value) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function boot() {
  const root = document.createElement('div');
  document.body.append(root);
  const engine = makeEngine('stage6-ui');
  const app = new App(root, engine);
  app.start();
  return { app, engine, root };
}

function speedOf(app: App): number {
  return (app as unknown as { speed: number }).speed;
}

describe('阶段 6：界面', () => {
  it('正文与辅助文字的对比度都不低于 4.5:1', () => {
    const backgrounds = ['bg-void', 'bg-sunken', 'bg-panel', 'bg-elevated'].map(token);
    for (const name of ['text-primary', 'text-secondary', 'text-muted', 'text-dim']) {
      const foreground = token(name);
      for (const background of backgrounds) {
        expect(contrast(foreground, background), `${name} on ${background}`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    }
  });

  it('没有小于 12px（0.75rem）的字号', () => {
    const sizes = [...css.matchAll(/font-size:\s*([\d.]+)rem/g)].map((match) => Number(match[1]));
    expect(sizes.length).toBeGreaterThan(20);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(0.75);
  });

  it('弹窗里 Tab 不会跑到外面的世界', () => {
    const host = document.createElement('div');
    const first = document.createElement('button');
    const last = document.createElement('button');
    first.textContent = '一';
    last.textContent = '二';
    host.append(first, last);
    document.body.append(host);
    trapFocus(host);

    last.focus();
    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(forward);
    expect(document.activeElement).toBe(first);

    const backward = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(backward);
    expect(document.activeElement).toBe(last);
    host.remove();
  });

  it('开局选择期间时间停着，选完之后才走', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const engine = makeEngine('stage6-start');
    const app = new App(root, engine);
    app.start();

    app.offerStart();
    expect(speedOf(app)).toBe(0);

    const dialog = root.querySelector('#start-dialog-title')?.closest('.modal');
    const button = dialog?.querySelector<HTMLButtonElement>('.btn--gold');
    if (!button) throw new Error('找不到开局按钮');
    button.click();
    expect(speedOf(app)).toBe(1);
  });

  it('标签页可以用方向键切换，且只有当前页可 Tab 进入', () => {
    const { app, root } = boot();
    const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.length).toBeGreaterThan(2);
    const selectedIndex = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
    expect(selectedIndex).toBeGreaterThanOrEqual(0);
    expect(tabs.filter((tab) => tab.tabIndex === 0)).toHaveLength(1);

    const before = tabs[selectedIndex]!.textContent;
    tabs[selectedIndex]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    const active = (app as unknown as { activeTab: string }).activeTab;
    const nowSelected = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true');
    expect(nowSelected?.textContent).not.toBe(before);
    expect(nowSelected?.id).toBe(`tab-${active}`);
  });
});
