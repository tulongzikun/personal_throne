/**
 * 玩家常驻卡：固定在界面左侧，和 NPC 面板物理分开。
 *
 * 只读 `UiDeps`，不持有引擎；读档后由一个 `update()` 全量重绘即可。
 */

import type { Command } from '../core/CommandBus';
import type { Organization } from '../core/WorldState';
import type { UiDeps } from './context';
import { renderCharacterCard } from './CharacterCard';
import { button, clear, el, fmtMoney, fmtPct } from './dom';
import { alignmentLabel } from '../systems/character/Profile';
import {
  CAREER_CLASSES,
  careerLadder,
  careerTitle,
  canSwitchCareer,
  nextCareerStep,
} from '../systems/character/Career';
import {
  careerSalary,
  skillEffectSummary,
  tradeCarryCapacity,
} from '../systems/character/SkillEffects';
import { monthlyUpkeep } from '../systems/character/Upkeep';
import { ambitionOf, chapterOf } from '../systems/goals/Ambition';
import { bestTradeRoute } from '../systems/goals/Goals';
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
        `${careerTitle(player.classId, player.careerRank)}（${player.careerRank}/3）· 月俸 ${careerSalary(player.careerRank)} 铜`,
      ),
    );
    const nextStep = nextCareerStep(player);
    if (nextStep) {
      const wealthOk = player.wealth >= nextStep.minWealth;
      const skill = careerLadder(player.classId)[0]
        ? player.classId === 'merchant'
          ? 'trade'
          : player.classId === 'mercenary'
            ? 'melee'
            : 'persuasion'
        : 'trade';
      const current = player.skills[skill] ?? 0;
      const skillOk = current >= nextStep.minSkill;
      rows.append(
        this.row(
          '下一阶',
          `${nextStep.title}：${nextStep.minWealth} 铜（${wealthOk ? '✓' : fmtMoney(player.wealth)}）· ${labelOf(SKILL_LABELS, skill)} ${nextStep.minSkill}（${skillOk ? '✓' : current}）`,
        ),
      );
    }
    const ambition = ambitionOf(state);
    const chapter = chapterOf(state);
    if (ambition) {
      rows.append(
        this.row(
          '野心',
          `${ambition.name} ${Math.round(ambition.progress * 100)}% · 第 ${chapter.index} 章「${chapter.title}」`,
        ),
      );
    }
    if (country) rows.append(this.row('归属', country.name));
    if (org) {
      rows.append(this.row('组织', org.name));
      rows.append(this.row('职位', this.roleOf(org, state.playerId)));
      rows.append(this.row('持股', fmtPct(this.shareOf(org, state.playerId))));
    }
    this.host.append(rows);

    rows.append(this.row('行动力', `${player.actionPoints} / 3`));
    rows.append(this.row('健康', `${Math.round(player.health)} / 100`));
    const upkeep = monthlyUpkeep(player.wealth);
    rows.append(this.row('每月开销', `${fmtMoney(upkeep)} 铜（身家的 0.4%，钱越多越贵）`));

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
        action.title = `${skillEffectSummary(skill, level)}；练到 ${level + 1} 级：${skillEffectSummary(skill, level + 1)}`;
        train.append(action);
      }
      this.host.append(train);
    }

    // 个人动词按用途分组，避免十几个按钮堆成一团。移动已移到右侧地区页（点城市 → 前往）。
    const quick = el('div', 'player-card__train');
    quick.append(el('p', 'player-card__train-title', '个人行动（各耗 1 行动力）'));
    quick.append(
      this.actionGroup('修养', [this.act('休息', { kind: 'rest' }, player.health >= 100)]),
      this.actionGroup('生计', [this.tradeAction()]),
      this.actionGroup('钱庄', [
        this.act('存 100', { kind: 'deposit', amount: 100 }, player.wealth < 100),
        this.act(
          '取 100',
          { kind: 'withdraw', amount: 100 },
          Object.values(player.deposits).reduce((sum, value) => sum + value, 0) < 100,
        ),
      ]),
    );
    const travelHint = el('p', 'player-card__hint', '移动：在地图或右侧地区页点城市 → 「前往」。');
    quick.append(travelHint);
    this.host.append(quick);

    const skillEntries = Object.entries(player.skills)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    if (skillEntries.length > 0) {
      const chips = el('div', 'player-card__chips');
      for (const [name, value] of skillEntries) {
        const chip = el('span', 'chip', `${labelOf(SKILL_LABELS, name)} ${value}`);
        chip.title = skillEffectSummary(name, value);
        chips.append(chip);
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

    // 左侧也放一张完整人物卡：不用切到「人物」面板就能看到六维与阵营。
    const card = el('details', 'player-card__dossier');
    card.open = true;
    card.append(el('summary', 'player-card__dossier-title', '我的人物卡'));
    const cardBody = el('div', 'player-card__dossier-body');
    renderCharacterCard(cardBody, deps, player, { compact: true });
    card.append(cardBody);
    this.host.append(card);
  }

  /** 贩货按钮直接算好最优货种、目的地与预期利润，别让玩家对着一个黑箱猜。 */
  private tradeAction(): HTMLButtonElement {
    const state = this.deps.state();
    const content = this.deps.content();
    const player = state.characters[state.playerId];
    const capacity = player ? Math.max(1, tradeCarryCapacity(player)) : 1;
    const route = player ? bestTradeRoute(state, content, capacity) : null;
    if (!route) {
      return this.act('贩货（暂无划算路线）', { kind: 'rest' }, true);
    }
    const goodName = content.goods.find((good) => good.id === route.goodId)?.name ?? route.goodId;
    const targetName = state.regions[route.target]?.name ?? route.target;
    const label = `贩 ${route.units} ${goodName} → ${targetName} · 约 +${route.profit} 铜`;
    return this.act(
      label,
      {
        kind: 'trade_goods',
        goodId: route.goodId,
        units: route.units,
        targetRegionId: route.target,
      },
      (player?.actionPoints ?? 0) < 1,
    );
  }
  private actionGroup(title: string, buttons: HTMLButtonElement[]): HTMLElement {
    const group = el('div', 'action-group');
    group.append(el('span', 'action-group__title', title));
    const row = el('div', 'action-group__buttons');
    for (const element of buttons) row.append(element);
    group.append(row);
    return group;
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
