/** 国家面板：国库、债务、合法性与五项政策，以及游说入口。 */

import type { CommandResult } from '../core/CommandBus';
import type { PolicyVector } from '../core/WorldState';
import type { UiDeps } from './context';
import { clear, el, fmtInt, fmtMoney, fmtPct, withHint } from './dom';
import { POLITY_LABELS, POLICY_LABELS, labelOf } from './labels';

const POLICY_KEYS: readonly (keyof PolicyVector)[] = [
  'taxRate',
  'tariffRate',
  'militaryShare',
  'tradeFreedom',
  'regulation',
];

const LOBBY_DELTAS: readonly number[] = [-0.2, -0.1, -0.05, 0.05, 0.1, 0.2];

interface LastResult {
  readonly ok: boolean;
  readonly text: string;
}

export class CountryPanel {
  private readonly host: HTMLElement;
  private readonly deps: UiDeps;
  private lobbyCountryId: string;
  private lobbyPolicy: keyof PolicyVector = 'taxRate';
  private lobbyDelta = 0.05;
  private last: LastResult | null = null;
  private dirty = false;

  constructor(host: HTMLElement, deps: UiDeps) {
    this.host = host;
    this.deps = deps;
    this.lobbyCountryId = Object.keys(deps.state().countries).sort()[0] ?? '';
    host.addEventListener('focusout', () => {
      window.setTimeout(() => {
        if (!this.host.contains(document.activeElement) && this.dirty) {
          this.dirty = false;
          this.render();
        }
      }, 0);
    });
    this.render();
  }

  update(): void {
    const active = document.activeElement;
    const editing = active instanceof HTMLInputElement || active instanceof HTMLSelectElement;
    if (editing && this.host.contains(active)) {
      this.dirty = true;
      return;
    }
    this.render();
  }

  private render(): void {
    const state = this.deps.state();
    clear(this.host);

    const countries = Object.values(state.countries).sort((a, b) => a.name.localeCompare(b.name));
    if (!this.lobbyCountryId) this.lobbyCountryId = countries[0]?.id ?? '';

    this.host.append(el('h3', 'section-title section-title--first', '列国志'));
    for (const country of countries) {
      const ruler = state.characters[country.rulerId];
      const card = el('article', 'country-card');
      if (country.id === this.lobbyCountryId) card.classList.add('is-active');

      const head = el('div', 'country-card__head');
      const title = el('div');
      title.append(
        el('h2', 'country-card__title', country.name),
        el(
          'p',
          'country-card__meta',
          `${labelOf(POLITY_LABELS, country.polity)} · 统治者 ${ruler?.name ?? '—'} · 人口 ${fmtInt(country.population)}`,
        ),
      );
      const lobby = el('button', 'btn btn--small', '游说此国');
      lobby.type = 'button';
      lobby.addEventListener('click', () => {
        this.lobbyCountryId = country.id;
        this.render();
      });
      head.append(title, lobby);
      card.append(head);

      const stats = el('div', 'stat-grid stat-grid--four');
      stats.append(
        this.stat(
          '国库',
          fmtMoney(country.treasury),
          'neutral',
          '中央现金储备：军费、赈济与官员俸禄从中支出',
        ),
        this.stat(
          '债务',
          fmtMoney(country.debt),
          country.debt > country.treasury ? 'bad' : 'neutral',
          '未偿国债：利息在月度结算中计入支出',
        ),
        this.stat(
          '月结余',
          fmtMoney(country.monthlyRevenue - country.monthlyExpense),
          country.monthlyRevenue - country.monthlyExpense >= 0 ? 'good' : 'bad',
          '月收入 − 月支出；连续为负会推高债务与不满',
        ),
        this.stat(
          '军力',
          fmtInt(country.military),
          'neutral',
          '常备军规模：影响战争结果与军费开支',
        ),
        this.stat(
          '合法性',
          fmtPct(country.legitimacy),
          'neutral',
          '统治被承认的程度；过低会引发政变与割据',
        ),
        this.stat(
          '稳定度',
          fmtPct(country.stability),
          'neutral',
          '社会秩序：受税率、物价与战争影响',
        ),
        this.stat(
          '月收入',
          fmtMoney(country.monthlyRevenue),
          'neutral',
          '月度税收与关税合计，随税率与市场行情波动',
        ),
        this.stat(
          '月支出',
          fmtMoney(country.monthlyExpense),
          'neutral',
          '军费、行政与债务利息的月度合计',
        ),
      );
      card.append(stats);

      if (country.offices.length > 0) {
        const seats = el('p', 'panel__note', '公职');
        const list = el('ul', 'plain-list');
        for (const office of country.offices) {
          const holder = state.characters[office.holderId];
          const item = el('li');
          item.append(
            el('span', 'plain-list__term', office.title),
            el(
              'span',
              'plain-list__value',
              `${holder?.name ?? '空缺'} · 影响力 ${fmtPct(office.influence)}`,
            ),
          );
          list.append(item);
        }
        card.append(seats, list);
      }

      const policyTitle = el('h3', 'section-title', '政策刻度');
      card.append(policyTitle);
      for (const key of POLICY_KEYS) {
        const value = country.policies[key];
        const row = el('label', 'policy-row');
        const range = el('input', 'range');
        range.type = 'range';
        range.min = '0';
        range.max = '1';
        range.step = '0.01';
        range.value = String(value);
        range.disabled = true;
        range.setAttribute('aria-label', `${country.name} ${POLICY_LABELS[key]}`);
        row.append(
          el('span', 'policy-row__label', POLICY_LABELS[key]),
          range,
          el('span', 'policy-row__value', fmtPct(value)),
        );
        card.append(row);
      }

      const diplomacy = Object.entries(country.diplomacy)
        .map(([id, value]) => `${state.countries[id]?.name ?? id} ${value > 0 ? '+' : ''}${value}`)
        .join(' · ');
      if (diplomacy) card.append(el('p', 'panel__note', `外交关系：${diplomacy}`));
      this.host.append(card);
    }

    this.host.append(el('h3', 'section-title', '游说'));
    this.host.append(this.buildLobbyForm());
    if (this.last) {
      const result = el('p', `result result--${this.last.ok ? 'ok' : 'error'}`, this.last.text);
      result.setAttribute('role', 'status');
      this.host.append(result);
    }
  }

  private buildLobbyForm(): HTMLElement {
    const state = this.deps.state();
    const form = el('div', 'action-group');
    const row = el('div', 'form-row');

    const countrySelect = el('select', 'input');
    countrySelect.setAttribute('aria-label', '游说目标国家');
    for (const country of Object.values(state.countries).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const option = el('option', undefined, country.name);
      option.value = country.id;
      countrySelect.append(option);
    }
    countrySelect.value = this.lobbyCountryId;
    countrySelect.addEventListener('change', () => {
      this.lobbyCountryId = countrySelect.value;
    });

    const policySelect = el('select', 'input');
    policySelect.setAttribute('aria-label', '游说政策');
    for (const key of POLICY_KEYS) {
      const option = el('option', undefined, POLICY_LABELS[key]);
      option.value = key;
      policySelect.append(option);
    }
    policySelect.value = this.lobbyPolicy;
    policySelect.addEventListener('change', () => {
      this.lobbyPolicy = policySelect.value as keyof PolicyVector;
    });

    const deltaSelect = el('select', 'input');
    deltaSelect.setAttribute('aria-label', '游说幅度');
    for (const delta of LOBBY_DELTAS) {
      const option = el('option', undefined, `${delta > 0 ? '+' : ''}${delta.toFixed(2)}`);
      option.value = String(delta);
      deltaSelect.append(option);
    }
    deltaSelect.value = String(this.lobbyDelta);
    deltaSelect.addEventListener('change', () => {
      this.lobbyDelta = Number(deltaSelect.value);
    });

    const countryField = el('label', 'field field--grow');
    countryField.append(el('span', 'field__label', '国家'), countrySelect);
    const policyField = el('label', 'field');
    policyField.append(el('span', 'field__label', '政策'), policySelect);
    const deltaField = el('label', 'field');
    deltaField.append(el('span', 'field__label', '幅度'), deltaSelect);
    row.append(countryField, policyField, deltaField);
    form.append(row);

    const cost = Math.max(100, Math.round(Math.abs(this.lobbyDelta) * 5_000));
    const available = Object.values(state.organizations).find((org) => {
      const controlled =
        org.leadership.leaderId === state.playerId ||
        org.shares.some((share) => share.characterId === state.playerId && share.share >= 0.2);
      return controlled && org.cash >= cost;
    });
    form.append(
      el(
        'p',
        'field__hint',
        `预计花费 ${fmtMoney(cost)}，由你控制的组织承担${
          available ? `（当前：${available.name}）` : '（没有现金足够的受控组织）'
        }`,
      ),
    );

    const submit = el('button', 'btn btn--gold', '执行游说');
    submit.type = 'button';
    submit.addEventListener('click', () => {
      const result: CommandResult = this.deps.dispatch({
        kind: 'lobby',
        countryId: this.lobbyCountryId,
        policy: this.lobbyPolicy,
        delta: this.lobbyDelta,
      });
      this.last = result.ok
        ? { ok: true, text: result.summary ?? '游说完成' }
        : { ok: false, text: result.error ?? '游说失败' };
      this.render();
    });
    form.append(submit);
    return form;
  }

  private stat(
    label: string,
    value: string,
    tone: 'neutral' | 'good' | 'bad' = 'neutral',
    hint?: string,
  ): HTMLElement {
    const cell = el('div', `stat stat--${tone}`);
    cell.append(el('span', 'stat__label', label), el('span', 'stat__value', value));
    if (hint) withHint(cell, hint);
    return cell;
  }
}
