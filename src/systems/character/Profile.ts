/**
 * 人物档案：六维属性、阵营双轴、信仰与地点。
 *
 * 设计约束（roadmap §2.0.1）：
 * - 属性 1–20 整数，人类均值 10；玩家用「天赋标签 3 选」，NPC 用掷骰 + 种族修正；
 * - 阵营是两轴 `law`/`good`（各 −100..100），不是九宫格枚举——九宫格只是展示用的派生标签；
 * - 信仰可以是 `null`（无信仰），这是合法值而不是缺失；
 * - 地点是 `{ regionId, site, sinceDay }`，M5 再把 `site` 细化为城区。
 */

import type { Alignment, Attributes, Character, SiteKind } from '../../core/WorldState';
import { ATTRIBUTE_KEYS } from '../../core/WorldState';

/** 种族属性修正（内容里的 `races.json` 目前没有属性字段，先在这里落实）。 */
export const RACE_ATTRIBUTE_BONUS: Readonly<Record<string, Partial<Attributes>>> = {
  human: {},
  dwarf: { physique: 2, agility: -1 },
  elf: { intellect: 1, perception: 1, physique: -1 },
};

/** 阵营分界：|轴值| ≥ 30 才落到"守序/混乱"或"善良/邪恶"。 */
export const ALIGNMENT_NEUTRAL_BAND = 30;

export type AlignmentLabel =
  | '守序善良'
  | '中立善良'
  | '混乱善良'
  | '守序中立'
  | '绝对中立'
  | '混乱中立'
  | '守序邪恶'
  | '中立邪恶'
  | '混乱邪恶';

export const SITE_LABELS: Readonly<Record<SiteKind, string>> = {
  city: '城镇',
  town: '集镇',
  village: '村庄',
  road: '路上',
  court: '宫廷',
  camp: '营地',
  sea: '海上',
};

/** 把任意数值夹进 1–20 的整数区间。非有限值按 10 处理。 */
export function clampAttribute(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.min(20, Math.max(1, Math.round(value)));
}

/** 补齐六维并按种族修正，再夹 1–20。 */
export function baseAttributes(raceId: string, overrides: Partial<Attributes> = {}): Attributes {
  const bonus = RACE_ATTRIBUTE_BONUS[raceId] ?? {};
  const attributes = {} as Attributes;
  for (const key of ATTRIBUTE_KEYS) {
    const override = overrides[key];
    const base = override === undefined ? 10 : override;
    // 覆盖值视为"最终值"，不再叠加种族修正，便于内容作者直接写死。
    attributes[key] = clampAttribute(override === undefined ? base + (bonus[key] ?? 0) : base);
  }
  return attributes;
}

/** 属性加值：10 为 0，14–17 为 +1，18–20 为 +2。 */
export function attributeBonus(attribute: number): number {
  return Math.floor((clampAttribute(attribute) - 10) / 4);
}

/** 技能上限：属性 10 → 6，属性 16 → 8，属性 20 → 9。 */
export function skillCap(attribute: number): number {
  return 3 + Math.floor(clampAttribute(attribute) / 3);
}

export function clampAlignment(alignment: Alignment): Alignment {
  const clamp = (value: number): number =>
    Number.isFinite(value) ? Math.min(100, Math.max(-100, Math.round(value))) : 0;
  return { law: clamp(alignment.law), good: clamp(alignment.good) };
}

/** 阵营九宫格标签（展示用；存储始终是双轴数值）。 */
export function alignmentLabel(alignment: Alignment): AlignmentLabel {
  const { law, good } = clampAlignment(alignment);
  const lawPart =
    law >= ALIGNMENT_NEUTRAL_BAND ? '守序' : law <= -ALIGNMENT_NEUTRAL_BAND ? '混乱' : '中立';
  const goodPart =
    good >= ALIGNMENT_NEUTRAL_BAND ? '善良' : good <= -ALIGNMENT_NEUTRAL_BAND ? '邪恶' : '中立';
  if (lawPart === '中立' && goodPart === '中立') return '绝对中立';
  return `${lawPart}${goodPart}` as AlignmentLabel;
}

/** 阵营格位：0–8，供 UI 九宫格高亮（0 = 左上"守序善良"）。 */
export function alignmentCell(alignment: Alignment): number {
  const { law, good } = clampAlignment(alignment);
  const column = law >= ALIGNMENT_NEUTRAL_BAND ? 0 : law <= -ALIGNMENT_NEUTRAL_BAND ? 2 : 1;
  const row = good >= ALIGNMENT_NEUTRAL_BAND ? 0 : good <= -ALIGNMENT_NEUTRAL_BAND ? 2 : 1;
  return row * 3 + column;
}

/**
 * 应用一次阵营变化，返回实际变化的绝对值（用于"变化 ≥ 10 写历史"）。
 * 单次总变化上限 `maxDelta = 20`，防止一条事件翻转人格。
 */
export function applyAlignmentDelta(
  character: Character,
  delta: Partial<Alignment>,
  maxDelta = 20,
): number {
  const requested = clampAlignment({
    law: (delta.law ?? 0) + 0,
    good: (delta.good ?? 0) + 0,
  });
  const magnitude = Math.abs(requested.law) + Math.abs(requested.good);
  if (magnitude === 0) return 0;
  const scale = magnitude > maxDelta ? maxDelta / magnitude : 1;
  const before = clampAlignment(character.alignment);
  const after = clampAlignment({
    law: before.law + requested.law * scale,
    good: before.good + requested.good * scale,
  });
  character.alignment = after;
  return Math.abs(after.law - before.law) + Math.abs(after.good - before.good);
}

/** 信仰归一：空字符串 / undefined / 未知都收敛到 `null`（无信仰）。 */
export function normalizeFaith(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** 人物所在地点的展示串，例如「城镇（停留 12 天）」。 */
export function locationLabel(character: Character): string {
  const site = SITE_LABELS[character.location.site] ?? '未知';
  return `${site}（停留 ${character.location.sinceDay} 天）`;
}
