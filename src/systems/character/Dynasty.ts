/**
 * 统治者家族：给每个国家的在位者补上配偶与子女。
 *
 * 没有这一步，继承法形同虚设——内容里的 7 位统治者都是"孤家寡人"，
 * 死亡后只能按分数从路人里挑一个（审计实测子女继位率 4%），
 * 于是 100 年里看不到王朝，只有走马灯。
 *
 * 这里只补数据，不推进时间：确定性（id 走 characterSeq、年龄由在位者年龄推导），
 * 同一 seed 的两局结果一致。已经有人叫在位者父亲的不会被重复补。
 */

import type { CharacterId, WorldContent, WorldState } from '../../core/WorldState';
import { buildCharacter, sortedIds } from '../../core/WorldState';
import { invalidateEntityNames } from '../../core/Chronicler';
import { cultureOf, makeName } from './demography/demographyRules';
import { linkKin } from './Relations';

const SPOUSE_MIN_AGE = 18;
const SPOUSE_MAX_AGE = 60;

function childAgeFor(rulerAge: number, order: number): number {
  // 第一个孩子假设生在在位者 22 岁，第二个 30 岁；在位者太年轻时孩子也相应变小。
  const age = rulerAge - 22 - order * 8;
  return Math.max(1, Math.min(rulerAge - 16, age));
}

function addSpouse(
  state: WorldState,
  content: WorldContent,
  rulerId: CharacterId,
): CharacterId | null {
  const ruler = state.characters[rulerId];
  if (!ruler) return null;
  if (ruler.spouseId) {
    const existing = state.characters[ruler.spouseId];
    if (existing?.alive) return existing.id;
  }
  state.characterSeq += 1;
  const id = `c_dynasty_${String(state.characterSeq).padStart(3, '0')}`;
  const sex = ruler.sex === 'male' ? 'female' : 'male';
  const age = Math.max(SPOUSE_MIN_AGE, Math.min(SPOUSE_MAX_AGE, ruler.age - 3));
  const culture = ruler.culture ?? cultureOf(ruler.homeRegionId);
  const spouse = buildCharacter({
    id,
    name: makeName(content, sex, culture, (state.characterSeq * 131) % 997),
    raceId: ruler.raceId,
    classId: 'noble',
    age,
    regionId: ruler.location.regionId,
    organizationId: null,
    wealth: Math.round(ruler.wealth * 0.2),
    skills: {},
    traits: { ...ruler.traits },
    sex,
    faithId: ruler.faith,
    familyId: ruler.familyId,
    generation: ruler.generation,
    parentIds: [null, null],
    location: { ...ruler.location },
  });
  state.characters[id] = spouse;
  ruler.spouseId = id;
  spouse.spouseId = rulerId;
  linkKin(state, rulerId, id);
  if (spouse.familyId !== null) state.families[spouse.familyId]?.memberIds.push(id);
  return id;
}

function addChild(
  state: WorldState,
  content: WorldContent,
  rulerId: CharacterId,
  motherId: CharacterId,
  order: number,
): CharacterId | null {
  const ruler = state.characters[rulerId];
  const mother = state.characters[motherId];
  if (!ruler || !mother) return null;
  state.characterSeq += 1;
  const id = `c_dynasty_${String(state.characterSeq).padStart(3, '0')}`;
  const sex = (state.characterSeq + order) % 2 === 0 ? 'male' : 'female';
  const age = childAgeFor(ruler.age, order);
  const culture = ruler.culture ?? cultureOf(ruler.homeRegionId);
  const child = buildCharacter({
    id,
    name: makeName(content, sex, culture, (state.characterSeq * 197 + 11) % 997),
    raceId: ruler.raceId,
    classId: 'noble',
    age,
    regionId: ruler.location.regionId,
    organizationId: null,
    wealth: 0,
    skills: {},
    traits: { ...ruler.traits },
    sex,
    faithId: ruler.faith,
    familyId: ruler.familyId,
    generation: ruler.generation + 1,
    parentIds: [rulerId, motherId],
    location: { ...ruler.location },
  });
  child.birthYear = -age;
  state.characters[id] = child;
  linkKin(state, id, rulerId);
  linkKin(state, id, motherId);
  if (child.familyId !== null) state.families[child.familyId]?.memberIds.push(id);
  return id;
}

/** 幂等：只在"统治者没有任何子女"时补一位配偶和两个孩子。 */
export function seedRulerDynasties(state: WorldState, content: WorldContent): number {
  let seeded = 0;
  for (const countryId of sortedIds(state.countries)) {
    const country = state.countries[countryId];
    if (!country || country.extinct) continue;
    const ruler = state.characters[country.rulerId];
    if (!ruler?.alive) continue;
    const hasChild = Object.values(state.characters).some(
      (character) => character.alive && character.parentIds.includes(ruler.id),
    );
    if (hasChild) continue;
    const spouse = addSpouse(state, content, ruler.id);
    if (!spouse) continue;
    addChild(state, content, ruler.id, spouse, 0);
    addChild(state, content, ruler.id, spouse, 1);
    seeded += 1;
  }
  if (seeded > 0) invalidateEntityNames(state);
  return seeded;
}
