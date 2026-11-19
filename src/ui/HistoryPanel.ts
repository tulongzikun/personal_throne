/** 历史面板：最近 50 条记录，可按类别筛选并滚动查看。 */

import { formatDate } from '../core/GameClock';
import type { HistoryKind, HistoryRecord } from '../core/History';
import type { UiDeps } from './context';
import { clear, el } from './dom';
import { HISTORY_KIND_LABELS } from './labels';

const FILTERS: readonly { readonly id: HistoryKind | 'all'; readonly label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'event', label: '事件' },
  { id: 'finance', label: '财政' },
  { id: 'policy', label: '政策' },
  { id: 'command', label: '命令' },
  { id: 'trade', label: '贸易' },
  { id: 'milestone', label: '里程碑' },
  { id: 'death', label: '死亡' },
];

const LIMIT = 50;

export class HistoryPanel {
  private readonly host: HTMLElement;
  private readonly deps: UiDeps;
  private filter: HistoryKind | 'all' = 'all';

  constructor(host: HTMLElement, deps: UiDeps) {
    this.host = host;
    this.deps = deps;
    this.render();
  }

  reset(): void {
    this.filter = 'all';
    this.render();
  }

  update(): void {
    const previous = this.host.querySelector<HTMLElement>('.history__body');
    const scrollTop = previous?.scrollTop ?? 0;
    this.render();
    const next = this.host.querySelector<HTMLElement>('.history__body');
    if (next) next.scrollTop = scrollTop;
  }

  private render(): void {
    const state = this.deps.state();
    clear(this.host);

    const head = el('div', 'panel__head');
    const title = el('div');
    title.append(
      el('h2', 'panel__title', '编年史'),
      el('p', 'panel__subtitle', `共 ${state.history.length} 条记录 · 显示最近 ${LIMIT} 条`),
    );
    head.append(title);
    this.host.append(head);

    const filters = el('div', 'chip-row chip-row--wrap');
    for (const filter of FILTERS) {
      const chip = el('button', 'chip chip--small', filter.label);
      chip.type = 'button';
      if (this.filter === filter.id) chip.classList.add('is-active');
      chip.addEventListener('click', () => {
        this.filter = filter.id;
        this.render();
      });
      filters.append(chip);
    }
    this.host.append(filters);

    const records = state.history
      .filter((record) => this.filter === 'all' || record.kind === this.filter)
      .slice(-LIMIT)
      .reverse();

    const body = el('div', 'history__body');
    if (records.length === 0) {
      body.append(el('p', 'empty', '还没有记录。推进时间，世界会自己写下历史。'));
    } else {
      const list = el('ol', 'history__list');
      for (const record of records) list.append(this.row(record));
      body.append(list);
    }
    this.host.append(body);
  }

  private row(record: HistoryRecord): HTMLElement {
    const row = el('li', `history__row history__row--${record.kind}`);
    row.dataset.historyId = String(record.id);
    row.append(
      el('span', 'history__day', formatDate(record.day)),
      el('span', `history__kind history__kind--${record.kind}`, HISTORY_KIND_LABELS[record.kind]),
      el('span', 'history__text', record.summary),
    );
    return row;
  }
}
