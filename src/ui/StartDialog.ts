/**
 * 开局选择（M6.2 第 2 阶段）。
 *
 * 首次进入且没有存档时弹出：要么沿用做好的默认人物，要么自己捏一个。
 * 两条路都落在同一个 `GameEngine` 上，选择本身的规则不在这里实现。
 */

import { el } from './dom';

export interface StartDialogHandlers {
  readonly onDefault: () => void;
  readonly onCreate: () => void;
}

export class StartDialog {
  private readonly root: HTMLElement;
  private handlers: StartDialogHandlers | null = null;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'modal');
    this.root.hidden = true;
    this.root.setAttribute('aria-hidden', 'true');

    const card = el('div', 'modal__card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'start-dialog-title');

    const head = el('div', 'modal__head');
    const title = el('h2', 'modal__title', '从何处开始');
    title.id = 'start-dialog-title';
    head.append(el('span', 'modal__badge', '新游戏'), title);

    const body = el(
      'p',
      'modal__body',
      '默认人物是绿野镇金穗行的少东家艾伦·格雷：持股 22%，掌柜是你的叔父霍布·金穗——字号还轮不到你说了算，但你有本钱、有出身，也有一条往上爬的路。也可以自己捏一个人物，从任何国家、任何组织或无组织起步。',
    );

    const actions = el('div', 'create-footer');
    const defaultButton = el('button', 'btn btn--gold', '以艾伦·格雷开局');
    defaultButton.type = 'button';
    defaultButton.addEventListener('click', () => {
      this.close();
      this.handlers?.onDefault();
    });
    const createButton = el('button', 'btn btn--ghost', '创建我自己的人物');
    createButton.type = 'button';
    createButton.addEventListener('click', () => {
      this.close();
      this.handlers?.onCreate();
    });
    actions.append(createButton, defaultButton);

    card.append(head, body, actions);
    this.root.append(card);
    this.root.addEventListener('click', (event) => {
      if (event.target === this.root) this.close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.root.hidden) this.close();
    });
    parent.append(this.root);
  }

  open(handlers: StartDialogHandlers): void {
    this.handlers = handlers;
    this.root.hidden = false;
    this.root.setAttribute('aria-hidden', 'false');
    window.requestAnimationFrame(() => this.root.classList.add('is-open'));
    this.root.querySelector<HTMLElement>('.btn--gold')?.focus();
  }

  close(): void {
    this.root.classList.remove('is-open');
    this.root.hidden = true;
    this.root.setAttribute('aria-hidden', 'true');
  }
}
