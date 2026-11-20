/** 人物面板：玩家属性卡 + 可点击的 NPC 只读卡。 */

import type { UiDeps } from './context';
import { renderCharacterCard } from './CharacterCard';
import { clear, el, fmtMoney } from './dom';
import { CLASS_LABELS, RACE_LABELS, labelOf } from './labels';

export class CharacterPanel {
  private readonly host: HTMLElement;
  private readonly deps: UiDeps;
  private selectedId: string | null = null;

  constructor(host: HTMLElement, deps: UiDeps) {
    this.host = host;
    this.deps = deps;
    this.render();
  }

  select(characterId: string): void {
    if (!this.deps.state().characters[characterId]) return;
    this.selectedId = characterId;
    this.render();
  }

  reset(): void {
    this.selectedId = null;
    this.render();
  }

  update(): void {
    this.render();
  }

  private render(): void {
    const state = this.deps.state();
    clear(this.host);

    const player = state.characters[state.playerId];
    const selected = (this.selectedId ? state.characters[this.selectedId] : undefined) ?? player;
    if (!selected) {
      this.host.append(el('p', 'empty', '人物数据缺失。'));
      return;
    }

    const isPlayer = selected.id === state.playerId;
    const head = el('div', 'detail-head');
    const title = el('div');
    title.append(
      el('h2', 'detail-head__title', selected.name),
      el(
        'p',
        'detail-head__meta',
        `${labelOf(RACE_LABELS, selected.raceId)} · ${labelOf(CLASS_LABELS, selected.classId)} · ${selected.age} 岁`,
      ),
    );
    head.append(
      title,
      el('span', `badge ${isPlayer ? 'badge--gold' : ''}`, isPlayer ? '玩家' : '只读'),
    );
    this.host.append(head);

    if (!isPlayer) {
      const back = el('button', 'btn btn--small', '← 返回玩家');
      back.type = 'button';
      back.addEventListener('click', () => {
        this.selectedId = null;
        this.render();
      });
      this.host.append(back);
    }

    renderCharacterCard(this.host, this.deps, selected);

    this.host.append(el('h3', 'section-title', '其他人（只读）'));
    this.host.append(el('p', 'hint', '你自己固定在左上角的玩家卡；这里只列出世界中的其他人物。'));
    const roster = el('ul', 'row-list row-list--compact');
    const characters = Object.values(state.characters)
      .filter((character) => character.alive && character.id !== state.playerId)
      .sort((a, b) => b.wealth - a.wealth);
    for (const character of characters) {
      const characterOrg = character.organizationId
        ? state.organizations[character.organizationId]
        : undefined;
      const row = el('li', 'row-list__item');
      const open = el('button', 'row-list__button');
      open.type = 'button';
      open.dataset.characterId = character.id;
      if (character.id === selected.id) open.classList.add('is-active');
      open.append(
        el('span', 'row-list__name', character.name),
        el(
          'span',
          'row-list__meta',
          `${labelOf(CLASS_LABELS, character.classId)}${characterOrg ? ` · ${characterOrg.name}` : ''}`,
        ),
        el('span', 'row-list__value', fmtMoney(character.wealth)),
      );
      if (character.id === state.playerId) open.append(el('span', 'badge badge--gold', '玩家'));
      open.addEventListener('click', () => {
        this.selectedId = character.id === state.playerId ? null : character.id;
        this.render();
      });
      row.append(open);
      roster.append(row);
    }
    this.host.append(roster);

    this.host.append(el('p', 'panel__note', `共 ${characters.length} 位在世人物 · 点击姓名查看`));
  }
}
