/** 地区详情：人口、商路、四商品市场行情与本地组织。 */

import { marketKeyOf, type Region, type RegionId, type WorldState } from '../core/WorldState';
import type { UiDeps } from './context';
import { clear, el, fmtInt, fmtMoney, statCell } from './dom';
import { ORG_TYPE_LABELS, TERRAIN_LABELS, labelOf } from './labels';
import {
  OFFICE_MIN_SCORE,
  capitalOf,
  officeScore,
  officeSeatsFor,
} from '../systems/country/Offices';
import { purchaseFactor, saleFactor, tradeCarryCapacity } from '../systems/character/SkillEffects';

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
      statCell(
        '人口',
        fmtInt(region.population),
        'neutral',
        '人口决定本地需求与税基；每年结算时变化',
      ),
      statCell(
        '连接',
        `${region.links.length} 条商路`,
        'neutral',
        '可通商方向；每条商路有固定运力与在途日数',
      ),
      statCell(
        '组织',
        `${Object.values(state.organizations).filter((org) => org.homeRegionId === region.id).length} 家`,
        'neutral',
        '以本地区为总部的组织数量：影响就业与市场份额',
      ),
    );
    this.host.append(stats);

    // 此地的机会：把"为什么值得跑一趟"写成可算账的条目。
    const opportunities: string[] = [];
    const playerNow = state.characters[state.playerId];
    if (playerNow) {
      const here = region.id !== playerNow.regionId;
      if (here) {
        const link = state.regions[playerNow.regionId]?.links.find((item) => item.to === region.id);
        const days = link?.days ?? 4;
        const capacity = Math.min(tradeCarryCapacity(playerNow), 10);
        let best: { label: string; profit: number } | null = null;
        for (const good of content.goods) {
          const local = state.markets[marketKeyOf(region.id, good.id)];
          const home = state.markets[marketKeyOf(playerNow.regionId, good.id)];
          if (!local || !home) continue;
          const freight = Math.max(1, Math.round(days * capacity * 0.05));
          const unitProfit =
            Math.round(local.price * saleFactor(playerNow)) -
            Math.round(home.price * purchaseFactor(playerNow));
          const profit = unitProfit * capacity - freight;
          if (profit > 0 && (!best || profit > best.profit)) {
            best = {
              label: `贩 ${capacity} 单位${good.name}过来卖，扣运费约赚 ${profit} 铜`,
              profit,
            };
          }
        }
        if (best) opportunities.push(best.label);
      }

      const ownRegion = state.regions[playerNow.regionId];
      const ownCountry = ownRegion ? state.countries[ownRegion.countryId] : undefined;
      if (ownCountry && capitalOf(state, ownCountry.id) === region.id) {
        const seats = officeSeatsFor(ownCountry);
        const open = seats
          .map((seat) => ({
            seat,
            score: officeScore(state, playerNow.id, ownCountry.id, seat),
          }))
          .filter((item) => item.score >= OFFICE_MIN_SCORE)
          .sort((a, b) => b.score - a.score)[0];
        if (open) {
          opportunities.push(
            `王庭：可谋求${open.seat.title}（评分 ${Math.round(open.score * 100)} / 门槛 ${Math.round(OFFICE_MIN_SCORE * 100)}，月俸 ${open.seat.salaryMonthly}）`,
          );
        } else {
          opportunities.push(`王庭：可赴宴结交权贵（${ownCountry.name}首都）`);
        }
      }

      const headquarters = Object.values(state.organizations).filter(
        (org) => org.homeRegionId === region.id && org.lifecycle !== 'dissolved',
      );
      const controlled = headquarters.filter(
        (org) =>
          org.leadership.leaderId === playerNow.id ||
          org.shares.some((share) => share.characterId === playerNow.id && share.share >= 0.2),
      );
      if (controlled.length > 0) {
        opportunities.push(`${controlled[0]!.name}总部：可当面签约、买卖股份`);
      }
      if (headquarters.some((org) => org.type === 'bank')) {
        opportunities.push('此地有钱庄：可存取铜币');
      }
    }

    const chance = el('div', 'opportunities');
    chance.append(el('h3', 'section-title', '此地的机会'));
    if (opportunities.length === 0) {
      chance.append(
        el('p', 'opportunities__empty', '此地暂无与你有关的特别机会；可以看看行情再决定。'),
      );
    } else {
      const list = el('ul', 'opportunities__list');
      for (const item of opportunities.slice(0, 4)) list.append(el('li', '', item));
      chance.append(list);
    }
    this.host.append(chance);

    // 到场才能做的事：赴宴与考察都会花掉行动力，按钮上直接写明代价。
    if (playerNow?.alive) {
      const actions = el('div', 'opportunities__actions');
      const homeRegion = state.regions[playerNow.regionId];
      const homeCountry = homeRegion ? state.countries[homeRegion.countryId] : undefined;
      if (homeCountry && capitalOf(state, homeCountry.id) === region.id) {
        const attend = el('button', 'btn btn--gold', '赴宴（50 铜 · 1 行动力）');
        attend.type = 'button';
        attend.addEventListener('click', () => {
          const result = this.deps.dispatch({ kind: 'attend_court' });
          this.deps.notify(
            result.ok ? (result.summary ?? '赴宴') : (result.error ?? '无法赴宴'),
            result.ok ? 'ok' : 'error',
          );
          this.deps.refresh();
        });
        actions.append(attend);
      }
      if (playerNow.regionId === region.id) {
        const inspected = (state.inspections[region.id] ?? 0) > state.clock.day;
        const inspect = el(
          'button',
          'btn',
          inspected ? '已考察（30 天内有效）' : '考察市场（1 行动力）',
        );
        inspect.type = 'button';
        inspect.disabled = inspected;
        inspect.addEventListener('click', () => {
          const result = this.deps.dispatch({ kind: 'inspect_market', regionId: region.id });
          this.deps.notify(
            result.ok ? (result.summary ?? '考察完毕') : (result.error ?? '无法考察'),
            result.ok ? 'ok' : 'error',
          );
          this.deps.refresh();
        });
        actions.append(inspect);
      }
      if (actions.childElementCount > 0) this.host.append(actions);
    }

    // 前往：只有相邻商路可直达；显示天数、路费与消耗，让玩家在决定前知道代价。
    const player = state.characters[state.playerId];
    if (player) {
      const travel = el('div', 'travel');
      travel.append(el('h3', 'section-title', '前往'));
      if (!player.alive) {
        travel.append(el('p', 'travel__hint', '你已经不在了，这个身体到不了任何地方。'));
      } else if (region.id === player.regionId) {
        travel.append(el('p', 'travel__hint', '你正在此地。'));
      } else {
        const hop = state.regions[player.regionId]?.links.find((link) => link.to === region.id);
        if (!hop) {
          travel.append(el('p', 'travel__hint', '没有直达商路：先到相邻地区，再从这里转乘。'));
        } else {
          const fee = hop.days * 2;
          travel.append(
            el(
              'p',
              'travel__hint',
              `路程 ${hop.days} 天 · 路费 ${fmtMoney(fee)} · 消耗 1 行动力与 2 健康`,
            ),
          );
          if (opportunities.length > 0) {
            travel.append(el('p', 'travel__hint', `此行可办：${opportunities[0]}`));
          }
          const go = el('button', 'btn btn--gold', '前往');
          go.type = 'button';
          go.disabled = player.actionPoints <= 0 || player.health <= 5 || player.wealth < fee;
          go.addEventListener('click', () => {
            const result = this.deps.dispatch({ kind: 'move', regionId: region.id });
            this.deps.notify(
              result.ok ? (result.summary ?? '启程') : (result.error ?? '无法前往'),
              result.ok ? 'ok' : 'error',
            );
            if (result.ok && result.travelDays !== undefined) {
              this.deps.advanceDays(result.travelDays);
            }
            this.deps.refresh();
          });
          travel.append(go);
        }
      }
      this.host.append(travel);
    }

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
        el('td', `num price price--${tone}`, this.priceText(state, region, market.price)),
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

    this.host.append(
      el(
        'p',
        'panel__note',
        '价格以铜币计 · 数据来自最近一次月度结算 · 异地价格需要「考察」才看得真切（≈ 为估值）',
      ),
    );
  }

  /** 本地或已考察过的地区显示精确价，其余只给 5 的倍数的估价。 */
  private priceText(state: WorldState, region: Region, price: number): string {
    const player = state.characters[state.playerId];
    const inspected = (state.inspections[region.id] ?? 0) > state.clock.day;
    if (player?.regionId === region.id || inspected) return fmtMoney(price);
    return `≈${Math.round(price / 5) * 5}`;
  }
}
