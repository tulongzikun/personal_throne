/**
 * 统治者继承：保证任何时刻每个国家都有一个在世统治者（不允许无主国家）。
 *
 * 选择规则（确定性）：
 * - 君主制优先 `traits.authority`，共和制优先 `skills.persuasion + traits.charisma`；
 * - 候选人必须是本国地区内的在世人物，且不兼任组织领袖（避免权力重叠）；
 * - 没有合适候选人时，退而选择本国在世人物 → 任意在世人物 → 按需补位一个摄政。
 *
 * 补位人物的 ID 走 `characterSeq`，只增不减，保证同种子可复现。
 */

import type { CharacterId, Country, Polity, WorldState } from '../../core/WorldState';
import { buildCharacter, sortedIds } from '../../core/WorldState';
import { invalidateEntityNames } from '../../core/Chronicler';

function scoreOf(state: WorldState, id: CharacterId, polity: Polity): number {
  const character = state.characters[id];
  if (!character || !character.alive) return Number.NEGATIVE_INFINITY;
  const skills = character.skills;
  const traits = character.traits;
  if (polity === 'monarchy') {
    return (
      (traits.authority ?? 0.5) * 2 +
      (skills.law ?? 0) * 0.05 +
      (skills.insight ?? 0) * 0.03 +
      (traits.loyalty ?? 0.4) * 0.2
    );
  }
  return (
    (skills.persuasion ?? 0) * 0.12 +
    (traits.charisma ?? 0.4) * 1.5 +
    (skills.law ?? 0) * 0.06 +
    (traits.ambition ?? 0.4) * 0.4
  );
}

/**
 * 血缘继承顺序（仅君主制的 primogeniture 生效）。
 *
 * 顺序：在位者的子女（年长优先）→ 兄弟姐妹 → 侄甥 → 配偶 → 同族长辈。
 * 候选人必须在世、在本国地区内；"本国没人"时再放宽到全世界同族。
 */
function bloodHeirs(state: WorldState, country: Country, line: CharacterId | null): CharacterId[] {
  if (!line) return [];
  const ruler = state.characters[line];
  if (!ruler) return [];
  const inCountry = new Set(country.regionIds);
  const pick = (ids: CharacterId[], requireCountry: boolean): CharacterId[] =>
    ids.filter((id) => {
      const character = state.characters[id];
      if (!character || !character.alive || id === line) return false;
      return requireCountry ? inCountry.has(character.regionId) : true;
    });

  const byAge = (ids: CharacterId[]): CharacterId[] =>
    ids.sort((a, b) => {
      const left = state.characters[a];
      const right = state.characters[b];
      if (!left || !right) return 0;
      if (right.age !== left.age) return right.age - left.age;
      return left.id < right.id ? -1 : 1;
    });

  for (const requireCountry of [true, false]) {
    const children = pick(
      sortedIds(state.characters).filter((id) => state.characters[id]?.parentIds.includes(line)),
      requireCountry,
    );
    if (children.length > 0) return byAge(children);

    const siblings = pick(
      sortedIds(state.characters).filter((id) => {
        if (id === line) return false;
        const other = state.characters[id];
        if (!other) return false;
        const sharedParent = other.parentIds.some(
          (parent) => parent !== null && ruler.parentIds.includes(parent),
        );
        // 同族同辈也算兄弟姐妹（NPC 家族表不总是写全父母）。
        const sameFamily = other.familyId !== null && other.familyId === ruler.familyId;
        return sharedParent || (sameFamily && other.generation === ruler.generation);
      }),
      requireCountry,
    );
    if (siblings.length > 0) return byAge(siblings);

    const nephews = pick(
      sortedIds(state.characters).filter((id) => {
        const other = state.characters[id];
        if (!other || other.familyId === null || other.familyId !== ruler.familyId) return false;
        return other.generation === ruler.generation + 1;
      }),
      requireCountry,
    );
    if (nephews.length > 0) return byAge(nephews);

    if (ruler.spouseId) {
      const spouse = pick([ruler.spouseId], requireCountry);
      if (spouse.length > 0) return spouse;
    }
  }
  return [];
}

/** 选出本国最合适的在世统治者；没有候选人时返回 null（不修改国家）。 */
export function chooseRuler(
  state: WorldState,
  country: Country,
  polity: Polity = country.polity,
): CharacterId | null {
  const inCountry = new Set(country.regionIds);
  // 选举制下的"政治世家"加成：共和国的权贵也倾向把位子传给自家人，
  // 只是不像长子继承那样写死（子女 +1.1，兄弟姐妹 +0.35，配偶 +0.2）。
  const kinBonus = (id: CharacterId): number => {
    const line = state.characters[country.rulerId];
    const candidate = state.characters[id];
    if (!line || !candidate) return 0;
    if (candidate.parentIds.includes(line.id)) return 1.4;
    if (line.parentIds.some((parent) => parent !== null && candidate.parentIds.includes(parent)))
      return 0.5;
    if (candidate.spouseId === line.id || line.spouseId === candidate.id) return 0.2;
    return 0;
  };
  const byScore = (requireCountry: boolean): CharacterId | null => {
    let best: CharacterId | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const id of sortedIds(state.characters)) {
      const character = state.characters[id];
      if (!character || !character.alive) continue;
      if (requireCountry && !inCountry.has(character.regionId)) continue;
      const score = scoreOf(state, id, polity) + kinBonus(id);
      if (score > bestScore) {
        best = id;
        bestScore = score;
      }
    }
    return best;
  };

  // 继承法优先：primogeniture 先找血亲，找不到再退回"最有资格的人"。
  const mode = country.succession;
  if (mode !== 'elective' && mode !== 'council') {
    const heirs = bloodHeirs(state, country, country.rulerId);
    if (heirs.length > 0) return heirs[0]!;
  }

  // 本国优先，其次全世界（避免出现无主国家）。
  return byScore(true) ?? byScore(false);
}

/** 人物全部凋零时补位一个摄政，保证国家不出现权力真空。 */
function spawnRegent(state: WorldState, country: Country): CharacterId {
  state.characterSeq += 1;
  const id = `c_regent_${String(state.characterSeq).padStart(3, '0')}`;
  const regionId = country.regionIds[0] ?? sortedIds(state.regions)[0] ?? 'r_unknown';
  invalidateEntityNames(state);
  state.characters[id] = buildCharacter({
    id,
    name: `${country.name}摄政`,
    raceId: 'human',
    classId: 'politician',
    age: 40,
    regionId,
    organizationId: null,
    wealth: 4000,
    skills: { law: 5, persuasion: 5, insight: 4 },
    traits: { authority: 0.6, charisma: 0.5, caution: 0.5, loyalty: 0.6 },
  });
  return id;
}

/**
 * 让国家立刻拥有一位在世统治者：优先继承，必要时补位。
 * 返回最终 rulerId。
 */
export function installRuler(state: WorldState, country: Country, polity: Polity): CharacterId {
  const picked = chooseRuler(state, country, polity);
  country.rulerId = picked ?? spawnRegent(state, country);
  // 未成年统治者由本国最年长/资深的在世人物摄政；成年后自动解除。
  const ruler = state.characters[country.rulerId];
  if (ruler && ruler.age < 16) {
    const regent = chooseRegent(state, country, country.rulerId);
    country.regentId = regent;
  } else {
    country.regentId = null;
  }
  return country.rulerId;
}

/** 摄政人选：本国在世、非统治者本人、年龄 ≥ 16，按资历与影响力打分。 */
export function chooseRegent(
  state: WorldState,
  country: Country,
  rulerId: CharacterId,
): CharacterId | null {
  const inCountry = new Set(country.regionIds);
  let best: CharacterId | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const id of sortedIds(state.characters)) {
    const character = state.characters[id];
    // 摄政 25–70 岁：低于 25 没有威望，高于 70 随时可能死在任上（审计里的 128 岁摄政）。
    if (!character || !character.alive || id === rulerId) continue;
    if (character.age < 25 || character.age > 70) continue;
    if (!inCountry.has(character.regionId)) continue;
    const score =
      (character.skills.law ?? 0) * 0.2 +
      (character.skills.persuasion ?? 0) * 0.2 +
      (character.traits.authority ?? 0.4) * 2 +
      Math.min(1, character.wealth / 20000);
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}
