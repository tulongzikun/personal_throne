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

/** 选出本国最合适的在世统治者；没有候选人时返回 null（不修改国家）。 */
export function chooseRuler(
  state: WorldState,
  country: Country,
  polity: Polity = country.polity,
): CharacterId | null {
  const inCountry = new Set(country.regionIds);
  let bestFree: CharacterId | null = null;
  let bestFreeScore = Number.NEGATIVE_INFINITY;
  let bestAny: CharacterId | null = null;
  let bestAnyScore = Number.NEGATIVE_INFINITY;

  for (const id of sortedIds(state.characters)) {
    const character = state.characters[id];
    if (!character || !character.alive) continue;
    if (!inCountry.has(character.regionId)) continue;
    const score = scoreOf(state, id, polity);
    if (character.organizationId === null && score > bestFreeScore) {
      bestFree = id;
      bestFreeScore = score;
    }
    if (score > bestAnyScore) {
      bestAny = id;
      bestAnyScore = score;
    }
  }
  if (bestFree) return bestFree;
  if (bestAny) return bestAny;

  // 本国已无在世人物：从全世界在世人物中选，仍优先不兼任组织领袖者。
  for (const id of sortedIds(state.characters)) {
    const character = state.characters[id];
    if (!character || !character.alive) continue;
    const score = scoreOf(state, id, polity);
    if (character.organizationId === null && score > bestFreeScore) {
      bestFree = id;
      bestFreeScore = score;
    }
    if (score > bestAnyScore) {
      bestAny = id;
      bestAnyScore = score;
    }
  }
  return bestFree ?? bestAny;
}

/** 人物全部凋零时补位一个摄政，保证国家不出现权力真空。 */
function spawnRegent(state: WorldState, country: Country): CharacterId {
  state.characterSeq += 1;
  const id = `c_regent_${String(state.characterSeq).padStart(3, '0')}`;
  const regionId = country.regionIds[0] ?? sortedIds(state.regions)[0] ?? 'r_unknown';
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
    if (!character || !character.alive || id === rulerId || character.age < 16) continue;
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
