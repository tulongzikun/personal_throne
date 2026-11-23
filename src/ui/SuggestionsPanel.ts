/**
 * 建议事项（M7 阶段 5）：左下角常驻的三条「下一步做什么」。
 *
 * 全部来自 `suggestGoals` 的真实数字；点击「去做」直接派发对应命令，
 * 失败时把引擎给的原因照原样显示，不吞错误。
 *
 * P0：计划 W3 会把它换成「可做的事」并删掉求解器；在那之前先把它说不清楚的地方
 * 补上——行动力用完时不再推荐做不到的事，直接说清楚现在只能等。
 */

import { el } from './dom';
import type { UiDeps } from './context';
import { MAX_ACTION_POINTS } from '../systems/character/Activity';
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
    const max = MAX_ACTION_POINTS;
    this.body.replaceChildren();

    if (!player) {
      this.subtitle.textContent = '按当前局势挑的三件事';
      this.body.append(el('li', 'suggestions__empty', '这一局没有可做的事了。'));
      return;
    }

    this.subtitle.textContent = `行动力 ${player.actionPoints}/${max} · 现金 ${player.wealth} 铜币`;

    // 没有行动力时，推荐什么都做不到——不如直接说清楚"现在只能等"。
    if (player.actionPoints <= 0) {
      const item = el('li', 'suggestions__item suggestions__item--wait');
      const text = el('div', 'suggestions__text');
      text.append(
        el('strong', 'suggestions__name', '这个月没行动力了'),
        el(
          'p',
          'suggestions__detail',
          '行动力每月初回满。把时间调快（1/2/3 键），或按「跳到下一事件」等下个月。',
        ),
      );
      item.append(el('span', 'suggestions__order', '·'), text);
      this.body.append(item);
      return;
    }

    const suggestions = suggestGoals(state, this.deps.content());
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
