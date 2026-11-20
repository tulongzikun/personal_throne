/**
 * 玩家常驻卡：固定在界面左侧，和 NPC 面板物理分开。
 *
 * 只读 `UiDeps`，不持有引擎；读档后由一个 `update()` 全量重绘即可。
 */

import type { Command } from '../core/CommandBus';
import type { Organization } from '../core/WorldState';
import { neighborsOf } from '../systems/character/Activity';
import type { UiDeps } from './context';
import { button, clear, el, fmtMoney, fmtPct } from './dom';
import { alignmentLabel } from '../systems/character/Profile';
import { CAREER_CLASSES, careerTitle, canSwitchCareer } from '../systems/character/Career';
import { CLASS_LABELS, RACE_LABELS, SKILL_LABELS, SEX_LABELS, labelOf } from './labels';

export class PlayerPanel {
  private readonly host: HTMLElement;
  private readonly deps: UiDeps;

  constructor(host: HTMLElement, deps: UiDeps) {
    this.host = host;
    this.deps = deps;
    this.render();
  }

  update(): void {
    this.render();
  }

  private render(): void {
    const deps = this.deps;
    const state = deps.state();
    const player = state.characters[state.playerId];
    clear(this.host);
    this.host.dataset.playerId = state.playerId;

    if (!player) {
      this.host.append(el('p', 'empty', '玩家数据缺失。'));
      return;
    }

    const head = el('div', 'player-card__head');
    const title = el('div', 'player-card__title');
    title.append(el('span', 'badge badge--gold', '你'), el('h2', 'player-card__name', player.name));
    head.append(
      title,
      el(
        'p',
        'player-card__meta',
        `${labelOf(RACE_LABELS, player.raceId)} · ${labelOf(CLASS_LABELS, player.classId)} · ${labelOf(SEX_LABELS, player.sex)} · ${player.age} 岁 · ${alignmentLabel(player.alignment)}`,
      ),
    );
    this.host.append(head);

    const org = player.organizationId ? state.organizations[player.organizationId] : undefined;
    const region = state.regions[player.regionId];
    const country = region ? state.countries[region.countryId] : undefined;

    const rows = el('dl', 'player-card__rows');
    rows.append(this.row('现金', fmtMoney(player.wealth)));
    rows.append(this.row('所在', region?.name ?? '—'));
    rows.append(
      this.row(
        '信仰',
        player.faith === null
          ? '无'
          : (deps.content().faiths?.find((faith) => faith.id === player.faith)?.name ?? '未知'),
      ),
    );
    rows.append(
      this.row(
        '生涯',
        `${careerTitle(player.classId, player.careerRank)}（${player.careerRank}/3）`,
      ),
    );
    if (country) rows.append(this.row('归属', country.name));
    if (org) {
      rows.append(this.row('组织', org.name));
      rows.append(this.row('职位', this.roleOf(org, state.playerId)));
      rows.append(this.row('持股', fmtPct(this.shareOf(org, state.playerId))));
    }
    this.host.append(rows);

    rows.append(this.row('行动力', `${player.actionPoints} / 3`));
    rows.append(this.row('健康', `${Math.round(player.health)} / 100`));

    // 训练：花铜币把主技能练到天赋上限，是玩家开局最直接的自我提升。
    const skills = Object.entries(player.skills)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    if (skills.length > 0) {
      const train = el('div', 'player-card__train');
      train.append(el('p', 'player-card__train-title', '花铜币训练（每次 +1，受天赋上限）'));
      for (const [skill, level] of skills) {
        const cost = 150 + level * 120;
        const action = button(
          `${labelOf(SKILL_LABELS, skill)} Lv.${level} · ${cost}`,
          () => {
            const result = deps.dispatch({ kind: 'train', skill });
            deps.notify(
              result.ok ? (result.summary ?? '训练完成') : (result.error ?? '训练失败'),
              result.ok ? 'ok' : 'error',
            );
            deps.refresh();
          },
          'small',
        );
        action.disabled = player.wealth < cost;
        train.append(action);
      }
      this.host.append(train);
    }

    // 个人动词：移动 / 贩货 / 休息 / 存取。每项消耗 1 点行动力（移动 1 点 + 2 健康）。
    const quick = el('div', 'player-card__train');
    quick.append(el('p', 'player-card__train-title', '个人行动（各耗 1 行动力）'));
    quick.append(this.act('休息', { kind: 'rest' }, player.health >= 100));
    quick.append(this.act('贩货 5 单位', { kind: 'trade_goods', goodId: 'grain', units: 5 }));
    quick.append(this.act('存 100', { kind: 'deposit', amount: 100 }, player.wealth < 100));
    quick.append(
      this.act(
        '取 100',
        { kind: 'withdraw', amount: 100 },
        Object.values(player.deposits).reduce((sum, value) => sum + value, 0) < 100,
      ),
    );
    for (const link of neighborsOf(state, player.regionId).slice(0, 3)) {
      const name = state.regions[link.id]?.name ?? link.id;
      quick.append(this.act(`去${name}`, { kind: 'move', regionId: link.id }));
    }
    this.host.append(quick);

    const skillEntries = Object.entries(player.skills)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    if (skillEntries.length > 0) {
      const chips = el('div', 'player-card__chips');
      for (const [name, value] of skillEntries) {
        chips.append(el('span', 'chip', `${labelOf(SKILL_LABELS, name)} ${value}`));
      }
      this.host.append(chips);
    }

    const actions = el('div', 'player-card__actions');
    const detail = el('button', 'btn btn--small', '完整人物');
    detail.type = 'button';
    detail.addEventListener('click', () => deps.openCharacter(player.id));
    actions.append(detail);
    if (org) {
      const orgButton = el('button', 'btn btn--small', '我的组织');
      orgButton.type = 'button';
      orgButton.addEventListener('click', () => deps.openOrganization(org.id));
      actions.append(orgButton);
    }
    const alternatives = CAREER_CLASSES.filter((classId) => classId !== player.classId);
    const switchable = alternatives.filter(
      (classId) => canSwitchCareer(state, player.id, classId) === null,
    );
    if (switchable.length > 0) {
      for (const classId of switchable) {
        const node = el('button', 'btn btn--small', `转行${labelOf(CLASS_LABELS, classId)}`);
        node.type = 'button';
        node.addEventListener('click', () => {
          const result = deps.dispatch({
            kind: 'change_career',
            characterId: player.id,
            classId: classId as 'merchant' | 'mercenary' | 'politician',
          });
          if (!result.ok) deps.notify(result.error ?? '转行失败', 'error');
          else deps.notify(result.summary ?? '已转行', 'ok');
          deps.refresh();
        });
        actions.append(node);
      }
    }
    this.host.append(actions);
  }

  private act(label: string, command: Command, disabled = false): HTMLButtonElement {
    const element = button(
      label,
      () => {
        const result = this.deps.dispatch(command);
        this.deps.notify(
          result.ok ? (result.summary ?? '完成') : (result.error ?? '无法执行'),
          result.ok ? 'ok' : 'error',
        );
        if (result.ok && result.travelDays !== undefined) {
          this.deps.advanceDays(result.travelDays);
        }
        this.deps.refresh();
      },
      'small',
    );
    element.disabled = disabled;
    return element;
  }

  private row(label: string, value: string): HTMLElement {
    const wrapper = el('div', 'player-card__row');
    wrapper.append(el('dt', 'player-card__label', label), el('dd', 'player-card__value', value));
    return wrapper;
  }

  private shareOf(org: Organization, characterId: string): number {
    const entry = org.shares.find((item) => item.characterId === characterId);
    return entry ? entry.share : 0;
  }

  private roleOf(org: Organization, characterId: string): string {
    if (org.leadership.leaderId === characterId) return '领袖';
    if (this.shareOf(org, characterId) > 0) return '股东';
    return org.members > 0 ? '成员' : '—';
  }
}
