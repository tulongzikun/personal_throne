/** 事件对话框：世界事件与待办预兆共用一个模态队列，关闭后自动显示下一条。 */

import { el, trapFocus } from './dom';

/** 模态队列上限：超出的信号直接折叠进编年史，避免 30× 下无限堆积。 */
export interface EventDialogOptions {
  /** 打开/关闭时通知外层：App 用它在看弹窗时暂停时间，关闭后恢复。 */
  readonly onVisibilityChange?: (visible: boolean) => void;
}
const QUEUE_LIMIT = 5;

export interface ChoiceOption {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
}

export interface DigestItem {
  readonly title: string;
  readonly subject: string;
  readonly body: string;
}

export interface WorldSignal {
  readonly title: string;
  readonly body: string;
  readonly meta: string;
  readonly tone: 'event' | 'omen' | 'choice' | 'digest';
  /** 主体名，如「夜囊帮」；有值时标题渲染为「主体 · 事件名」。 */
  readonly subject?: string;
  /** 与玩家的关系标签，如「你的组织」。 */
  readonly relation?: string;
  /** 「本月见闻」摘要条目。 */
  readonly items?: readonly DigestItem[];
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
  private readonly digestEl: HTMLElement;
  private readonly queue: WorldSignal[] = [];
  private visible = false;

  constructor(
    parent: HTMLElement,
    private readonly options: EventDialogOptions = {},
  ) {
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
    this.digestEl = el('div', 'modal__digest');
    this.digestEl.hidden = true;
    const close = el('button', 'btn btn--gold modal__close', '关闭');
    close.type = 'button';
    close.addEventListener('click', () => this.dismiss());

    this.card.append(head, this.metaEl, this.bodyEl, this.digestEl, this.choicesEl, close);
    this.root.append(this.card);
    this.root.addEventListener('click', (event) => {
      if (event.target === this.root) this.dismiss();
    });
    trapFocus(this.root);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.visible) {
        event.preventDefault();
        this.dismiss();
      }
    });

    parent.append(this.root);
  }

  /** 入队；队列超过上限时丢弃末尾并返回丢弃条数（由调用方提示「已收入编年史」）。 */
  pushMany(signals: readonly WorldSignal[]): number {
    if (signals.length === 0) return 0;
    const room = QUEUE_LIMIT - this.queue.length;
    if (room > 0) this.queue.push(...signals.slice(0, room));
    if (!this.visible) this.next();
    return Math.max(0, signals.length - Math.max(0, room));
  }

  dismiss(): void {
    if (!this.visible) return;
    this.root.classList.remove('is-open');
    this.root.hidden = true;
    this.root.setAttribute('aria-hidden', 'true');
    // 队列里还有下一条时，弹窗整体仍然可见，不通知外层恢复时间。
    if (this.queue.length > 0) {
      this.next();
      return;
    }
    this.visible = false;
    this.options.onVisibilityChange?.(false);
  }

  private next(): void {
    const signal = this.queue.shift();
    if (!signal) return;
    const badgeByTone = {
      event: '世界事件',
      omen: '预兆',
      choice: '你的抉择',
      digest: '世界见闻',
    } as const;
    this.badgeEl.textContent = badgeByTone[signal.tone];
    this.badgeEl.className = `modal__badge modal__badge--${signal.tone}`;
    this.titleEl.textContent = signal.subject
      ? `${signal.subject} · ${signal.title}`
      : signal.title;
    this.metaEl.textContent = signal.relation ? `${signal.meta} · ${signal.relation}` : signal.meta;
    this.bodyEl.textContent = signal.body;
    this.bodyEl.hidden = (signal.items ?? []).length > 0;

    this.digestEl.replaceChildren();
    for (const item of signal.items ?? []) {
      const row = el('div', 'modal__digest-item');
      const head = el('span', 'modal__digest-title', item.title);
      const subject = el('span', 'modal__digest-subject', item.subject);
      const body = el('p', 'modal__digest-body', item.body);
      row.append(head, subject, body);
      this.digestEl.append(row);
    }
    this.digestEl.hidden = (signal.items ?? []).length === 0;

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
    if (!this.visible) this.options.onVisibilityChange?.(true);
    this.visible = true;
    window.requestAnimationFrame(() => this.root.classList.add('is-open'));
  }
}
