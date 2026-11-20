/** 历史面板：最近 50 条记录，可按类别筛选并滚动查看。 */

import { formatDate } from '../core/GameClock';
import type { HistoryKind, HistoryRecord } from '../core/History';
import type { UiDeps } from './context';
import { clear, el } from './dom';
import { HISTORY_KIND_LABELS } from './labels';

const FILTERS: readonly { readonly id: HistoryKind | 'all'; readonly label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'event', label: '事件' },
  { id: 'war', label: '战争' },
  { id: 'finance', label: '财政' },
  { id: 'policy', label: '政策' },
  { id: 'command', label: '命令' },
  { id: 'trade', label: '贸易' },
  { id: 'milestone', label: '里程碑' },
  { id: 'death', label: '死亡' },
];

const LIMIT = 200;

/** 去掉记录里重复的日期前缀（面板已单独显示日期与月份）。 */
function stripDate(summary: string): string {
  return summary.replace(/^\d+年\d+月\d+日\s*/, '');
}

/** 老存档没有 importance 字段：按类别兜底。 */
function isMajor(record: HistoryRecord): boolean {
  if (record.importance) return record.importance === 'major';
  return record.kind !== 'trade' && record.kind !== 'finance';
}

function monthOf(day: number): string {
  const year = Math.floor((day - 1) / 360) + 1;
  const month = Math.floor(((day - 1) % 360) / 30) + 1;
  return `第 ${year} 年 ${month} 月`;
}

export class HistoryPanel {
  private readonly host: HTMLElement;
  private readonly deps: UiDeps;
  private filter: HistoryKind | 'all' = 'all';
  private mineOnly = false;
  private majorOnly = true;

  constructor(host: HTMLElement, deps: UiDeps) {
    this.host = host;
    this.deps = deps;
    this.render();
  }

  reset(): void {
    this.filter = 'all';
    this.mineOnly = false;
    this.majorOnly = true;
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
    const records = this.select(state.history);
    const title = el('div');
    title.append(
      el('h2', 'panel__title', '编年史'),
      el(
        'p',
        'panel__subtitle',
        `共 ${state.history.length} 条记录 · 当前筛选 ${records.length} 条 · 最多显示 ${LIMIT} 条`,
      ),
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

    const mine = el('button', 'chip chip--small chip--mine', '只看我的');
    mine.type = 'button';
    mine.dataset.filter = 'mine';
    mine.setAttribute('aria-pressed', String(this.mineOnly));
    mine.title = '只保留与我的角色、我的组织、我的家族或所在地区有关的记录';
    if (this.mineOnly) mine.classList.add('is-active');
    mine.addEventListener('click', () => {
      this.mineOnly = !this.mineOnly;
      this.render();
    });
    this.host.append(mine);

    const major = el('button', 'chip chip--small chip--major', '只看大事');
    major.type = 'button';
    major.dataset.filter = 'major';
    major.title = '隐藏按月折叠的账本，只留事件、战争、更替与死亡';
    major.setAttribute('aria-pressed', String(this.majorOnly));
    if (this.majorOnly) major.classList.add('is-active');
    major.addEventListener('click', () => {
      this.majorOnly = !this.majorOnly;
      this.render();
    });
    this.host.append(major);

    const body = el('div', 'history__body');
    if (records.length === 0) {
      body.append(el('p', 'empty', '还没有记录。推进时间，世界会自己写下历史。'));
    } else {
      // 按「年-月」分组：日期只出现一次，条目只写当天发生的事。
      let currentMonth = '';
      for (const record of records) {
        const month = monthOf(record.day);
        if (month !== currentMonth) {
          currentMonth = month;
          body.append(el('div', 'history__month', month));
        }
        body.append(this.row(record));
      }
    }
    this.host.append(body);
  }

  /** 与玩家相关的实体 id：本人、家族成员、所属组织、所在地区。 */
  private mineIds(): ReadonlySet<string> {
    const state = this.deps.state();
    const player = state.characters[state.playerId];
    const ids = new Set<string>([state.playerId]);
    if (!player) return ids;
    if (player.organizationId) ids.add(player.organizationId);
    if (player.regionId) ids.add(player.regionId);
    if (player.familyId) {
      ids.add(player.familyId);
      for (const other of Object.values(state.characters)) {
        if (other.familyId === player.familyId) ids.add(other.id);
      }
    }
    return ids;
  }

  private select(history: readonly HistoryRecord[]): HistoryRecord[] {
    const ids = this.mineOnly ? this.mineIds() : null;
    return history
      .filter((record) => this.filter === 'all' || record.kind === this.filter)
      .filter((record) => !this.majorOnly || isMajor(record))
      .filter((record) => ids === null || record.refs.some((ref) => ids.has(ref.id)))
      .slice(-LIMIT)
      .reverse();
  }

  private row(record: HistoryRecord): HTMLElement {
    const state = this.deps.state();
    const row = el('li', `history__row history__row--${record.kind}`);
    row.dataset.historyId = String(record.id);
    row.title = this.rowHint(record);
    const text = el('span', 'history__text', stripDate(record.summary));
    const tags = el('span', 'history__tags');
    if (record.place) {
      const place = state.regions[record.place]?.name;
      if (place) tags.append(el('span', 'history__place', place));
    }
    if (
      record.subject &&
      record.subject.type === 'character' &&
      record.subject.id === state.playerId
    ) {
      tags.append(el('span', 'history__mine', '你'));
    }
    const note = record.body ? el('span', 'history__note', record.body) : null;
    row.append(
      el('span', 'history__day', formatDate(record.day)),
      el('span', `history__kind history__kind--${record.kind}`, HISTORY_KIND_LABELS[record.kind]),
      text,
      tags,
    );
    if (note) row.append(note);
    row.classList.toggle('history__row--noted', note !== null);
    return row;
  }

  private rowHint(record: HistoryRecord): string {
    const state = this.deps.state();
    const scopes = record.refs.map((ref) => this.refLabel(state, ref.type, ref.id));
    const parts = [`第 ${record.day} 天 · ${HISTORY_KIND_LABELS[record.kind]}`];
    if (scopes.length > 0) parts.push(`涉及：${scopes.join('、')}`);
    if (record.causeEventId) parts.push(`起因事件：${record.causeEventId}`);
    return parts.join('\n');
  }

  private refLabel(state: ReturnType<UiDeps['state']>, type: string, id: string): string {
    switch (type) {
      case 'character':
        return state.characters[id]?.name ?? id;
      case 'organization':
        return state.organizations[id]?.name ?? id;
      case 'country':
        return state.countries[id]?.name ?? id;
      case 'region':
        return state.regions[id]?.name ?? id;
      default:
        return id;
    }
  }
}
