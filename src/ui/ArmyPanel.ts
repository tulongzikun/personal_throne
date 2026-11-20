/** 军团面板：常备军状况、征兵、行军与宣战/议和。 */

import type { CommandResult } from '../core/CommandBus';
import type { CountryId, RegionId } from '../core/WorldState';
import { isAtWar } from '../systems/military/WarSystem';
import type { UiDeps } from './context';
import { clear, el, fmtInt, fmtMoney, fmtPct, statCell } from './dom';

const STANCE_LABELS: Record<string, string> = {
  garrison: '驻防',
  march: '行军',
  battle: '交战',
  siege: '围城',
};

export class ArmyPanel {
  private readonly host: HTMLElement;
  private readonly deps: UiDeps;
  private last: { readonly ok: boolean; readonly text: string } | null = null;
  private levyUnits = 100;

  constructor(host: HTMLElement, deps: UiDeps) {
    this.host = host;
    this.deps = deps;
    this.render();
  }

  update(): void {
    this.render();
  }

  private render(): void {
    const state = this.deps.state();
    const content = this.deps.content();
    clear(this.host);

    const player = state.characters[state.playerId];
    const country = player ? countryOf(state, player.homeRegionId) : undefined;
    if (!country) {
      this.host.append(el('p', 'empty', '你还没有归属的国家，无法指挥军团。'));
      return;
    }

    const army = state.armies[`army:${country.id}`];
    const header = el('div', 'panel__head');
    header.append(
      el('h2', 'panel__title', `${country.name} · 军团`),
      el('p', 'panel__sub', '征兵、行军、宣战与议和都在这里。'),
    );
    this.host.append(header);

    if (!army) {
      this.host.append(el('p', 'empty', '这个国家还没有军队建制。'));
      return;
    }

    const location = state.regions[army.locationRegionId];
    const scale = el('div', 'stat-grid');
    scale.append(
      statCell('兵力', `${fmtInt(army.size)} 人`, 'neutral', '常备军与征召兵合计'),
      statCell('训练', fmtPct(army.training), 'neutral', '影响会战强度'),
      statCell('士气', fmtPct(army.morale), 'neutral', '长期作战会下降'),
      statCell(
        '位置',
        location?.name ?? '—',
        'neutral',
        army.stance === 'march' && army.targetRegionId
          ? `正在开往 ${state.regions[army.targetRegionId]?.name ?? '未知地区'}`
          : (STANCE_LABELS[army.stance] ?? army.stance),
      ),
    );
    this.host.append(scale);

    const commander = army.commanderId ? state.characters[army.commanderId] : null;
    this.host.append(
      el(
        'p',
        'panel__note',
        `${STANCE_LABELS[army.stance] ?? army.stance} · 统帅 ${commander?.name ?? '空缺（按 0 战术结算）'} · 月维持 ${fmtMoney(
          Math.round(army.size * content.balance.war.upkeepPerSoldier),
        )}`,
      ),
    );

    this.host.append(this.buildLevy(army.size));
    this.host.append(this.buildMarch(army.locationRegionId));
    this.host.append(this.buildDiplomacy(country.id));

    if (this.last) {
      this.host.append(el('p', `result result--${this.last.ok ? 'ok' : 'error'}`, this.last.text));
    }
  }

  private buildLevy(currentSize: number): HTMLElement {
    const content = this.deps.content();
    const form = el('form', 'inline-form');
    form.append(el('h3', 'section-title', '征兵'));

    const input = el('input', 'field__input');
    input.type = 'number';
    input.min = '1';
    input.step = '10';
    input.value = String(this.levyUnits);
    input.setAttribute('aria-label', '征兵人数');
    input.addEventListener('change', () => {
      const parsed = Number(input.value);
      this.levyUnits = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 100;
    });

    const cost = this.levyUnits * content.balance.war.levyCostPerSoldier;
    form.append(
      input,
      el(
        'p',
        'field__hint',
        `每人 ${content.balance.war.levyCostPerSoldier} 铜，${fmtInt(this.levyUnits)} 人约 ${fmtMoney(cost)}；单次不超过人口 2%。当前 ${fmtInt(currentSize)} 人。`,
      ),
    );

    const submit = el('button', 'btn btn--gold', '征召');
    submit.type = 'button';
    submit.addEventListener('click', () => {
      this.run({ kind: 'levy_army', units: this.levyUnits });
    });
    form.append(submit);
    return form;
  }

  private buildMarch(fromRegionId: RegionId): HTMLElement {
    const state = this.deps.state();
    const from = state.regions[fromRegionId];
    const form = el('div', 'panel__section');
    form.append(el('h3', 'section-title', '行军'));
    if (!from) return form;

    const row = el('div', 'btn-row');
    for (const link of from.links) {
      const region = state.regions[link.to];
      if (!region) continue;
      const button = el('button', 'btn btn--ghost', `开往 ${region.name}`);
      button.type = 'button';
      button.addEventListener('click', () => {
        this.run({ kind: 'march_army', regionId: region.id });
      });
      row.append(button);
    }
    if (row.childElementCount === 0) {
      form.append(el('p', 'empty', '这里没有可走的商路，军队无法移动。'));
    } else {
      form.append(row, el('p', 'field__hint', '行军只走相邻地区，抵达后自动转入驻防。'));
    }
    return form;
  }

  private buildDiplomacy(ownId: CountryId): HTMLElement {
    const state = this.deps.state();
    const box = el('div', 'panel__section');
    box.append(el('h3', 'section-title', '邦交'));

    const list = el('ul', 'plain-list');
    for (const country of Object.values(state.countries).sort((a, b) => a.id.localeCompare(b.id))) {
      if (country.id === ownId) continue;
      const war = isAtWar(state, ownId, country.id);
      const item = el('li');
      item.append(
        el('span', 'plain-list__term', country.name),
        el(
          'span',
          'plain-list__value',
          war
            ? '交战中'
            : `友好度 ${Math.round(state.countries[ownId]?.diplomacy[country.id] ?? 0)}`,
        ),
      );
      list.append(item);
    }
    box.append(list);

    const row = el('div', 'btn-row');
    for (const country of Object.values(state.countries).sort((a, b) => a.id.localeCompare(b.id))) {
      if (country.id === ownId) continue;
      const war = isAtWar(state, ownId, country.id);
      const button = el(
        'button',
        war ? 'btn btn--gold' : 'btn btn--ghost',
        war ? `与 ${country.name} 议和` : `向 ${country.name} 宣战`,
      );
      button.type = 'button';
      button.addEventListener('click', () => {
        this.run(
          war
            ? { kind: 'offer_peace', targetCountryId: country.id }
            : { kind: 'declare_war', targetCountryId: country.id },
        );
      });
      row.append(button);
    }
    box.append(row, el('p', 'field__hint', '宣战与议和需要统治权，或影响力 ≥ 0.4 的公职。'));
    return box;
  }

  private run(command: Parameters<UiDeps['dispatch']>[0]): void {
    const result: CommandResult = this.deps.dispatch(command);
    this.last = result.ok
      ? { ok: true, text: result.summary ?? '命令已执行' }
      : { ok: false, text: result.error ?? '命令失败' };
    this.deps.refresh();
  }
}

function countryOf(state: ReturnType<UiDeps['state']>, regionId: RegionId) {
  const region = state.regions[regionId];
  return region ? state.countries[region.countryId] : undefined;
}
