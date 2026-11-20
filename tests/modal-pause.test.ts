// @vitest-environment jsdom
/**
 * 看弹窗时应暂停时间：对话框打开/关闭要通知外层，避免时间在阅读时继续流逝。
 */

import { describe, expect, it } from 'vitest';

import { EventDialog } from '../src/ui/EventDialog';

function signal() {
  return {
    title: '测试事件',
    body: '正文',
    meta: '第 1 年 1 月 1 日',
    tone: 'event' as const,
  };
}

describe('事件弹窗与时间暂停', () => {
  it('打开时通知一次，关闭时通知一次', () => {
    const events: boolean[] = [];
    const host = document.createElement('div');
    document.body.append(host);
    const dialog = new EventDialog(host, {
      onVisibilityChange: (visible) => events.push(visible),
    });

    dialog.pushMany([signal()]);
    expect(events).toEqual([true]);

    // 队列里还有一条时关闭不应通知「可见」两次。
    dialog.pushMany([signal()]);
    expect(events).toEqual([true]);

    dialog.dismiss();
    expect(events).toEqual([true]);
    dialog.dismiss();
    expect(events).toEqual([true, false]);
  });

  it('点选项会关闭弹窗并通知恢复', () => {
    const events: boolean[] = [];
    const host = document.createElement('div');
    document.body.append(host);
    const dialog = new EventDialog(host, {
      onVisibilityChange: (visible) => events.push(visible),
    });

    let picked: string | null = null;
    dialog.pushMany([
      {
        ...signal(),
        tone: 'choice',
        options: [
          { id: 'a', label: '选项 A' },
          { id: 'b', label: '选项 B' },
        ],
        onPick: (id) => {
          picked = id;
        },
      },
    ]);
    const buttons = host.querySelectorAll<HTMLButtonElement>('.modal__choice');
    expect(buttons).toHaveLength(2);
    buttons[0]?.click();
    expect(picked).toBe('a');
    expect(events.at(-1)).toBe(false);
  });
});
