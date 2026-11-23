/**
 * 调试信息（P0）：哈希、种子、版本、规模从顶栏挪到这里。
 *
 * 玩家平时不需要这些数字；需要复现问题时它们必须能一次复制走。
 */

import { el } from './dom';
import { Modal } from './Modal';
import type { GameEngine } from '../core/GameEngine';

export class DebugDialog {
  private readonly modal: Modal;
  private readonly engine: () => GameEngine;
  private readonly list: HTMLElement;
  private readonly copy: HTMLButtonElement;

  constructor(
    parent: HTMLElement,
    engine: () => GameEngine,
    onVisibilityChange?: (visible: boolean) => void,
  ) {
    this.engine = engine;
    this.modal = new Modal(parent, {
      badge: '调试',
      title: '这一局的技术信息',
      onVisibilityChange,
    });
    this.list = el('dl', 'debug__list');
    this.modal.body.append(
      el('p', 'modal__lead', '复现问题时报给开发者用。同样的种子与同一天，状态哈希必然相同。'),
      this.list,
    );
    this.copy = el('button', 'btn btn--ghost', '复制');
    this.copy.type = 'button';
    this.copy.addEventListener('click', () => void this.copyAll());
    const close = el('button', 'btn btn--gold', '关闭');
    close.type = 'button';
    close.addEventListener('click', () => this.modal.close());
    this.modal.actions.append(this.copy, close);
  }

  open(): void {
    this.render();
    this.modal.open();
  }

  close(): void {
    this.modal.close();
  }

  get isOpen(): boolean {
    return this.modal.isOpen;
  }

  private render(): void {
    const engine = this.engine();
    const state = engine.state;
    const living = Object.values(state.characters).filter((character) => character.alive).length;
    this.list.replaceChildren();
    for (const [label, value] of [
      ['状态哈希', engine.hash()],
      ['第几天', String(state.clock.day)],
      ['种子', state.meta.seed],
      ['存档版本', String(state.meta.schemaVersion)],
      ['内容版本', state.meta.contentVersion],
      ['世界 ID', state.meta.worldId],
      [
        '规模',
        `${living} 位在世人物 · ${Object.keys(state.organizations).length} 个组织 · ${Object.keys(state.countries).length} 个国家 · ${state.history.length} 条历史`,
      ],
    ] as const) {
      const row = el('div', 'debug__row');
      row.append(el('dt', 'debug__term', label), el('dd', 'debug__value', value));
      this.list.append(row);
    }
  }

  private async copyAll(): Promise<void> {
    const text = [...this.list.querySelectorAll('.debug__row')]
      .map(
        (row) =>
          `${row.querySelector('dt')?.textContent ?? ''}：${row.querySelector('dd')?.textContent ?? ''}`,
      )
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      this.copy.textContent = '已复制';
      window.setTimeout(() => {
        this.copy.textContent = '复制';
      }, 1500);
    } catch {
      this.copy.textContent = '复制失败';
    }
  }
}
