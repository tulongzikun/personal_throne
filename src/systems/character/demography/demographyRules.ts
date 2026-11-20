import type { Character, WorldContent } from '../../../core/WorldState';
import { mortalityRisk } from '../CharacterSystem';
import { clampAlignment } from '../Profile';

/** 具名人口上限：超过后停止出生（其余人口以抽象人口计入国家 `population`）。 */
export const MAX_NAMED_CHARACTERS = 400;

/** 结婚年龄区间与年婚配概率。 */
export const MARRIAGE_AGE_MIN = 16;

export const MARRIAGE_AGE_MAX = 50;

export const MARRIAGE_CHANCE = 0.16;

/** 生育年龄区间。 */
export const FERTILITY_AGE_MIN = 16;

export const FERTILITY_AGE_MAX = 45;

/**
 * 具名人口下限：低于此数时从"抽象人口"（国家 ）里补充新人物。
 *
 * 这不是凭空生成世界细节，而是把宏观人口里本来就存在的人"提升为具名角色"——
 * 属性、姓名、信仰都按地区文化与内容池生成，且全部走  保证可复现。
 */
export const MIN_NAMED_CHARACTERS = 24;

/** 每年最多补充人数，避免一次补太多让世界显得突兀。 */
export const INFLOW_PER_YEAR = 6;

export const NEWCOMER_SKILLS = [
  'trade',
  'negotiation',
  'persuasion',
  'insight',
  'law',
  'melee',
  'tactics',
  'stealth',
  'appraisal',
  'craft',
] as const;

/** 内置姓名池：`names.json` 装配后以内容为准，这里保证脚本与测试无内容也能跑。 */
export const FALLBACK_NAMES = {
  male: [
    '埃德温',
    '罗兰',
    '提利昂',
    '卡西尔',
    '阿尔文',
    '托本',
    '塞德里克',
    '马格努斯',
    '奥托',
    '赫尔曼',
    '洛肯',
    '伯恩',
  ],
  female: [
    '艾莉丝',
    '玛尔塔',
    '塞琳娜',
    '伊芙琳',
    '罗莎',
    '薇拉',
    '艾达',
    '莉安',
    '格蕾塔',
    '米蕾',
    '诺拉',
    '塞西莉亚',
  ],
  family: [
    '格雷',
    '瓦尔',
    '索恩',
    '布兰',
    '克里夫',
    '达顿',
    '艾灵',
    '福克斯',
    '哈罗',
    '凯恩',
    '兰彻',
    '莫尔',
  ],
} as const;

/** 幼年夭折率：5 岁前每年 4%，把死亡率曲线补全。 */
/** 种族寿命对死亡率的折算：精灵老得慢，矮人略慢，人类按实际年龄。 */
export const RACE_AGE_FACTOR: Readonly<Record<string, number>> = {
  human: 1,
  dwarf: 0.85,
  elf: 0.35,
};

/** 地区 → 文化（决定姓名池）。 */
export function cultureOf(regionId: string): string {
  if (regionId === 'r_portlumen' || regionId === 'r_tidemarket') return 'league';
  return 'silvermoon';
}

export function pick<T>(items: readonly T[], index: number): T | undefined {
  if (items.length === 0) return undefined;
  return items[index % items.length];
}

/** 体质对死亡率的修正：体质 6 → ×1.2，体质 20 → ×0.7。 */
export function physiqueFactor(physique: number): number {
  return Math.min(1.3, Math.max(0.6, 1.2 - (Math.max(1, Math.min(20, physique)) - 6) * 0.04));
}

export function effectiveAge(character: Character): number {
  return character.age * (RACE_AGE_FACTOR[character.raceId] ?? 1);
}

export function annualMortality(character: Character): number {
  const age = effectiveAge(character);
  if (age < 5) return 0.04;
  return mortalityRisk(age) * physiqueFactor(character.attributes.physique);
}

/** 年内出生：父母属性取均值后小幅漂移。 */
export function inheritAttributes(father: Character, mother: Character, roll: () => number) {
  const keys = ['physique', 'agility', 'intellect', 'willpower', 'perception', 'charisma'] as const;
  const attributes = {} as Character['attributes'];
  for (const key of keys) {
    const mid = (father.attributes[key] + mother.attributes[key]) / 2;
    attributes[key] = Math.min(20, Math.max(1, Math.round(mid + roll() * 2 - 1)));
  }
  return attributes;
}

export function inheritAlignment(father: Character, mother: Character, roll: () => number) {
  return clampAlignment({
    law: (father.alignment.law + mother.alignment.law) / 2 + roll() * 20 - 10,
    good: (father.alignment.good + mother.alignment.good) / 2 + roll() * 20 - 10,
  });
}

/** 给定姓名：优先内容姓名池，其次内置池。 */
export function makeName(
  content: WorldContent,
  sex: 'male' | 'female',
  culture: string,
  choice: number,
): string {
  const pool = content.names?.cultures?.[culture];
  const given = pick(pool?.[sex] ?? FALLBACK_NAMES[sex], choice) ?? '无名';
  const surname = pick(pool?.family ?? FALLBACK_NAMES.family, Math.floor(choice / 7)) ?? '无名';
  return `${given}·${surname}`;
}
