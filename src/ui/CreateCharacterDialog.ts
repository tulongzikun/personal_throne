/**
 * 开局人物创建对话框（M4.2）。
 *
 * 只负责收集选择，真正的生成交给 `GameEngine.createPlayer`：
 * 界面不复制任何属性/天赋规则，避免两套口径。
 */

import type { CharacterCreationChoice } from '../systems/character/CharacterCreator';
import { TALENT_PICKS, TALENT_TAGS, type TalentTag } from '../systems/character/CharacterCreator';
import type { Sex, WorldContent } from '../core/WorldState';
import { ATTRIBUTE_KEYS } from '../core/WorldState';
import { el, fmtMoney, messageOf } from './dom';

export interface CreateCharacterResult {
  readonly ok: boolean;
  readonly error?: string;
}

export class CreateCharacterDialog {
  private readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly talentEl: HTMLElement;
  private readonly counterEl: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly sexSelect: HTMLSelectElement;
  private readonly faithSelect: HTMLSelectElement;
  private readonly startButton: HTMLButtonElement;
  private readonly errorEl: HTMLElement;

  private backgroundId: string;
  private picks: string[] = [];
  private content: WorldContent | null = null;
  private submit: ((choice: CharacterCreationChoice) => CreateCharacterResult) | null = null;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'modal');
    this.root.hidden = true;
    this.root.setAttribute('aria-hidden', 'true');

    this.card = el('div', 'modal__card modal__card--wide');
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-modal', 'true');
    this.card.setAttribute('aria-labelledby', 'create-dialog-title');

    const head = el('div', 'modal__head');
    const title = el('h2', 'modal__title', '创建你的人物');
    title.id = 'create-dialog-title';
    head.append(el('span', 'modal__badge', '新游戏'), title);

    const intro = el(
      'p',
      'modal__body',
      '先选一个出身，再从六个天赋标签里挑三个（可以重复），每个 +2、单维上限 16。姓名留空会按文化随机生成。',
    );

    this.listEl = el('div', 'create-backgrounds');
    this.talentEl = el('div', 'create-talents');
    this.counterEl = el('p', 'create-counter', `已选 0 / ${TALENT_PICKS}`);

    this.nameInput = el('input', 'input');
    this.nameInput.placeholder = '姓名（可留空）';
    this.nameInput.setAttribute('aria-label', '姓名');
    this.sexSelect = el('select', 'input');
    for (const [value, label] of [
      ['male', '男'],
      ['female', '女'],
    ] as const) {
      const option = el('option', '', label);
      option.value = value;
      this.sexSelect.append(option);
    }
    this.sexSelect.setAttribute('aria-label', '性别');
    this.faithSelect = el('select', 'input');
    this.faithSelect.setAttribute('aria-label', '信仰');

    const fields = el('div', 'create-fields');
    const nameField = el('label', 'field');
    nameField.append(el('span', 'field__label', '姓名'), this.nameInput);
    const sexField = el('label', 'field');
    sexField.append(el('span', 'field__label', '性别'), this.sexSelect);
    const faithField = el('label', 'field');
    faithField.append(el('span', 'field__label', '信仰'), this.faithSelect);
    fields.append(nameField, sexField, faithField);

    this.errorEl = el('p', 'create-error');
    this.errorEl.hidden = true;

    const footer = el('div', 'create-footer');
    this.startButton = el('button', 'btn btn--gold', '以此身份登场');
    this.startButton.type = 'button';
    this.startButton.disabled = true;
    this.startButton.addEventListener('click', () => this.confirm());
    const cancel = el('button', 'btn btn--ghost', '取消');
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.close());
    footer.append(cancel, this.startButton);

    this.card.append(
      head,
      intro,
      this.listEl,
      this.counterEl,
      this.talentEl,
      fields,
      this.errorEl,
      footer,
    );
    this.root.append(this.card);
    this.root.addEventListener('click', (event) => {
      if (event.target === this.root) this.close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.root.hidden) this.close();
    });
    parent.append(this.root);

    this.backgroundId = '';
  }

  open(
    content: WorldContent,
    submit: (choice: CharacterCreationChoice) => CreateCharacterResult,
  ): void {
    this.content = content;
    this.submit = submit;
    this.backgroundId = content.backgrounds?.[0]?.id ?? '';
    this.picks = [];
    this.nameInput.value = '';
    this.errorEl.hidden = true;
    this.renderBackgrounds();
    this.renderTalents();
    this.renderFaiths();
    this.renderCounter();
    this.root.hidden = false;
    this.root.setAttribute('aria-hidden', 'false');
    window.requestAnimationFrame(() => this.root.classList.add('is-open'));
    this.card.querySelector<HTMLElement>('.create-backgrounds button')?.focus();
  }

  close(): void {
    this.root.classList.remove('is-open');
    this.root.hidden = true;
    this.root.setAttribute('aria-hidden', 'true');
  }

  /* ------------------------------------------------------------------ */

  private renderBackgrounds(): void {
    this.listEl.replaceChildren();
    for (const background of this.content?.backgrounds ?? []) {
      const node = el('button', 'create-bg', '');
      node.type = 'button';
      node.setAttribute('aria-pressed', String(background.id === this.backgroundId));
      if (background.id === this.backgroundId) node.classList.add('is-active');

      const title = el('span', 'create-bg__title', background.name);
      const meta = el(
        'span',
        'create-bg__meta',
        `${background.classId} · ${background.regionId} · 初始 ${fmtMoney(background.wealth)}`,
      );
      const desc = el('span', 'create-bg__desc', background.description);
      const skills = el(
        'span',
        'create-bg__skills',
        Object.entries(background.skills)
          .map(([skill, value]) => `${skill} ${value}`)
          .join(' · '),
      );
      node.append(title, meta, desc, skills);
      node.addEventListener('click', () => {
        this.backgroundId = background.id;
        this.renderBackgrounds();
        this.updateStart();
      });
      this.listEl.append(node);
    }
  }

  private renderTalents(): void {
    this.talentEl.replaceChildren();
    for (const tag of TALENT_TAGS) {
      const count = this.picks.filter((id) => id === tag.id).length;
      const node = this.talentButton(tag, count);
      node.addEventListener('click', () => {
        if (count > 0) {
          const index = this.picks.lastIndexOf(tag.id);
          if (index >= 0) this.picks.splice(index, 1);
        } else if (this.picks.length < TALENT_PICKS) {
          this.picks.push(tag.id);
        }
        this.renderTalents();
        this.renderCounter();
      });
      this.talentEl.append(node);
    }
  }

  private talentButton(tag: TalentTag, count: number): HTMLButtonElement {
    const node = el('button', 'create-talent', '');
    node.type = 'button';
    node.setAttribute('aria-pressed', String(count > 0));
    if (count > 0) node.classList.add('is-active');
    node.append(
      el('span', 'create-talent__name', `${tag.name}${count > 1 ? ` ×${count}` : ''}`),
      el('span', 'create-talent__attr', `${tag.attribute} +2`),
      el('span', 'create-talent__desc', tag.description),
    );
    return node;
  }

  private renderFaiths(): void {
    const content = this.content;
    this.faithSelect.replaceChildren();
    const background = content?.backgrounds?.find((entry) => entry.id === this.backgroundId);
    const inherit = el('option', '', `跟随出身（${background?.faithId ?? '无信仰'}）`);
    inherit.value = '';
    this.faithSelect.append(inherit);
    for (const faith of content?.faiths ?? []) {
      const option = el('option', '', faith.name);
      option.value = faith.id;
      this.faithSelect.append(option);
    }
    const none = el('option', '', '无信仰');
    none.value = '__none__';
    this.faithSelect.append(none);
  }

  private renderCounter(): void {
    const total = this.picks.length;
    if (total < TALENT_PICKS) {
      this.counterEl.textContent = `已选 ${total} / ${TALENT_PICKS} 个天赋`;
      this.counterEl.classList.remove('is-ready');
    } else {
      const attrs = new Map<string, number>();
      for (const id of this.picks) {
        const tag = TALENT_TAGS.find((entry) => entry.id === id);
        if (tag) attrs.set(tag.attribute, (attrs.get(tag.attribute) ?? 0) + 2);
      }
      const summary = ATTRIBUTE_KEYS.filter((key) => attrs.has(key))
        .map((key) => `${key} +${attrs.get(key)}`)
        .join('，');
      this.counterEl.textContent = `天赋已满：${summary}（点击已选标签可移除）`;
      this.counterEl.classList.add('is-ready');
    }
    for (const node of this.talentEl.querySelectorAll<HTMLButtonElement>('.create-talent')) {
      const tag = TALENT_TAGS.find((entry) => node.textContent?.startsWith(entry.name));
      if (!tag) continue;
      const count = this.picks.filter((id) => id === tag.id).length;
      node.setAttribute('aria-pressed', String(count > 0));
      node.classList.toggle('is-active', count > 0);
      const nameEl = node.querySelector('.create-talent__name');
      if (nameEl) nameEl.textContent = count > 1 ? `${tag.name} ×${count}` : tag.name;
    }
    this.updateStart();
  }

  private updateStart(): void {
    this.startButton.disabled = !this.backgroundId || this.picks.length !== TALENT_PICKS;
  }

  private confirm(): void {
    if (!this.submit) return;
    const faithValue = this.faithSelect.value;
    const name = this.nameInput.value.trim();
    const choice: CharacterCreationChoice = {
      backgroundId: this.backgroundId,
      talents: [...this.picks],
      sex: this.sexSelect.value as Sex,
      ...(name ? { name } : {}),
      ...(faithValue === '' ? {} : { faithId: faithValue === '__none__' ? null : faithValue }),
    };
    const result = this.submit(choice);
    if (!result.ok) {
      this.errorEl.textContent = result.error ?? '创建失败';
      this.errorEl.hidden = false;
      return;
    }
    this.close();
  }
}

/** 把异常转成对话框可显示的一行文本。 */
export function creationErrorText(error: unknown): string {
  return messageOf(error);
}
