/**
 * 人口学：衰老、死亡、遗产、婚姻与出生（M4.1）。
 *
 * 三条约束：
 * 1. **可复现**：所有随机都走 `ctx.rng`，键为 `stream:entityId:periodKey`，遍历用 `sortedIds`；
 * 2. **不凭空生成**：人物只从在世父母出生，属性/信仰/阵营都由父母派生，地点取母亲所在地；
 * 3. **不留悬空引用**：死亡先清配偶指针，再把现金与股份按"配偶 → 子女 → 兄弟姐妹 → 其余股东"分配。
 */

import { invalidateEntityNames } from '../../core/Chronicler';
import { DAYS_PER_YEAR } from '../../core/GameClock';
import type {
  Character,
  CharacterId,
  SettleContext,
  WorldContent,
  WorldState,
} from '../../core/WorldState';
import { buildCharacter, neutralAttributes, sortedIds } from '../../core/WorldState';
import { handleDeath } from './CharacterSystem';
import { linkKin } from './Relations';
import { settleEstate } from './demography/demographyEstate';
import {
  isForbiddenMatch,
  linkFamily,
  settleFamilyPrestige,
  settleNpcRelations,
} from './demography/demographyFamily';
import {
  FERTILITY_AGE_MAX,
  FERTILITY_AGE_MIN,
  INFLOW_PER_YEAR,
  MARRIAGE_AGE_MAX,
  MARRIAGE_AGE_MIN,
  MARRIAGE_CHANCE,
  MAX_NAMED_CHARACTERS,
  MIN_NAMED_CHARACTERS,
  NEWCOMER_SKILLS,
  annualMortality,
  cultureOf,
  inheritAlignment,
  inheritAttributes,
  makeName,
} from './demography/demographyRules';
import type { DemographyReport, EstateShare, Marriage } from './demography/demographyTypes';

export type { Marriage, EstateShare, DemographyReport } from './demography/demographyTypes';
export {
  MAX_NAMED_CHARACTERS,
  MARRIAGE_AGE_MIN,
  MARRIAGE_AGE_MAX,
  MARRIAGE_CHANCE,
  FERTILITY_AGE_MIN,
  FERTILITY_AGE_MAX,
  MIN_NAMED_CHARACTERS,
  cultureOf,
  physiqueFactor,
  effectiveAge,
  annualMortality,
} from './demography/demographyRules';
export {
  kinOf,
  linkFamily,
  settleFamilyPrestige,
  settleNpcRelations,
} from './demography/demographyFamily';
export { settleEstate, shareTotal } from './demography/demographyEstate';

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
  invalidateEntityNames(state);
  linkKin(state, id, father.id);
  linkKin(state, id, mother.id);

  if (child.familyId !== null) {
    const family = state.families[child.familyId];
    if (family) family.memberIds.push(id);
  }
  return id;
}

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
    invalidateEntityNames(state);
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
