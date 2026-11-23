/**
 * 月报（P1）：月末结算后浮在右下角的一张小报。
 *
 * 它是"非模态"的：不挡操作、不暂停时间，看完按 × 或 Esc 关掉。
 * 内容全部来自 `MonthlyReport`（由引擎在月末生成），这里只负责排版。
 */

import { button, el } from './dom';
import type { MonthlyReport } from '../core/MonthlyReport';

export class MonthReportPanel {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly changes: HTMLElement;
  private readonly looming: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = el('aside', 'month-report');
    this.root.hidden = true;
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');
    this.root.setAttribute('aria-label', '本月小结');

    const head = el('div', 'month-report__head');
    this.title = el('h2', 'month-report__title');
    const close = button('×', () => this.hide(), 'ghost');
    close.classList.add('month-report__close');
    close.setAttribute('aria-label', '关掉本月小结');
    head.append(this.title, close);

    const changesLabel = el('h3', 'month-report__label', '这个月');
    this.changes = el('ul', 'month-report__list');

    const loomingLabel = el('h3', 'month-report__label', '接下来');
    this.looming = el('ul', 'month-report__list month-report__list--looming');

    this.root.append(head, changesLabel, this.changes, loomingLabel, this.looming);
    parent.append(this.root);
  }

  show(report: MonthlyReport): void {
    this.title.textContent = report.title;
    this.changes.replaceChildren();
    for (const line of report.changes) this.changes.append(el('li', 'month-report__item', line));
    if (report.changes.length === 0) {
      this.changes.append(
        el('li', 'month-report__item month-report__item--quiet', '没什么值得记的事'),
      );
    }
    this.looming.replaceChildren();
    for (const line of report.looming) {
      this.looming.append(el('li', 'month-report__item', line));
    }
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  get visible(): boolean {
    return !this.root.hidden;
  }
}
