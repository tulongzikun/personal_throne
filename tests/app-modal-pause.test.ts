// @vitest-environment jsdom
/**
 * 看弹窗时暂停时间：打开暂停，关闭或做完决定恢复；手动暂停时不被强行恢复。
 */

import { describe, expect, it } from 'vitest';

import { App } from '../src/ui/App';
import { makeEngine } from './helpers';

function boot() {
  const root = document.createElement('div');
  document.body.append(root);
  const engine = makeEngine('modal-pause');
  const app = new App(root, engine);
  app.start();
  return { app, engine, root };
}

function openEvent(app: App) {
  const dialog = (app as unknown as { eventDialog: { pushMany: (items: unknown[]) => void } })
    .eventDialog;
  dialog.pushMany([{ title: '测试', body: '正文', meta: '第 1 年 1 月 1 日', tone: 'event' }]);
}

function speedOf(app: App): number {
  return (app as unknown as { speed: number }).speed;
}

describe('弹窗与时间', () => {
  it('弹窗打开时暂停，关闭后回到原来的速度', () => {
    const { app } = boot();
    expect(speedOf(app)).toBe(1);
    openEvent(app);
    expect(speedOf(app)).toBe(0);
    (app as unknown as { eventDialog: { dismiss: () => void } }).eventDialog.dismiss();
    expect(speedOf(app)).toBe(1);
  });

  it('手动暂停时关闭弹窗不会自动继续', () => {
    const { app } = boot();
    (app as unknown as { setSpeed: (speed: number) => void }).setSpeed(0);
    openEvent(app);
    (app as unknown as { eventDialog: { dismiss: () => void } }).eventDialog.dismiss();
    expect(speedOf(app)).toBe(0);
  });

  it('有未决抉择时顶栏出现「待决抉择」入口', () => {
    const { app, engine, root } = boot();
    const state = engine.state;
    const player = state.characters[state.playerId];
    if (!player) throw new Error('缺少玩家');
    state.pendingChoices.push({
      id: 'test@1',
      eventId: 'ev_adv_opportunity',
      scope: 'character',
      entityId: player.id,
      day: state.clock.day,
      expiresDay: state.clock.day + 180,
    });
    (app as unknown as { refresh: (force?: boolean) => void }).refresh(true);
    const toggle = root.querySelector<HTMLButtonElement>('[data-tour="pending"]');
    expect(toggle?.hidden).toBe(false);
    expect(toggle?.textContent).toContain('1');
  });
});
