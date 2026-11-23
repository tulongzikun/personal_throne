/**
 * 轻量模态框骨架（P0）：帮助、调试、确认这类"说清楚一件事"的弹窗共用一个壳。
 *
 * 打开时回调 `onVisibilityChange(true)`，关掉时回调 false——外壳靠它暂停时间，
 * 与事件弹窗、存档弹窗用的是同一套约定。
 */

import { el, trapFocus } from './dom';

export interface ModalOptions {
  readonly badge: string;
  readonly title: string;
  /** 可选的整段说明，显示在标题下方。 */
  readonly lead?: string;
  readonly onVisibilityChange?: ((visible: boolean) => void) | undefined;
  readonly wide?: boolean;
}

let counter = 0;

export class Modal {
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  readonly actions: HTMLElement;
  private readonly options: ModalOptions;

  constructor(parent: HTMLElement, options: ModalOptions) {
    this.options = options;
    counter += 1;
    const titleId = `modal-title-${counter}`;

    this.root = el('div', 'modal');
    this.root.hidden = true;
    this.root.setAttribute('aria-hidden', 'true');

    const card = el('div', 'modal__card');
    if (options.wide === true) card.classList.add('modal__card--wide');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', titleId);

    const head = el('div', 'modal__head');
    const title = el('h2', 'modal__title', options.title);
    title.id = titleId;
    head.append(el('span', 'modal__badge', options.badge), title);

    const close = el('button', 'modal__x', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '关闭');
    close.addEventListener('click', () => this.close());
    head.append(close);

    this.body = el('div', 'modal__body');
    if (options.lead !== undefined) this.body.append(el('p', 'modal__lead', options.lead));
    this.actions = el('div', 'modal__actions');

    card.append(head, this.body, this.actions);
    this.root.append(card);
    this.root.addEventListener('click', (event) => {
      if (event.target === this.root) this.close();
    });
    trapFocus(this.root);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.root.hidden) {
        event.preventDefault();
        this.close();
      }
    });
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.root.hidden = false;
    this.root.setAttribute('aria-hidden', 'false');
    window.requestAnimationFrame(() => this.root.classList.add('is-open'));
    this.root.querySelector<HTMLElement>('.modal__x')?.focus();
    this.options.onVisibilityChange?.(true);
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.classList.remove('is-open');
    this.root.hidden = true;
    this.root.setAttribute('aria-hidden', 'true');
    this.options.onVisibilityChange?.(false);
  }
}
