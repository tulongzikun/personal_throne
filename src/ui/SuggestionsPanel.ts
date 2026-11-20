/**
 * 建议事项（M7 阶段 5）：左下角常驻的三条「下一步做什么」。
 *
 * 全部来自 `suggestGoals` 的真实数字；点击「去做」直接派发对应命令，
 * 失败时把引擎给的原因照原样显示，不吞错误。
 */

import { el } from './dom';
import type { UiDeps } from './context';
import { suggestGoals } from '../systems/goals/Goals';

export class SuggestionsPanel {
  private readonly host: HTMLElement;
  private readonly deps: UiDeps;
  private readonly body: HTMLElement;
  private readonly subtitle: HTMLElement;

  constructor(host: HTMLElement, deps: UiDeps) {
    this.host = host;
    this.deps = deps;
    const card = el('section', 'suggestions');
    card.dataset.panel = 'suggestions';
    card.setAttribute('aria-label', '建议事项');
    const head = el('div', 'suggestions__head');
    head.append(el('h2', 'suggestions__title', '建议事项'));
    this.subtitle = el('p', 'suggestions__subtitle', '按当前局势挑的三件事');
    head.append(this.subtitle);
    this.body = el('ol', 'suggestions__list');
    card.append(head, this.body);
    this.host.append(card);
  }

  render(): void {
    const state = this.deps.state();
    const player = state.characters[state.playerId];
    this.subtitle.textContent = player
      ? `行动力 ${player.actionPoints}/3 · 现金 ${player.wealth} 铜币`
      : '按当前局势挑的三件事';
    const suggestions = suggestGoals(state, this.deps.content());
    this.body.replaceChildren();
    if (suggestions.length === 0) {
      this.body.append(el('li', 'suggestions__empty', '这一局没有可做的事了。'));
      return;
    }
    for (const [index, suggestion] of suggestions.entries()) {
      const item = el('li', 'suggestions__item');
      const order = el('span', 'suggestions__order', String(index + 1));
      const text = el('div', 'suggestions__text');
      text.append(
        el('strong', 'suggestions__name', suggestion.title),
        el('p', 'suggestions__detail', suggestion.detail),
      );
      item.append(order, text);
      if (suggestion.command) {
        const command = suggestion.command;
        const button = el('button', 'btn btn--small suggestions__go', '去做');
        button.type = 'button';
        button.addEventListener('click', () => {
          const result = this.deps.dispatch(command);
          if (!result.ok) this.deps.notify(result.error ?? '这件事现在做不了', 'info');
          this.deps.refresh();
        });
        item.append(button);
      }
      this.body.append(item);
    }
  }
}
