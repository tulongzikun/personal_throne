/** 组织面板：10 家组织的财务与治理视图，以及玩家可执行的经营命令。 */

import type { Command } from '../core/CommandBus';
import { DAYS_PER_YEAR } from '../core/GameClock';
import type { Organization, OrgStrategy } from '../core/WorldState';
import type { UiDeps } from './context';
import { clear, el, fmtInt, fmtMoney, fmtPct, statCell } from './dom';
import { ORG_LIFECYCLE_LABELS, ORG_STRATEGY_LABELS, ORG_TYPE_LABELS, labelOf } from './labels';
import { valuation } from '../systems/organization/Organization';
import { canClaimLeadership, unassignedShare } from '../systems/organization/Shares';

const STRATEGIES: readonly OrgStrategy[] = ['expand', 'steady', 'contract', 'pivot'];

interface LastResult {
  readonly ok: boolean;
  readonly text: string;
}

export class OrganizationPanel {
  private readonly host: HTMLElement;
  private readonly deps: UiDeps;
  private selectedId: string | null;
  private last: LastResult | null = null;
  private dirty = false;
  private readonly draft = {
    amount: '200',
    count: '5',
    regionId: '',
    goodId: 'grain',
    strategy: 'steady' as OrgStrategy,
  };

  constructor(host: HTMLElement, deps: UiDeps) {
    this.host = host;
    this.deps = deps;
    const state = deps.state();
    this.selectedId = state.characters[state.playerId]?.organizationId ?? null;
    const initial = this.currentOrg();
    if (initial) this.syncDraft(initial);
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

  select(orgId: string): void {
    const org = this.deps.state().organizations[orgId];
    if (!org) return;
    this.selectedId = orgId;
    this.last = null;
    this.syncDraft(org);
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

  private currentOrg(): Organization | undefined {
    return this.selectedId ? this.deps.state().organizations[this.selectedId] : undefined;
  }

  private syncDraft(org: Organization): void {
    this.draft.regionId = org.homeRegionId;
    this.draft.strategy = org.strategy;
    this.draft.goodId = org.industry === 'service' ? 'luxury' : org.industry;
  }

  private isControlled(org: Organization): boolean {
    const state = this.deps.state();
    if (org.leadership.leaderId === state.playerId) return true;
    return org.shares.some((share) => share.characterId === state.playerId && share.share >= 0.2);
  }

  private render(): void {
    const state = this.deps.state();
    clear(this.host);

    const orgs = Object.values(state.organizations).sort((a, b) => {
      const controlDelta = Number(this.isControlled(b)) - Number(this.isControlled(a));
      if (controlDelta !== 0) return controlDelta;
      return b.cash + b.assets - (a.cash + a.assets);
    });

    this.host.append(el('h3', 'section-title section-title--first', '组织名录'));
    const chips = el('div', 'chip-row');
    for (const org of orgs) {
      const chip = el('button', 'chip');
      chip.type = 'button';
      chip.dataset.orgId = org.id;
      chip.append(el('span', 'chip__name', org.name));
      if (this.isControlled(org)) chip.append(el('span', 'chip__badge', '控'));
      if (org.id === this.selectedId) chip.classList.add('is-active');
      chip.addEventListener('click', () => this.select(org.id));
      chips.append(chip);
    }
    this.host.append(chips);

    const org = this.currentOrg();
    if (!org) {
      this.host.append(el('p', 'empty', '此世界还没有组织。'));
      return;
    }

    const controlled = this.isControlled(org);
    const head = el('div', 'detail-head');
    const title = el('div');
    title.append(
      el('h2', 'detail-head__title', org.name),
      el(
        'p',
        'detail-head__meta',
        `${labelOf(ORG_TYPE_LABELS, org.type)} · ${this.industryName(org)} · ${state.regions[org.homeRegionId]?.name ?? '—'}`,
      ),
    );
    head.append(
      title,
      el('span', `badge ${controlled ? 'badge--gold' : ''}`, controlled ? '你可指挥' : '仅可查看'),
    );
    this.host.append(head);

    const stats = el('div', 'stat-grid stat-grid--four');
    stats.append(
      statCell(
        '现金',
        fmtMoney(org.cash),
        'neutral',
        '可立即动用的铜币：发薪、采购与运费都从这里扣',
      ),
      statCell(
        '资产',
        fmtMoney(org.assets),
        'neutral',
        '库存、商队与固定资产的账面价值，不直接等于现金',
      ),
      statCell(
        '负债',
        fmtMoney(org.liabilities),
        'neutral',
        '未偿债务与拖欠工资；过高会推高破产风险',
      ),
      statCell(
        '成员',
        `${fmtInt(org.members)} 人`,
        'neutral',
        '在册雇员：规模影响产出、工资支出与市场份额',
      ),
      statCell(
        '士气 · 效率',
        fmtPct(org.efficiency),
        'neutral',
        '效率 = 实际产出 / 理论产能；受士气、治理与冲突影响',
      ),
      statCell(
        '冲突',
        fmtPct(org.conflict),
        org.conflict >= 0.5 ? 'bad' : 'neutral',
        '内部派系对立程度；超过 50% 容易分裂或逼宫',
      ),
      statCell(
        '合法性',
        fmtPct(org.leadership.legitimacy),
        'neutral',
        '领袖被成员承认的程度；过低会被挑战',
      ),
      statCell('治理', fmtPct(org.governance), 'neutral', '制度执行力：影响效率上限与腐败概率'),
    );
    this.host.append(stats);

    const profit = org.lastMonthRevenue - org.lastMonthCost - org.lastMonthTransport;
    const finance = el('div', 'finance-row');
    finance.append(
      this.financeCell('上月收入', fmtMoney(org.lastMonthRevenue)),
      this.financeCell('上月成本', fmtMoney(org.lastMonthCost)),
      this.financeCell('上月利润', fmtMoney(profit), profit >= 0 ? 'good' : 'bad'),
      this.financeCell(
        '战略 / 阶段',
        `${labelOf(ORG_STRATEGY_LABELS, org.strategy)} · ${labelOf(ORG_LIFECYCLE_LABELS, org.lifecycle)}`,
      ),
    );
    this.host.append(finance);

    const detail = el('p', 'panel__note');
    detail.textContent = `领袖 ${state.characters[org.leadership.leaderId]?.name ?? '—'} · 成立于 ${formatFounded(org)} · 现金储备 ${fmtMoney(org.cash)}`;
    this.host.append(detail);

    this.host.append(el('h3', 'section-title', '股权'));
    const shares = el('ul', 'row-list row-list--compact');
    for (const share of [...org.shares].sort((a, b) => b.share - a.share)) {
      const row = el('li', 'row-list__item');
      const open = el('button', 'row-list__button');
      open.type = 'button';
      open.dataset.characterId = share.characterId;
      open.append(
        el(
          'span',
          'row-list__name',
          state.characters[share.characterId]?.name ?? share.characterId,
        ),
        el('span', 'row-list__meta', `${fmtPct(share.share)} 股份`),
      );
      if (share.characterId === state.playerId) open.append(el('span', 'badge badge--gold', '你'));
      open.addEventListener('click', () => this.deps.openCharacter(share.characterId));
      row.append(open);
      shares.append(row);
    }
    if (org.shares.length === 0) shares.append(el('li', 'empty', '没有登记股东'));
    const free = unassignedShare(org);
    if (free > 0.0005) {
      const row = el('li', 'row-list__item');
      row.append(
        el('span', 'row-list__name', '未登记份额'),
        el('span', 'row-list__meta', fmtPct(free)),
      );
      shares.append(row);
    }
    this.host.append(shares);
    this.host.append(this.buildShareActions(org));

    this.host.append(el('h3', 'section-title', '经营指令'));
    if (controlled) {
      this.host.append(this.buildActions(org));
    } else {
      this.host.append(
        el(
          'p',
          'panel__hint',
          `你无法指挥该组织。需要成为领袖，或持有至少 20% 股份。现任领袖：${
            state.characters[org.leadership.leaderId]?.name ?? '—'
          }。`,
        ),
      );
    }

    if (this.last) {
      const result = el('p', `result result--${this.last.ok ? 'ok' : 'error'}`, this.last.text);
      result.setAttribute('role', 'status');
      this.host.append(result);
    }
  }

  private buildShareActions(org: Organization): HTMLElement {
    const state = this.deps.state();
    const wrap = el('div', 'action-group');
    const owned = org.shares.find((entry) => entry.characterId === state.playerId)?.share ?? 0;
    const price = valuation(org);
    const buttons = el('div', 'btn-row');
    buttons.append(
      this.commandButton('买入 5%', 'ghost', () =>
        this.exec({ kind: 'buy_shares', orgId: org.id, share: 0.05 }),
      ),
    );
    if (owned >= 0.05) {
      buttons.append(
        this.commandButton('卖出 5%', 'ghost', () =>
          this.exec({ kind: 'sell_shares', orgId: org.id, share: 0.05 }),
        ),
      );
    }
    const claim = canClaimLeadership(org, state.playerId);
    if (claim.ok) {
      buttons.append(
        this.commandButton('接管字号', 'gold', () =>
          this.exec({ kind: 'claim_leadership', orgId: org.id }),
        ),
      );
    }
    wrap.append(
      buttons,
      el(
        'p',
        'field__hint',
        `估值约 ${fmtMoney(price)} 铜币 · 5% ≈ ${fmtMoney(Math.round(price * 0.05))} · ${
          claim.ok ? '你已超过现任领袖，可接管字号' : claim.reason
        }`,
      ),
    );
    return wrap;
  }

  private buildActions(org: Organization): HTMLElement {
    const state = this.deps.state();
    const content = this.deps.content();
    const wrap = el('div', 'action-stack');

    const amountGroup = el('div', 'action-group');
    const amountInput = el('input', 'input');
    amountInput.type = 'text';
    amountInput.inputMode = 'numeric';
    amountInput.value = this.draft.amount;
    amountInput.setAttribute('aria-label', '金额（铜币）');
    amountInput.addEventListener('input', () => {
      this.draft.amount = amountInput.value;
    });
    const amountField = el('label', 'field');
    amountField.append(el('span', 'field__label', '金额（铜币）'), amountInput);
    const amountButtons = el('div', 'btn-row');
    amountButtons.append(
      this.commandButton('投资', 'gold', () => this.runAmount('invest', org.id, org)),
      this.commandButton('借款', 'ghost', () => this.runAmount('take_loan', org.id, org)),
      this.commandButton('还款', 'ghost', () => this.runAmount('repay_debt', org.id, org)),
      this.commandButton('购置资产', 'ghost', () => this.runAmount('buy_asset', org.id, org)),
    );
    amountGroup.append(
      amountField,
      amountButtons,
      el(
        'p',
        'field__hint',
        `授信额度 ${fmtMoney(Math.max(0, Math.round(org.assets * 0.5) - org.liabilities))} · 还款最多 ${fmtMoney(Math.min(org.liabilities, org.cash))}`,
      ),
    );
    wrap.append(amountGroup);

    const perHead = Math.max(1, Math.round(org.payrollMonthly / Math.max(1, org.members)));
    const recruitGroup = el('div', 'action-group');
    const countInput = el('input', 'input');
    countInput.type = 'text';
    countInput.inputMode = 'numeric';
    countInput.value = this.draft.count;
    countInput.setAttribute('aria-label', '招募人数');
    countInput.addEventListener('input', () => {
      this.draft.count = countInput.value;
    });
    const countField = el('label', 'field');
    countField.append(el('span', 'field__label', '招募人数'), countInput);
    const recruitButton = this.commandButton('招募', 'ghost', () => this.runRecruit(org.id));
    recruitGroup.append(
      countField,
      recruitButton,
      el('p', 'field__hint', `每人月薪约 ${fmtMoney(perHead)}，一次性招募成本同额`),
    );
    wrap.append(recruitGroup);

    const routeGroup = el('div', 'action-group');
    const regionSelect = el('select', 'input');
    regionSelect.setAttribute('aria-label', '商路目标地区');
    for (const region of Object.values(state.regions).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const option = el('option', undefined, `${region.name}（${region.links.length} 条商路）`);
      option.value = region.id;
      regionSelect.append(option);
    }
    regionSelect.value = this.draft.regionId;
    regionSelect.addEventListener('change', () => {
      this.draft.regionId = regionSelect.value;
    });
    const goodSelect = el('select', 'input');
    goodSelect.setAttribute('aria-label', '商路商品');
    for (const good of content.goods) {
      const option = el('option', undefined, good.name);
      option.value = good.id;
      goodSelect.append(option);
    }
    goodSelect.value = this.draft.goodId;
    goodSelect.addEventListener('change', () => {
      this.draft.goodId = goodSelect.value;
    });
    const routeRow = el('div', 'form-row');
    const routeRegionField = el('label', 'field field--grow');
    routeRegionField.append(el('span', 'field__label', '目标地区'), regionSelect);
    const routeGoodField = el('label', 'field');
    routeGoodField.append(el('span', 'field__label', '商品'), goodSelect);
    routeRow.append(routeRegionField, routeGoodField);
    routeGroup.append(
      routeRow,
      this.commandButton('开辟商路', 'ghost', () => {
        this.exec({
          kind: 'open_route',
          orgId: org.id,
          regionId: this.draft.regionId,
          goodId: this.draft.goodId,
        });
      }),
      el(
        'p',
        'field__hint',
        `预计花费 ${fmtMoney(Math.max(50, Math.round(org.payrollMonthly * 0.2)))}`,
      ),
    );
    wrap.append(routeGroup);

    const strategyGroup = el('div', 'action-group');
    const strategySelect = el('select', 'input');
    strategySelect.setAttribute('aria-label', '组织战略');
    for (const strategy of STRATEGIES) {
      const option = el('option', undefined, labelOf(ORG_STRATEGY_LABELS, strategy));
      option.value = strategy;
      strategySelect.append(option);
    }
    strategySelect.value = this.draft.strategy;
    strategySelect.addEventListener('change', () => {
      this.draft.strategy = strategySelect.value as OrgStrategy;
    });
    const strategyRow = el('div', 'form-row');
    const strategyField = el('label', 'field field--grow');
    strategyField.append(el('span', 'field__label', '新战略'), strategySelect);
    strategyRow.append(strategyField);
    strategyGroup.append(
      strategyRow,
      this.commandButton('设定战略', 'ghost', () => {
        this.exec({ kind: 'set_strategy', orgId: org.id, strategy: this.draft.strategy });
      }),
    );
    wrap.append(strategyGroup);

    return wrap;
  }

  private runAmount(
    kind: 'invest' | 'take_loan' | 'repay_debt' | 'buy_asset',
    orgId: string,
    org: Organization,
  ): void {
    const amount = Number(this.draft.amount.replace(/[,，\s]/g, ''));
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      this.fail('请输入正整数金额（铜币）');
      return;
    }
    if (kind === 'invest' && amount > org.cash) {
      this.fail(`现金不足：需要 ${fmtMoney(amount)}，现有 ${fmtMoney(org.cash)}`);
      return;
    }
    this.exec({ kind, orgId, amount });
  }

  private runRecruit(orgId: string): void {
    const count = Number.parseInt(this.draft.count, 10);
    if (!Number.isInteger(count) || count <= 0) {
      this.fail('招募人数必须是正整数');
      return;
    }
    this.exec({ kind: 'recruit', orgId, count });
  }

  private commandButton(
    label: string,
    variant: 'ghost' | 'gold',
    run: () => void,
  ): HTMLButtonElement {
    const node = el('button', `btn btn--${variant}`, label);
    node.type = 'button';
    node.addEventListener('click', run);
    return node;
  }

  private exec(command: Command): void {
    const result = this.deps.dispatch(command);
    this.last = result.ok
      ? { ok: true, text: result.summary ?? '命令执行成功' }
      : { ok: false, text: result.error ?? '命令失败' };
    this.render();
  }

  private fail(text: string): void {
    this.last = { ok: false, text };
    this.render();
  }

  private industryName(org: Organization): string {
    if (org.industry === 'service') return '服务业';
    return this.deps.content().goods.find((good) => good.id === org.industry)?.name ?? org.industry;
  }

  private financeCell(
    label: string,
    value: string,
    tone: 'neutral' | 'good' | 'bad' = 'neutral',
  ): HTMLElement {
    const cell = el('div', `finance-cell finance-cell--${tone}`);
    cell.append(el('span', 'finance-cell__label', label), el('span', 'finance-cell__value', value));
    return cell;
  }
}

function formatFounded(org: Organization): string {
  const year = Math.floor((org.foundedDay - 1) / DAYS_PER_YEAR) + 1;
  return `第 ${year} 年`;
}
