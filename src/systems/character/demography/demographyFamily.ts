import type {
  Character,
  CharacterId,
  Family,
  FamilyId,
  SettleContext,
  WorldState,
} from '../../../core/WorldState';
import { sortedIds } from '../../../core/WorldState';
import { linkKin, linkRivalry } from '../Relations';
import { cultureOf } from './demographyRules';

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

export function isForbiddenMatch(a: Character, b: Character): boolean {
  if (a.spouseId !== null || b.spouseId !== null) return true;
  if (a.sex === b.sex) return true;
  if (a.parentIds.includes(b.id) || b.parentIds.includes(a.id)) return true;
  if (a.parentIds.some((id) => id !== null && b.parentIds.includes(id))) return true;
  if (a.familyId !== null && a.familyId === b.familyId) return true;
  return false;
}

/** 家族名取姓名里 `·` 之后的部分（"艾伦·格雷" → "格雷"），没有则用全名。 */
export function familyNameOf(character: Character): string {
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
