/**
 * 人物卡：玩家卡与人物面板共用同一套渲染，避免两处信息不一致。
 *
 * `renderCharacterCard` 只负责「这个人是谁」的正文（数值、档案、阵营、六维、
 * 技能、性格、关系），不含标题与名录——那两样由各自的面板决定。
 */

import { ATTRIBUTE_KEYS } from '../core/WorldState';
import type { Character, Organization } from '../core/WorldState';
import { alignmentCell, alignmentLabel } from '../systems/character/Profile';
import { careerTitle } from '../systems/character/Career';
import { RELATION_LABELS, relationsOf } from '../systems/character/Relations';
import { skillEffectSummary } from '../systems/character/SkillEffects';
import type { UiDeps } from './context';
import { el, fmtMoney, fmtPct, statCell } from './dom';
import {
  ATTRIBUTE_LABELS,
  CLASS_LABELS,
  RACE_LABELS,
  SEX_LABELS,
  SITE_LABELS,
  SKILL_LABELS,
  TRAIT_LABELS,
  labelOf,
} from './labels';

export interface CharacterCardOptions {
  /** 紧凑模式：左侧栏用，省略四格概览与关系列表，只保留最常看的行。 */
  readonly compact?: boolean;
}

function roleOf(character: Character, org: Organization | undefined): string {
  if (!org) return '无组织';
  if (org.leadership.leaderId === character.id) return `领袖 · ${org.name}`;
  const share = org.shares.find((entry) => entry.characterId === character.id);
  if (share) return `股东 ${fmtPct(share.share)}`;
  if (character.organizationId === org.id) return `成员 · ${org.name}`;
  return `关联 ${org.name}`;
}

function bar(
  label: string,
  value: number,
  max: number,
  display: string,
  title?: string,
): HTMLElement {
  const row = el('li', 'bar');
  if (title) row.title = title;
  const meta = el('div', 'bar__meta');
  meta.append(el('span', 'bar__label', label), el('span', 'bar__value', display));
  const track = el('div', 'bar__track');
  const fill = el('div', 'bar__fill');
  fill.style.width = `${Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100))}%`;
  track.append(fill);
  row.append(meta, track);
  return row;
}

export function renderCharacterCard(
  host: HTMLElement,
  deps: UiDeps,
  selected: Character,
  options: CharacterCardOptions = {},
): void {
  const state = deps.state();
  const compact = options.compact ?? false;
  const org = selected.organizationId ? state.organizations[selected.organizationId] : undefined;

  if (!compact) {
    const stats = el('div', 'stat-grid');
    stats.append(
      statCell(
        '财富',
        fmtMoney(selected.wealth),
        'neutral',
        '个人现金：不以铜币计价的资产不在其中',
      ),
      statCell('年龄', `${selected.age} 岁`, 'neutral', '年龄影响生涯晋升与死亡风险'),
      statCell(
        '地区',
        state.regions[selected.regionId]?.name ?? '—',
        'neutral',
        '当前所在地：市场与商路从这里计算',
      ),
      statCell(
        '组织职位',
        roleOf(selected, org),
        'neutral',
        '在所属组织中的层级；层级越高分到的收益越多',
      ),
    );
    host.append(stats);
  } else {
    const line = el(
      'p',
      'character-card__line',
      `${labelOf(RACE_LABELS, selected.raceId)} · ${labelOf(CLASS_LABELS, selected.classId)} · ${selected.age} 岁 · ${careerTitle(selected.classId, selected.careerRank)}（${selected.careerRank}/3）`,
    );
    host.append(line);
    host.append(
      el(
        'p',
        'character-card__line',
        `财富 ${fmtMoney(selected.wealth)} · ${roleOf(selected, org)}`,
      ),
    );
  }

  host.append(el('h3', 'section-title', '档案'));
  const faithName =
    selected.faith === null
      ? '无信仰'
      : (deps.content().faiths?.find((faith) => faith.id === selected.faith)?.name ?? '未知信仰');
  const family = selected.familyId ? state.families[selected.familyId] : undefined;
  const dossier = el('div', 'stat-grid');
  dossier.append(
    statCell('性别', labelOf(SEX_LABELS, selected.sex)),
    statCell('信仰', faithName),
    statCell(
      '所在',
      `${state.regions[selected.regionId]?.name ?? '—'} · ${labelOf(SITE_LABELS, selected.location.site)}`,
    ),
    statCell(
      '家族',
      family
        ? `${family.name}${(family.prestige ?? 0) > 0 ? `（声望 ${family.prestige}）` : ''}`
        : '无',
    ),
    statCell('代际', `第 ${selected.generation} 代`),
    statCell('出身', state.regions[selected.homeRegionId]?.name ?? '—'),
  );
  host.append(dossier);

  const alignment = el('div', 'alignment-block');
  alignment.append(
    el('p', 'alignment-block__label', `阵营：${alignmentLabel(selected.alignment)}`),
  );
  const grid = el('div', 'alignment-grid');
  const activeCell = alignmentCell(selected.alignment);
  for (let index = 0; index < 9; index += 1) {
    grid.append(el('span', `alignment-grid__cell${index === activeCell ? ' is-active' : ''}`));
  }
  alignment.append(grid);
  alignment.append(
    el(
      'p',
      'alignment-block__axes',
      `守序 ${selected.alignment.law} · 善良 ${selected.alignment.good}（负值为混乱 / 邪恶）`,
    ),
  );
  host.append(alignment);

  if (compact) {
    host.append(el('h3', 'section-title', '六维'));
    const attributes = el('ul', 'bar-list');
    for (const key of ATTRIBUTE_KEYS) {
      const value = selected.attributes[key];
      attributes.append(bar(ATTRIBUTE_LABELS[key], value, 20, `${value}`));
    }
    host.append(attributes);
    return;
  }

  host.append(
    el(
      'p',
      'alignment-block__axes',
      `生涯：${careerTitle(selected.classId, selected.careerRank)}（${selected.careerRank}/3）`,
    ),
  );

  const relations = relationsOf(state, selected.id).slice(0, 6);
  if (relations.length > 0) {
    host.append(el('h3', 'section-title', '关系'));
    const list = el('ul', 'bar-list');
    for (const relation of relations) {
      const other = state.characters[relation.to];
      const sign = relation.value > 0 ? '+' : '';
      list.append(
        el(
          'li',
          'stat-line',
          `${other?.name ?? relation.to} · ${RELATION_LABELS[relation.type]} ${sign}${relation.value}`,
        ),
      );
    }
    host.append(list);
  }

  host.append(el('h3', 'section-title', '六维'));
  const attributes = el('ul', 'bar-list');
  for (const key of ATTRIBUTE_KEYS) {
    const value = selected.attributes[key];
    attributes.append(bar(ATTRIBUTE_LABELS[key], value, 20, `${value}`));
  }
  host.append(attributes);

  if (org) {
    const orgRow = el('div', 'inline-link');
    const open = el('button', 'btn btn--small', `查看 ${org.name}`);
    open.type = 'button';
    open.addEventListener('click', () => deps.openOrganization(org.id));
    orgRow.append(open);
    host.append(orgRow);
  }

  host.append(el('h3', 'section-title', '技能'));
  const skills = el('ul', 'bar-list');
  const skillEntries = Object.entries(selected.skills).sort((a, b) => b[1] - a[1]);
  const skillMax = Math.max(10, ...skillEntries.map(([, value]) => value));
  for (const [name, value] of skillEntries) {
    skills.append(
      bar(
        labelOf(SKILL_LABELS, name),
        value,
        skillMax,
        `${value}`,
        skillEffectSummary(name, value),
      ),
    );
  }
  if (skillEntries.length === 0) skills.append(el('li', 'empty', '没有记录在案的技能'));
  host.append(skills);

  host.append(el('h3', 'section-title', '性格'));
  const traits = el('ul', 'bar-list');
  const traitEntries = Object.entries(selected.traits).sort((a, b) => b[1] - a[1]);
  for (const [name, value] of traitEntries) {
    traits.append(bar(labelOf(TRAIT_LABELS, name), value, 1, fmtPct(value)));
  }
  if (traitEntries.length === 0) traits.append(el('li', 'empty', '没有显著性格'));
  host.append(traits);
}
