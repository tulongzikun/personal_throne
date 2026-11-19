/** 地区详情：人口、商路、四商品市场行情与本地组织。 */

import { marketKeyOf, type RegionId } from '../core/WorldState';
import type { UiDeps } from './context';
import { clear, el, fmtInt, fmtMoney, statCell } from './dom';
import { ORG_TYPE_LABELS, TERRAIN_LABELS, labelOf } from './labels';

export class RegionPanel {
  private readonly host: HTMLElement;
  private readonly deps: UiDeps;
  private selectedId: RegionId | null;

  constructor(host: HTMLElement, deps: UiDeps) {
    this.host = host;
    this.deps = deps;
    const initial = deps.state();
    this.selectedId = initial.characters[initial.playerId]?.regionId ?? null;
    this.render();
  }

  show(regionId: RegionId): void {
    this.selectedId = regionId;
    this.render();
  }

  update(): void {
    this.render();
  }

  private render(): void {
    const state = this.deps.state();
    const content = this.deps.content();
    clear(this.host);

    const region = this.selectedId ? state.regions[this.selectedId] : undefined;
    if (!region) {
      this.host.append(el('p', 'empty', '点击左侧地图上的地区，查看市场与势力。'));
      return;
    }

    const country = state.countries[region.countryId];

    const head = el('div', 'detail-head');
    const title = el('div');
    title.append(
      el('h2', 'detail-head__title', region.name),
      el(
        'p',
        'detail-head__meta',
        `${country?.name ?? '未知政体'} · ${TERRAIN_LABELS[region.terrain]} · 人口 ${fmtInt(region.population)}`,
      ),
    );
    head.append(title);
    this.host.append(head);

    const stats = el('div', 'stat-grid');
    stats.append(
      statCell('人口', fmtInt(region.population)),
      statCell('连接', `${region.links.length} 条商路`),
      statCell(
        '组织',
        `${Object.values(state.organizations).filter((org) => org.homeRegionId === region.id).length} 家`,
      ),
    );
    this.host.append(stats);

    this.host.append(el('h3', 'section-title', '市场行情'));
    const table = el('table', 'table');
    const thead = el('thead');
    const headRow = el('tr');
    for (const label of ['商品', '价格', '库存', '月需求', '产量', '状态']) {
      headRow.append(el('th', label === '商品' ? '' : 'num', label));
    }
    thead.append(headRow);
    const tbody = el('tbody');
    for (const good of content.goods) {
      const market = state.markets[marketKeyOf(region.id, good.id)];
      if (!market) continue;
      const ratio = market.price / Math.max(1, good.basePrice);
      const status = ratio >= 1.25 ? '紧缺' : ratio <= 0.8 ? '过剩' : '平稳';
      const tone = ratio >= 1.25 ? 'bad' : ratio <= 0.8 ? 'good' : 'neutral';
      const row = el('tr');
      row.append(
        el('td', '', good.name),
        el('td', `num price price--${tone}`, fmtMoney(market.price)),
        el('td', 'num', fmtInt(market.stock)),
        el('td', 'num', fmtInt(market.demand)),
        el('td', 'num', fmtInt(market.production)),
        el('td', `num status status--${tone}`, status),
      );
      tbody.append(row);
    }
    table.append(thead, tbody);
    this.host.append(table);

    this.host.append(el('h3', 'section-title', '商路'));
    const links = el('ul', 'link-list');
    for (const link of region.links) {
      const target = state.regions[link.to];
      const item = el('li', 'link-list__item');
      item.append(
        el('span', 'link-list__name', target?.name ?? link.to),
        el('span', 'link-list__meta', `${link.days} 日 · 运力 ${fmtInt(link.capacity)}`),
      );
      links.append(item);
    }
    if (region.links.length === 0) links.append(el('li', 'empty', '无对外商路'));
    this.host.append(links);

    this.host.append(el('h3', 'section-title', '本地组织'));
    const orgs = Object.values(state.organizations)
      .filter((org) => org.homeRegionId === region.id)
      .sort((a, b) => b.cash + b.assets - (a.cash + a.assets));
    const orgList = el('ul', 'row-list');
    for (const org of orgs) {
      const controlled =
        org.leadership.leaderId === state.playerId ||
        org.shares.some((share) => share.characterId === state.playerId && share.share >= 0.2);
      const row = el('li', 'row-list__item');
      const open = el('button', 'row-list__button');
      open.type = 'button';
      open.dataset.orgId = org.id;
      open.append(
        el('span', 'row-list__name', org.name),
        el('span', 'row-list__meta', labelOf(ORG_TYPE_LABELS, org.type)),
        el('span', 'row-list__value', fmtMoney(org.cash + org.assets)),
      );
      if (controlled) open.append(el('span', 'badge badge--gold', '受控'));
      open.addEventListener('click', () => this.deps.openOrganization(org.id));
      row.append(open);
      orgList.append(row);
    }
    if (orgs.length === 0) orgList.append(el('li', 'empty', '此地区没有组织总部'));
    this.host.append(orgList);

    this.host.append(el('p', 'panel__note', '价格以铜币计 · 数据来自最近一次月度结算'));
  }
}
