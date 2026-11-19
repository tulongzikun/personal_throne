/** 事件对话框：世界事件与待办预兆共用一个模态队列，关闭后自动显示下一条。 */

import { el } from './dom';

export interface ChoiceOption {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
}

export interface WorldSignal {
  readonly title: string;
  readonly body: string;
  readonly meta: string;
  readonly tone: 'event' | 'omen' | 'choice';
  readonly options?: readonly ChoiceOption[];
  readonly onPick?: (optionId: string) => void;
}

export class EventDialog {
  private readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly metaEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly badgeEl: HTMLElement;
  private readonly choicesEl: HTMLElement;
  private readonly queue: WorldSignal[] = [];
  private visible = false;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'modal');
    this.root.hidden = true;
    this.root.setAttribute('aria-hidden', 'true');

    this.card = el('div', 'modal__card');
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-modal', 'true');
    this.card.setAttribute('aria-labelledby', 'event-dialog-title');

    const head = el('div', 'modal__head');
    this.badgeEl = el('span', 'modal__badge', '世界事件');
    this.titleEl = el('h2', 'modal__title');
    this.titleEl.id = 'event-dialog-title';
    head.append(this.badgeEl, this.titleEl);

    this.metaEl = el('p', 'modal__meta');
    this.bodyEl = el('p', 'modal__body');
    this.choicesEl = el('div', 'modal__choices');
    const close = el('button', 'btn btn--gold modal__close', '关闭');
    close.type = 'button';
    close.addEventListener('click', () => this.dismiss());

    this.card.append(head, this.metaEl, this.bodyEl, this.choicesEl, close);
    this.root.append(this.card);
    this.root.addEventListener('click', (event) => {
      if (event.target === this.root) this.dismiss();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.visible) {
        event.preventDefault();
        this.dismiss();
      }
    });

    parent.append(this.root);
  }

  pushMany(signals: readonly WorldSignal[]): void {
    if (signals.length === 0) return;
    this.queue.push(...signals);
    if (!this.visible) this.next();
  }

  dismiss(): void {
    if (!this.visible) return;
    this.visible = false;
    this.root.classList.remove('is-open');
    this.root.hidden = true;
    this.root.setAttribute('aria-hidden', 'true');
    this.next();
  }

  private next(): void {
    const signal = this.queue.shift();
    if (!signal) return;
    this.badgeEl.textContent =
      signal.tone === 'omen' ? '预兆' : signal.tone === 'choice' ? '你的抉择' : '世界事件';
    this.badgeEl.className = `modal__badge modal__badge--${signal.tone}`;
    this.titleEl.textContent = signal.title;
    this.metaEl.textContent = signal.meta;
    this.bodyEl.textContent = signal.body;

    this.choicesEl.replaceChildren();
    for (const option of signal.options ?? []) {
      const button = el('button', 'btn btn--gold modal__choice', option.label);
      button.type = 'button';
      if (option.hint) button.title = option.hint;
      button.addEventListener('click', () => {
        const handler = signal.onPick;
        this.dismiss();
        handler?.(option.id);
      });
      this.choicesEl.append(button);
    }
    this.choicesEl.hidden = (signal.options ?? []).length === 0;

    this.root.hidden = false;
    this.root.setAttribute('aria-hidden', 'false');
    this.visible = true;
    window.requestAnimationFrame(() => this.root.classList.add('is-open'));
  }
}
