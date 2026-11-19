/**
 * 开局人物创建（M4.2）。
 *
 * 设计（roadmap §2.0.1 / D6）：
 * - 六维默认全 10，从 6 个天赋标签里选 3 个（可重复），每个 +2，单维上限 16；
 * - 背景决定职业、出生地区、初始财富、初始技能与属性倾向；
 * - 姓名从文化姓名池里取（可手填），信仰默认取背景，可改或改为无信仰；
 * - 生成的是**普通 `Character`**，与人口学出生的人走同一套档案结构，
 *   因此存档、面板、死亡与继承都不需要特判。
 */

import type {
  Alignment,
  AttributeKey,
  Character,
  CharacterDef,
  Sex,
  WorldContent,
  WorldState,
} from '../../core/WorldState';
import { ATTRIBUTE_KEYS, buildCharacter, neutralAttributes } from '../../core/WorldState';
import type { Random } from '../../core/Random';
import { clampAlignment } from './Profile';

/** 天赋标签：每个 +2 指定属性（可重复选取，单维最终不超过 16）。 */
export interface TalentTag {
  readonly id: string;
  readonly name: string;
  readonly attribute: AttributeKey;
  readonly description: string;
}

export const TALENT_TAGS: readonly TalentTag[] = [
  {
    id: 'talent_sturdy',
    name: '强健',
    attribute: 'physique',
    description: '体魄 +2：耐得住长途与苦役。',
  },
  {
    id: 'talent_nimble',
    name: '灵巧',
    attribute: 'agility',
    description: '灵敏 +2：手上与脚下都快人一步。',
  },
  {
    id: 'talent_clever',
    name: '聪慧',
    attribute: 'intellect',
    description: '智识 +2：算账、读书、看穿局。',
  },
  {
    id: 'talent_resolute',
    name: '坚毅',
    attribute: 'willpower',
    description: '意志 +2：不容易被吓住或收买。',
  },
  {
    id: 'talent_sharp',
    name: '敏锐',
    attribute: 'perception',
    description: '感知 +2：能注意到别人漏掉的细节。',
  },
  {
    id: 'talent_radiant',
    name: '煊赫',
    attribute: 'charisma',
    description: '魅力 +2：说话有人听，亮相有人记。',
  },
];

/** 天赋数量与单维上限。 */
export const TALENT_PICKS = 3;
export const ATTRIBUTE_CAP_FROM_TALENTS = 16;

export interface CharacterCreationChoice {
  readonly backgroundId: string;
  /** 3 个天赋标签 id，可重复。 */
  readonly talents: readonly string[];
  readonly name?: string;
  readonly sex?: Sex;
  readonly culture?: string;
  /** 覆盖背景信仰；`null` 表示无信仰。 */
  readonly faithId?: string | null;
  readonly alignment?: Partial<Alignment>;
  /** 默认 `c_player`。 */
  readonly id?: string;
}

export interface CharacterCreationResult {
  readonly character: Character;
  readonly warnings: readonly string[];
}

export class CharacterCreationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CharacterCreationError';
  }
}

function requireBackground(content: WorldContent, backgroundId: string) {
  const background = content.backgrounds?.find((entry) => entry.id === backgroundId);
  if (!background) throw new CharacterCreationError(`未知背景：${backgroundId}`);
  return background;
}

function talentCounts(talents: readonly string[]): Map<AttributeKey, number> {
  if (talents.length !== TALENT_PICKS) {
    throw new CharacterCreationError(`需要选择 ${TALENT_PICKS} 个天赋，收到 ${talents.length} 个`);
  }
  const counts = new Map<AttributeKey, number>();
  for (const id of talents) {
    const tag = TALENT_TAGS.find((entry) => entry.id === id);
    if (!tag) throw new CharacterCreationError(`未知天赋：${id}`);
    counts.set(tag.attribute, (counts.get(tag.attribute) ?? 0) + 1);
  }
  return counts;
}

/** 文化名池；缺失时退回第一个文化。 */
function namePool(content: WorldContent, culture: string) {
  const cultures = content.names?.cultures ?? {};
  return cultures[culture] ?? Object.values(cultures)[0] ?? null;
}

function pickName(
  content: WorldContent,
  culture: string,
  sex: Sex,
  rng: Random | null,
  taken: ReadonlySet<string>,
): string {
  const pool = namePool(content, culture);
  if (!pool) return sex === 'male' ? '无名者' : '无名氏';
  const given = sex === 'male' ? pool.male : pool.female;
  const families = pool.family;
  const pick = (list: readonly string[], fallback: string): string => {
    if (list.length === 0) return fallback;
    if (!rng) return list[0] as string;
    return list[
      rng.int({ stream: 'creator', entityId: 'name', periodKey: culture }, 0, list.length - 1)
    ] as string;
  };
  const givenName = pick(given, '无名');
  const familyName = pick(families, '');
  const candidate = familyName ? `${givenName}·${familyName}` : givenName;
  if (!taken.has(candidate)) return candidate;
  let suffix = 2;
  while (taken.has(`${candidate}（${suffix}）`)) suffix += 1;
  return `${candidate}（${suffix}）`;
}

/**
 * 按选择生成玩家人物并写入世界（替换默认 `c_player` 或新建 id）。
 *
 * 纯函数之外只做一件事：把人物挂进 `state.characters` 并把 `state.playerId` 指过去。
 * 若同 id 已存在则原位替换，保证读档后再创建不会留下孤儿。
 */
export function createPlayerCharacter(
  state: WorldState,
  content: WorldContent,
  choice: CharacterCreationChoice,
  rng: Random | null = null,
): CharacterCreationResult {
  const background = requireBackground(content, choice.backgroundId);
  const counts = talentCounts(choice.talents);
  if (!background.regionId || !state.regions[background.regionId]) {
    throw new CharacterCreationError(`背景 ${background.id} 的地区不存在：${background.regionId}`);
  }

  const warnings: string[] = [];
  const attributes = neutralAttributes();
  for (const key of ATTRIBUTE_KEYS) {
    const bump = (counts.get(key) ?? 0) * 2;
    const fromBackground = background.attributes[key] ?? 10;
    const raw = fromBackground + bump;
    attributes[key] = Math.min(ATTRIBUTE_CAP_FROM_TALENTS, Math.max(1, raw));
    if (raw > ATTRIBUTE_CAP_FROM_TALENTS) {
      warnings.push(`${key} 被天赋顶到上限 ${ATTRIBUTE_CAP_FROM_TALENTS}`);
    }
  }

  const id = choice.id ?? 'c_player';
  const existing = state.characters[id];
  const sex = choice.sex ?? existing?.sex ?? 'male';
  const culture =
    choice.culture ??
    (state.regions[background.regionId]?.countryId === 'c_league' ? 'league' : 'silvermoon');
  const taken = new Set(
    Object.values(state.characters)
      .filter((character) => character.id !== id)
      .map((character) => character.name),
  );
  const name = choice.name?.trim()
    ? choice.name.trim()
    : pickName(content, culture, sex, rng, taken);

  const faithId =
    choice.faithId !== undefined ? choice.faithId : (background.faithId ?? existing?.faith ?? null);
  if (faithId !== null && content.faiths && !content.faiths.some((faith) => faith.id === faithId)) {
    throw new CharacterCreationError(`未知信仰：${faithId}`);
  }
  const faithLean = content.faiths?.find((faith) => faith.id === faithId)?.alignmentLean;

  const def: CharacterDef = {
    id,
    name,
    raceId: existing?.raceId ?? 'human',
    classId: background.classId,
    age: existing?.age ?? 22,
    regionId: background.regionId,
    organizationId: existing?.organizationId ?? null,
    wealth: background.wealth,
    skills: { ...background.skills },
    traits: existing?.traits ?? {},
    sex,
    faithId,
    alignment: clampAlignment({
      law: choice.alignment?.law ?? faithLean?.law ?? 0,
      good: choice.alignment?.good ?? faithLean?.good ?? 0,
    }) as Alignment,
    attributes,
    generation: 1,
    parentIds: [null, null],
    spouseId: null,
    familyId: null,
  };

  const character = buildCharacter(def);
  state.characters[id] = character;
  state.playerId = id;
  if (state.organizations[character.organizationId ?? ''] === undefined) {
    // 背景不绑定组织；保留现有组织归属（读档重开时不断关系）。
  }
  return { character, warnings };
}

/** 把已有存档的玩家按同一套规则重算档案（迁移或调试用）。 */
export function rebuildPlayer(
  state: WorldState,
  content: WorldContent,
  choice: CharacterCreationChoice,
  rng: Random | null = null,
) {
  return createPlayerCharacter(state, content, { ...choice, id: state.playerId }, rng);
}
