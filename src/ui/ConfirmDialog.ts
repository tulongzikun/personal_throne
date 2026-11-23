/**
 * 确认框（P0）：会覆盖当前王朝的操作，先问一句再动手。
 */

import { el } from './dom';
import { Modal } from './Modal';

export interface ConfirmRequest {
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
}

export class ConfirmDialog {
  private readonly modal: Modal;
  private readonly lead: HTMLElement;
  private readonly confirm: HTMLButtonElement;
  private request: ConfirmRequest | null = null;

  constructor(parent: HTMLElement, onVisibilityChange?: (visible: boolean) => void) {
    this.modal = new Modal(parent, {
      badge: '确认',
      title: '确定吗？',
      onVisibilityChange,
    });
    this.lead = el('p', 'modal__lead', '');
    this.modal.body.append(this.lead);

    this.confirm = el('button', 'btn btn--gold', '确定');
    this.confirm.type = 'button';
    this.confirm.addEventListener('click', () => {
      const request = this.request;
      this.modal.close();
      request?.onConfirm();
    });
    const cancel = el('button', 'btn btn--ghost', '取消');
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.modal.close());
    this.modal.actions.append(cancel, this.confirm);
  }

  open(request: ConfirmRequest): void {
    this.request = request;
    const title = this.modal.root.querySelector('.modal__title');
    if (title) title.textContent = request.title;
    this.lead.textContent = request.body;
    this.confirm.textContent = request.confirmLabel;
    this.modal.open();
  }

  close(): void {
    this.modal.close();
  }

  get isOpen(): boolean {
    return this.modal.isOpen;
  }
}
