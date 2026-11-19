/**
 * 人物相关的纯函数：属性读取、关系、继承候选。
 * 状态的写入统一走 CharacterSystem 或 CommandBus。
 */

import type { Character, CharacterId, WorldState } from '../../core/WorldState';
import { sortedIds } from '../../core/WorldState';

export function isAlive(state: WorldState, id: CharacterId): boolean {
  return state.characters[id]?.alive === true;
}

export function characterName(state: WorldState, id: CharacterId): string {
  return state.characters[id]?.name ?? id;
}

/** 人物所属组织；无组织返回 null。 */
export function organizationOf(state: WorldState, id: CharacterId): string | null {
  return state.characters[id]?.organizationId ?? null;
}

/** 人物在某技能上的有效值：基础技能 + 特质修正，截断在 0–20。 */
export function effectiveSkill(state: WorldState, id: CharacterId, skill: string): number {
  const character = state.characters[id];
  if (!character) return 0;
  const base = character.skills[skill] ?? 0;
  const trait = character.traits[`${skill}Talent`] ?? 0;
  return Math.min(20, Math.max(0, base + trait));
}

/** 在世人物按 ID 稳定排序。 */
export function livingCharacters(state: WorldState): Character[] {
  return sortedIds(state.characters)
    .map((id) => state.characters[id])
    .filter((character): character is Character => character?.alive === true);
}

/** 财富转移：从一人转给另一人（借贷、分红、赎金都走这里）。 */
export function transferWealth(
  state: WorldState,
  from: CharacterId,
  to: CharacterId,
  amount: number,
): boolean {
  const payer = state.characters[from];
  const payee = state.characters[to];
  if (!payer || !payee) return false;
  if (!Number.isInteger(amount) || amount <= 0) return false;
  if (payer.wealth < amount) return false;
  payer.wealth -= amount;
  payee.wealth += amount;
  return true;
}
