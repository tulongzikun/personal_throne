/**
 * 关系网（M4.3）。
 *
 * 关系是**有向**记录：`from` 对 `to` 的看法。`value` 取 −100..100，
 * 正数是善意（盟友/亲族），负数是敌意（对手/世仇）。现实里两个人互相
 * 的看法可以不对称，所以不强制双向一致；`relationScore()` 会把双向相加，
 * 供 NPC 决策与事件条件使用。
 */

import type { CharacterId, Relation, WorldState } from '../../core/WorldState';

export type RelationType = Relation['type'];

export const RELATION_TYPES: readonly RelationType[] = ['ally', 'family', 'rival', 'feud', 'debt'];

export const RELATION_LABELS: Readonly<Record<RelationType, string>> = {
  ally: '盟友',
  family: '亲族',
  rival: '对手',
  feud: '世仇',
  debt: '债务',
};

/** 关系强度的上下限。 */
export const RELATION_MIN = -100;
export const RELATION_MAX = 100;

function clamp(value: number): number {
  return Math.max(RELATION_MIN, Math.min(RELATION_MAX, Math.round(value)));
}

export function findRelation(
  state: WorldState,
  from: CharacterId,
  to: CharacterId,
  type: RelationType,
): Relation | null {
  return (
    state.relations.find((rel) => rel.from === from && rel.to === to && rel.type === type) ?? null
  );
}

/** 写入/覆盖一条有向关系；自己对自己不建关系。 */
export function setRelation(
  state: WorldState,
  from: CharacterId,
  to: CharacterId,
  type: RelationType,
  value: number,
): Relation | null {
  if (from === to) return null;
  const existing = findRelation(state, from, to, type);
  if (existing) {
    existing.value = clamp(value);
    return existing.value === 0 ? (removeRelation(state, existing), null) : existing;
  }
  const relation: Relation = { from, to, type, value: clamp(value) };
  if (relation.value !== 0) state.relations.push(relation);
  return relation.value === 0 ? null : relation;
}

/** 在现有强度上加减（事件、命令用）。 */
export function bumpRelation(
  state: WorldState,
  from: CharacterId,
  to: CharacterId,
  type: RelationType,
  delta: number,
): Relation | null {
  const current = findRelation(state, from, to, type)?.value ?? 0;
  return setRelation(state, from, to, type, current + delta);
}

function removeRelation(state: WorldState, relation: Relation): void {
  const index = state.relations.indexOf(relation);
  if (index >= 0) state.relations.splice(index, 1);
}

/** 某人出发的全部关系（UI 用，按强度绝对值排序）。 */
export function relationsOf(state: WorldState, characterId: CharacterId): Relation[] {
  return state.relations
    .filter((relation) => relation.from === characterId)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

/** 双方互相看法之和：正数亲近、负数敌对。 */
export function relationScore(state: WorldState, a: CharacterId, b: CharacterId): number {
  let total = 0;
  for (const relation of state.relations) {
    if (relation.from === a && relation.to === b) total += relation.value;
    else if (relation.from === b && relation.to === a) total += relation.value;
  }
  return total;
}

/** 亲缘双向绑定（婚姻、出生）。 */
export function linkKin(state: WorldState, a: CharacterId, b: CharacterId, strength = 55): void {
  bumpRelation(state, a, b, 'family', strength);
  bumpRelation(state, b, a, 'family', strength);
}

/** 结仇双向绑定（争夺、背叛）。 */
export function linkRivalry(
  state: WorldState,
  a: CharacterId,
  b: CharacterId,
  type: 'rival' | 'feud' = 'rival',
  strength = 35,
): void {
  bumpRelation(state, a, b, type, strength);
  bumpRelation(state, b, a, type, strength);
}

/**
 * 每年向 0 回归一次：关系会淡，但不会凭空反转。
 *
 * 保留 1 位小数，绝对值 <1 的关系直接删除，避免存档里堆几千条死记录。
 */
export function decayRelations(state: WorldState, factor = 0.92): number {
  let removed = 0;
  for (const relation of state.relations) {
    const next = relation.value * factor;
    relation.value = Math.abs(next) < 1 ? 0 : Math.round(next * 10) / 10;
    if (relation.value === 0) removed += 1;
  }
  if (removed > 0) state.relations = state.relations.filter((relation) => relation.value !== 0);
  return removed;
}

/** UI/历史用的简短描述，例如 `艾伦 → 霍布：亲族 +48`。 */
export function describeRelation(
  state: WorldState,
  relation: Relation,
  resolveName: (id: string) => string,
): string {
  void state;
  return `${resolveName(relation.from)} → ${resolveName(relation.to)}：${
    RELATION_LABELS[relation.type]
  } ${relation.value > 0 ? '+' : ''}${relation.value}`;
}
