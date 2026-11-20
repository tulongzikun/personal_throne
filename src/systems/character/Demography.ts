/**
 * 人口学：衰老、死亡、遗产、婚姻与出生（M4.1）。
 *
 * 三条约束：
 * 1. **可复现**：所有随机都走 `ctx.rng`，键为 `stream:entityId:periodKey`，遍历用 `sortedIds`；
 * 2. **不凭空生成**：人物只从在世父母出生，属性/信仰/阵营都由父母派生，地点取母亲所在地；
 * 3. **不留悬空引用**：死亡先清配偶指针，再把现金与股份按"配偶 → 子女 → 兄弟姐妹 → 其余股东"分配。
 */

import { DAYS_PER_YEAR } from '../../core/GameClock';
import type {
  Character,
  CharacterId,
  Family,
  FamilyId,
  OrgId,
  SettleContext,
  WorldContent,
  WorldState,
} from '../../core/WorldState';
import { buildCharacter, neutralAttributes, sortedIds } from '../../core/WorldState';
import { clampAlignment } from './Profile';
import { handleDeath, mortalityRisk } from './CharacterSystem';
import { linkKin, linkRivalry } from './Relations';

/** 具名人口上限：超过后停止出生（其余人口以抽象人口计入国家 `population`）。 */
export const MAX_NAMED_CHARACTERS = 400;

/** 结婚年龄区间与年婚配概率。 */
export const MARRIAGE_AGE_MIN = 16;
export const MARRIAGE_AGE_MAX = 50;
export const MARRIAGE_CHANCE = 0.16;

/** 生育年龄区间。 */
export const FERTILITY_AGE_MIN = 16;
export const FERTILITY_AGE_MAX = 45;

export interface Marriage {
  readonly a: CharacterId;
  readonly b: CharacterId;
}

export interface EstateShare {
  readonly characterId: string;
  readonly heirs: readonly CharacterId[];
  readonly cash: number;
  readonly share: number;
}

export interface DemographyReport {
  readonly births: readonly CharacterId[];
  readonly marriages: readonly Marriage[];
  readonly deaths: readonly CharacterId[];
  readonly estates: readonly EstateShare[];
}

/** 内置姓名池：`names.json` 装配后以内容为准，这里保证脚本与测试无内容也能跑。 */
const FALLBACK_NAMES = {
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

/** 地区 → 文化（决定姓名池）。 */
export function cultureOf(regionId: string): string {
  if (regionId === 'r_portlumen' || regionId === 'r_tidemarket') return 'league';
  return 'silvermoon';
}

function pick<T>(items: readonly T[], index: number): T | undefined {
  if (items.length === 0) return undefined;
  return items[index % items.length];
}

/** 体质对死亡率的修正：体质 6 → ×1.2，体质 20 → ×0.7。 */
export function physiqueFactor(physique: number): number {
  return Math.min(1.3, Math.max(0.6, 1.2 - (Math.max(1, Math.min(20, physique)) - 6) * 0.04));
}

/** 幼年夭折率：5 岁前每年 4%，把死亡率曲线补全。 */
/** 种族寿命对死亡率的折算：精灵老得慢，矮人略慢，人类按实际年龄。 */
const RACE_AGE_FACTOR: Readonly<Record<string, number>> = {
  human: 1,
  dwarf: 0.85,
  elf: 0.35,
};

export function effectiveAge(character: Character): number {
  return character.age * (RACE_AGE_FACTOR[character.raceId] ?? 1);
}

export function annualMortality(character: Character): number {
  const age = effectiveAge(character);
  if (age < 5) return 0.04;
  return mortalityRisk(age) * physiqueFactor(character.attributes.physique);
}

/** 年内出生：父母属性取均值后小幅漂移。 */
function inheritAttributes(father: Character, mother: Character, roll: () => number) {
  const keys = ['physique', 'agility', 'intellect', 'willpower', 'perception', 'charisma'] as const;
  const attributes = {} as Character['attributes'];
  for (const key of keys) {
    const mid = (father.attributes[key] + mother.attributes[key]) / 2;
    attributes[key] = Math.min(20, Math.max(1, Math.round(mid + roll() * 2 - 1)));
  }
  return attributes;
}

function inheritAlignment(father: Character, mother: Character, roll: () => number) {
  return clampAlignment({
    law: (father.alignment.law + mother.alignment.law) / 2 + roll() * 20 - 10,
    good: (father.alignment.good + mother.alignment.good) / 2 + roll() * 20 - 10,
  });
}

/** 给定姓名：优先内容姓名池，其次内置池。 */
function makeName(
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

/** 在世亲属关系：父母、子女、兄弟姐妹。 */
export function kinOf(state: WorldState, id: CharacterId): CharacterId[] {
  const character = state.characters[id];
  if (!character) return [];
  const kin: CharacterId[] = [];
  for (const parentId of character.parentIds) {
    if (parentId && state.characters[parentId]?.alive) kin.push(parentId);
  }
  for (const otherId of sortedIds(state.characters)) {
    const other = state.characters[otherId];
    if (!other || !other.alive || otherId === id) continue;
    if (other.parentIds.includes(id)) kin.push(otherId);
    else if (
      character.parentIds.some(
        (parentId) => parentId !== null && other.parentIds.includes(parentId),
      )
    ) {
      kin.push(otherId);
    }
  }
  return [...new Set(kin)].sort();
}

function isForbiddenMatch(a: Character, b: Character): boolean {
  if (a.spouseId !== null || b.spouseId !== null) return true;
  if (a.sex === b.sex) return true;
  if (a.parentIds.includes(b.id) || b.parentIds.includes(a.id)) return true;
  if (a.parentIds.some((id) => id !== null && b.parentIds.includes(id))) return true;
  if (a.familyId !== null && a.familyId === b.familyId) return true;
  return false;
}

/** 家族名取姓名里 `·` 之后的部分（"艾伦·格雷" → "格雷"），没有则用全名。 */
function familyNameOf(character: Character): string {
  const parts = character.name.split('·');
  return (parts.length > 1 ? parts[parts.length - 1] : character.name) ?? character.name;
}

/**
 * 把两位新人并入同一个家族。
 *
 * - 双方都没有家族：以两人中较小的 id 建新家族；
 * - 只有一方有：另一方随配偶入族（"嫁入"），子女继承父系家族；
 * - 双方各有家族：新建一个婚姻家族 `fam_<minId>`，不合并两个旧家族
 *   （否则几代之后所有婚姻都会并进同一个大家族，继承与派系失去意义）。
 */
export function linkFamily(state: WorldState, a: Character, b: Character): FamilyId {
  const aFamily = a.familyId;
  const bFamily = b.familyId;
  const leaveFamily = (member: Character, familyId: FamilyId | null): void => {
    if (familyId === null) return;
    const family = state.families[familyId];
    if (!family) return;
    family.memberIds = family.memberIds.filter((id) => id !== member.id);
    if (family.memberIds.length === 0) delete state.families[familyId];
  };
  const mergeInto = aFamily === null ? bFamily : bFamily === null ? aFamily : null;

  if (mergeInto !== null) {
    const existing = state.families[mergeInto];
    if (existing) {
      leaveFamily(a, a.familyId === mergeInto ? null : a.familyId);
      leaveFamily(b, b.familyId === mergeInto ? null : b.familyId);
      existing.memberIds = [...new Set([...existing.memberIds, a.id, b.id])];
    } else {
      state.families[mergeInto] = {
        id: mergeInto,
        name: familyNameOf(a),
        culture: cultureOf(a.regionId),
        memberIds: [a.id, b.id],
      };
    }
    a.familyId = mergeInto;
    b.familyId = mergeInto;
    return mergeInto;
  }

  const familyId: FamilyId = `fam_${a.id < b.id ? a.id : b.id}`;
  const family: Family = state.families[familyId] ?? {
    id: familyId,
    name: familyNameOf(a),
    culture: cultureOf(a.regionId),
    memberIds: [],
  };
  leaveFamily(a, aFamily);
  leaveFamily(b, bFamily);
  family.memberIds = [...new Set([...family.memberIds, a.id, b.id])];
  state.families[familyId] = family;
  a.familyId = familyId;
  b.familyId = familyId;
  return familyId;
}

/**
 * 遗产分配：现金与股份按同一比例给继承人；无继承人时现金充公（入所在国国库），
 * 股份由其余股东按比例接收，保证每个组织股份恒为 100%。
 */
export function settleEstate(state: WorldState, deadId: CharacterId): EstateShare {
  const dead = state.characters[deadId];
  if (!dead) return { characterId: deadId, heirs: [], cash: 0, share: 0 };

  const heirs = new Set<CharacterId>();
  const spouse = dead.spouseId ? state.characters[dead.spouseId] : undefined;
  if (spouse?.alive) heirs.add(spouse.id);
  for (const kinId of kinOf(state, deadId)) {
    const kin = state.characters[kinId];
    if (kin && dead.parentIds.length > 0 && kin.parentIds.includes(deadId)) heirs.add(kinId);
  }
  // 无子女：兄弟姐妹可继承。
  if (heirs.size === 0 || [...heirs].every((id) => id === spouse?.id)) {
    for (const kinId of kinOf(state, deadId)) {
      if (
        state.characters[kinId]?.parentIds.some((id) => id !== null && dead.parentIds.includes(id))
      ) {
        heirs.add(kinId);
      }
    }
  }

  let share = 0;
  for (const orgId of sortedIds(state.organizations)) {
    const org = state.organizations[orgId];
    if (!org) continue;
    const held = org.shares.filter((entry) => entry.characterId === deadId);
    share += held.reduce((sum, entry) => sum + entry.share, 0);
    for (const entry of held) {
      org.shares = org.shares.filter((other) => other !== entry);
    }
    if (held.length === 0) continue;

    const total = held.reduce((sum, entry) => sum + entry.share, 0);
    const heirList = [...heirs].sort();
    if (heirList.length > 0) {
      const per = total / heirList.length;
      for (const heirId of heirList) {
        const existing = org.shares.find((entry) => entry.characterId === heirId);
        if (existing) existing.share += per;
        else org.shares.push({ characterId: heirId, share: per });
      }
    } else {
      // 无继承人：按现有股东比例分配（没有股东则给领袖）。
      const living = org.shares.filter((entry) => {
        const holder = state.characters[entry.characterId];
        return holder?.alive ?? false;
      });
      const base = living.reduce((sum, entry) => sum + entry.share, 0);
      if (base > 0) {
        for (const entry of living) entry.share += (total * entry.share) / base;
      } else if (state.characters[org.leadership.leaderId]?.alive) {
        org.shares.push({ characterId: org.leadership.leaderId, share: total });
      }
    }
    org.shares = org.shares.filter((entry) => entry.share > 1e-9);
  }

  const cash = Math.max(0, dead.wealth);
  const heirList = [...heirs].sort();
  if (heirList.length > 0) {
    const per = cash / heirList.length;
    for (const heirId of heirList) {
      const heir = state.characters[heirId];
      if (heir) heir.wealth += per;
    }
  } else {
    const country = Object.values(state.countries).find((entry) =>
      entry.regionIds.includes(dead.homeRegionId),
    );
    if (country) country.treasury += cash;
  }
  dead.wealth = 0;
  dead.offices = [];

  return { characterId: deadId, heirs: heirList, cash, share };
}

/** 年度结算：衰老 → 死亡 → 遗产 → 婚姻 → 出生。 */
export function settleYearlyDemography(
  state: WorldState,
  content: WorldContent,
  ctx: SettleContext,
): DemographyReport {
  const deaths: CharacterId[] = [];
  const estates: EstateShare[] = [];
  const marriages: Marriage[] = [];
  const births: CharacterId[] = [];
  const yearIndex = Math.floor((ctx.day - 1) / DAYS_PER_YEAR);

  for (const id of sortedIds(state.characters)) {
    const character = state.characters[id];
    if (!character || !character.alive) continue;
    character.age += 1;
    character.birthYear = yearIndex - character.age;
    const risk = annualMortality(character);
    if (
      risk > 0 &&
      ctx.rng.chance({ stream: 'mortality', entityId: id, periodKey: ctx.periodKey }, risk)
    ) {
      character.alive = false;
      deaths.push(id);
      const partner = character.spouseId ? state.characters[character.spouseId] : undefined;
      if (partner) partner.spouseId = null;
      character.spouseId = null;
      handleDeath(state, id);
      estates.push(settleEstate(state, id));
    }
  }

  // 婚姻：优先同地区，其次同国，最后远嫁/远娶（概率依次衰减）。
  const singles = sortedIds(state.characters).filter((id) => {
    const character = state.characters[id];
    if (!character || !character.alive || character.spouseId !== null) return false;
    return character.age >= MARRIAGE_AGE_MIN && character.age <= MARRIAGE_AGE_MAX;
  });

  const regionCountry = new Map<string, string>();
  for (const country of Object.values(state.countries)) {
    for (const regionId of country.regionIds) regionCountry.set(regionId, country.id);
  }

  const chanceFor = (a: Character, b: Character): number => {
    if (a.regionId === b.regionId) return MARRIAGE_CHANCE;
    if (regionCountry.get(a.regionId) === regionCountry.get(b.regionId)) {
      return MARRIAGE_CHANCE * 0.45;
    }
    return MARRIAGE_CHANCE * 0.15;
  };

  for (const aId of singles) {
    const a = state.characters[aId];
    if (!a || !a.alive || a.spouseId !== null) continue;
    // 候选排序：同地区 → 同国 → 其余，同级按 ID 稳定排序。
    const candidates = singles
      .filter((bId) => bId !== aId)
      .map((bId) => state.characters[bId])
      .filter((b): b is Character => !!b && b.alive && b.spouseId === null)
      .filter((b) => !isForbiddenMatch(a, b))
      .sort((x, y) => {
        const rank = (c: Character): number =>
          c.regionId === a.regionId
            ? 0
            : regionCountry.get(c.regionId) === regionCountry.get(a.regionId)
              ? 1
              : 2;
        return rank(x) - rank(y) || (x.id < y.id ? -1 : 1);
      });
    const partner = candidates[0];
    if (!partner) continue;
    const key = aId < partner.id ? `${aId}|${partner.id}` : `${partner.id}|${aId}`;
    if (
      ctx.rng.chance(
        { stream: 'marriage', entityId: key, periodKey: ctx.periodKey },
        chanceFor(a, partner),
      )
    ) {
      a.spouseId = partner.id;
      partner.spouseId = aId;
      linkFamily(state, a, partner);
      linkKin(state, aId, partner.id);
      marriages.push({ a: aId, b: partner.id });
    }
  }

  // 出生：每对夫妻每年一次判定，子女越多概率越低。
  let livingCount = sortedIds(state.characters).filter((id) => state.characters[id]?.alive).length;
  const couples = new Map<string, CharacterId[]>();
  for (const id of sortedIds(state.characters)) {
    const character = state.characters[id];
    if (!character || !character.alive || character.spouseId === null) continue;
    if (character.sex !== 'female') continue;
    if (character.age < FERTILITY_AGE_MIN || character.age > FERTILITY_AGE_MAX) continue;
    const key =
      character.spouseId < id ? `${character.spouseId}|${id}` : `${id}|${character.spouseId}`;
    couples.set(key, [character.spouseId, id]);
  }

  for (const key of [...couples.keys()].sort()) {
    if (livingCount >= MAX_NAMED_CHARACTERS) break;
    const pair = couples.get(key) ?? [];
    const mother = state.characters[pair[1] ?? ''];
    const father = state.characters[pair[0] ?? ''];
    if (!mother || !father || !mother.alive || !father.alive) continue;
    const children = sortedIds(state.characters).filter(
      (id) => state.characters[id]?.alive && state.characters[id]?.parentIds.includes(mother.id),
    ).length;
    const base = mother.age <= 30 ? 0.34 : mother.age <= 38 ? 0.26 : 0.16;
    const chance = Math.max(0.04, base - children * 0.03);
    if (!ctx.rng.chance({ stream: 'birth', entityId: key, periodKey: ctx.periodKey }, chance)) {
      continue;
    }

    births.push(birth(state, content, ctx, father, mother, yearIndex));
    livingCount += 1;
  }

  const newcomers = settlePopulationInflow(state, content, ctx);
  births.push(...newcomers);

  settleFamilyPrestige(state);
  settleNpcRelations(state, ctx);

  return { births: births.filter(Boolean), marriages, deaths, estates };
}

/** 家族声望：公职每席 +2、组织领袖 +1，按年累积，满 100 封顶；无人则缓慢回落。 */
export function settleFamilyPrestige(state: WorldState): void {
  const gains = new Map<string, number>();
  for (const id of sortedIds(state.characters)) {
    const character = state.characters[id];
    if (!character || !character.alive || character.familyId === null) continue;
    const gain = character.offices.length * 2 + (character.careerRank >= 3 ? 1 : 0);
    if (gain > 0) gains.set(character.familyId, (gains.get(character.familyId) ?? 0) + gain);
  }
  for (const [familyId, family] of Object.entries(state.families)) {
    const current = family.prestige ?? 0;
    const delta = gains.get(familyId) ?? -1;
    family.prestige = Math.max(0, Math.min(100, current + delta));
  }
}

/** NPC 关系：每年在同组织/同地区里抽一对人，结盟或结怨，让世界有横向联系。 */
export function settleNpcRelations(state: WorldState, ctx: SettleContext): void {
  const living = sortedIds(state.characters).filter((id) => {
    const character = state.characters[id];
    return !!character && character.alive && id !== state.playerId;
  });
  if (living.length < 2) return;
  for (const org of Object.values(state.organizations)) {
    const members = living.filter((id) => state.characters[id]?.organizationId === org.id);
    if (members.length < 2) continue;
    const first =
      members[
        Math.floor(
          ctx.rng.nextFloat({ stream: 'rel-a', entityId: org.id, periodKey: ctx.periodKey }) *
            members.length,
        )
      ]!;
    const second =
      members[
        Math.floor(
          ctx.rng.nextFloat({ stream: 'rel-b', entityId: org.id, periodKey: ctx.periodKey }) *
            members.length,
        )
      ]!;
    if (first === second) continue;
    const roll = ctx.rng.nextFloat({
      stream: 'rel-kind',
      entityId: org.id,
      periodKey: ctx.periodKey,
    });
    if (roll < 0.5) {
      linkKin(state, first, second, 30);
    } else {
      linkRivalry(state, first, second, 'rival', 25);
    }
  }
}

/** 出生一个人物：属性/阵营/信仰/地点全部从父母派生。 */
function birth(
  state: WorldState,
  content: WorldContent,
  ctx: SettleContext,
  father: Character,
  mother: Character,
  yearIndex: number,
): CharacterId {
  state.characterSeq += 1;
  const id = `c_child_${String(state.characterSeq).padStart(3, '0')}`;
  const roll = (suffix: string): number =>
    ctx.rng.nextFloat({ stream: `birth-${suffix}`, entityId: id, periodKey: ctx.periodKey });
  const sex: 'male' | 'female' = roll('sex') < 0.5 ? 'male' : 'female';
  const choice = Math.floor(roll('name') * 997);
  const faith = roll('faith') < 0.5 ? father.faith : mother.faith;

  const child = buildCharacter({
    id,
    name: makeName(content, sex, cultureOf(mother.homeRegionId), choice),
    raceId: father.raceId,
    classId: father.classId,
    age: 0,
    regionId: mother.location.regionId,
    organizationId: null,
    wealth: 0,
    skills: {},
    traits: { ...father.traits },
    sex,
    faithId: faith,
    alignment: inheritAlignment(father, mother, () => roll('alignment')),
    attributes: inheritAttributes(father, mother, () => roll('attr')),
    familyId: father.familyId ?? mother.familyId,
    generation: Math.max(father.generation, mother.generation) + 1,
    parentIds: [father.id, mother.id],
    location: { ...mother.location, sinceDay: ctx.day },
  });
  child.birthYear = yearIndex;
  state.characters[id] = child;
  linkKin(state, id, father.id);
  linkKin(state, id, mother.id);

  if (child.familyId !== null) {
    const family = state.families[child.familyId];
    if (family) family.memberIds.push(id);
  }
  return id;
}

/**
 * 具名人口下限：低于此数时从"抽象人口"（国家 ）里补充新人物。
 *
 * 这不是凭空生成世界细节，而是把宏观人口里本来就存在的人"提升为具名角色"——
 * 属性、姓名、信仰都按地区文化与内容池生成，且全部走  保证可复现。
 */
export const MIN_NAMED_CHARACTERS = 24;

const NEWCOMER_SKILLS = [
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

/** 每年最多补充人数，避免一次补太多让世界显得突兀。 */
const INFLOW_PER_YEAR = 6;

export function settlePopulationInflow(
  state: WorldState,
  content: WorldContent,
  ctx: SettleContext,
): CharacterId[] {
  const living = sortedIds(state.characters).filter((id) => state.characters[id]?.alive);
  if (living.length >= MIN_NAMED_CHARACTERS) return [];

  const count = Math.min(
    INFLOW_PER_YEAR,
    Math.max(1, Math.ceil((MIN_NAMED_CHARACTERS - living.length) / 2)),
  );
  const added: CharacterId[] = [];

  for (let index = 0; index < count; index += 1) {
    const draw = (stream: string): number =>
      ctx.rng.nextFloat({ stream, entityId: `inflow-${index}`, periodKey: ctx.periodKey });

    // 性别向少数一方倾斜，避免出现"全是男性"的死局。
    const males = [...living, ...added]
      .map((id) => state.characters[id])
      .filter((c): c is Character => !!c && c.alive && c.sex === 'male').length;
    const females = living.length + added.length - males;
    const sex: 'male' | 'female' = males < females ? 'male' : 'female';

    // 地区按国家人口加权。
    const weighted: { regionId: string; weight: number }[] = [];
    for (const country of Object.values(state.countries)) {
      const perRegion = country.population / Math.max(1, country.regionIds.length);
      for (const regionId of country.regionIds) weighted.push({ regionId, weight: perRegion });
    }
    const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0) || 1;
    let ticket = draw('region') * totalWeight;
    let regionId = weighted[0]?.regionId ?? sortedIds(state.regions)[0] ?? 'r_unknown';
    for (const entry of weighted) {
      ticket -= entry.weight;
      if (ticket <= 0) {
        regionId = entry.regionId;
        break;
      }
    }

    const age = 18 + Math.floor(draw('age') * 13);
    const classRoll = draw('class');
    const classId = classRoll < 0.4 ? 'merchant' : classRoll < 0.7 ? 'mercenary' : 'politician';
    const attributes = neutralAttributes();
    const keys = [
      'physique',
      'agility',
      'intellect',
      'willpower',
      'perception',
      'charisma',
    ] as const;
    for (const key of keys) {
      attributes[key] = Math.min(20, Math.max(1, Math.round(10 + draw(`attr-${key}`) * 6 - 3)));
    }
    const skills: Record<string, number> = {};
    for (let pickIndex = 0; pickIndex < 2; pickIndex += 1) {
      const skill =
        NEWCOMER_SKILLS[Math.floor(draw(`skill-${pickIndex}`) * NEWCOMER_SKILLS.length)];
      if (skill) skills[skill] = 1 + Math.floor(draw(`skillrank-${pickIndex}`) * 3);
    }
    const faiths = content.faiths ?? [];
    const faith =
      faiths.length > 0 ? (faiths[Math.floor(draw('faith') * faiths.length)]?.id ?? null) : null;

    state.characterSeq += 1;
    const id = `c_newcomer_${String(state.characterSeq).padStart(3, '0')}`;
    state.characters[id] = buildCharacter({
      id,
      name: makeName(content, sex, cultureOf(regionId), Math.floor(draw('name') * 997)),
      raceId: 'human',
      classId,
      age,
      regionId,
      organizationId: null,
      wealth: 200 + Math.floor(draw('wealth') * 700),
      skills,
      traits: {
        ambition: draw('ambition'),
        caution: draw('caution'),
        loyalty: draw('loyalty'),
      },
      sex,
      faithId: faith,
      alignment: {
        law: Math.round(draw('law') * 80 - 40),
        good: Math.round(draw('good') * 80 - 40),
      },
      attributes,
      generation: 1,
    });
    added.push(id);
  }

  return added;
}

/** 供测试/事件使用：某组织的股份总和（应恒为 1）。 */
export function shareTotal(state: WorldState, orgId: OrgId): number {
  const org = state.organizations[orgId];
  if (!org) return 0;
  return org.shares.reduce((sum, entry) => sum + entry.share, 0);
}
