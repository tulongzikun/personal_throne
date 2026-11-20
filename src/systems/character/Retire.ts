/**
 * 人物退场：把某个角色从世界的经济与政治位置上摘下来。
 *
 * 用于「创建人物」替换默认主角：新人物是新面孔，不该继承前任的股份、领袖位与公职，
 * 但世界必须保持自洽——股份总额不蒸发、组织不能没有领袖、国家不能没有统治者。
 *
 * 规则（确定性）：
 * - 股份：被摘除的份额按比例分给其余股东；若没有其余股东，则归新领袖（或直接注销为未归属份额）。
 * - 领袖：从继承顺序（在世股东 → 在世成员）里挑第一个不是本人的；都没有时挑选任意在世人物并挂到该组织。
 * - 公职：清掉各国 `offices` 里指向本人的人选（下一季度 `syncOffices` 会按技能补位）。
 * - 统治者：调用 `installRuler` 重新选，过程中把本人临时标记为已故，避免又被选回来。
 */

import type { CharacterId, OrgId, WorldState } from '../../core/WorldState';
import type { Organization } from '../../core/WorldState';
import { sortedIds } from '../../core/WorldState';
import { installRuler } from '../country/Ruler';
import { absorbShares } from '../organization/Shares';
import { successionOrder } from '../organization/Organization';

export interface RetireReport {
  /** 被摘除的股东身份数。 */
  readonly sharesRemoved: number;
  /** 移交出去的领袖位数量。 */
  readonly leadershipsHanded: number;
  /** 清掉的公职数量。 */
  readonly officesCleared: number;
  /** 重新选出的统治者数量。 */
  readonly thronesFilled: number;
}

const round4 = (value: number): number => Math.round(value * 10000) / 10000;

/** 挑选继任领袖：继承顺序里第一个不是本人的在世人物，否则任意在世人物。 */
function pickSuccessor(state: WorldState, orgId: OrgId, exclude: CharacterId): CharacterId | null {
  const order = successionOrder(state, orgId).filter((id) => id !== exclude);
  const first = order[0];
  if (first && state.characters[first]?.alive) return first;

  for (const id of sortedIds(state.characters)) {
    const character = state.characters[id];
    if (character && character.alive && character.id !== exclude) return character.id;
  }
  return null;
}

/** 把被摘除股东名下的份额按比例并给其余股东；没有其余股东时归继任领袖。 */
function redistributeShares(
  state: WorldState,
  org: Organization,
  exclude: CharacterId,
  amount: number,
): void {
  if (amount <= 0) return;
  const rest = org.shares;
  const total = rest.reduce((sum, share) => sum + share.share, 0);
  if (total > 0) {
    absorbShares(org, amount);
    return;
  }
  const heir = pickSuccessor(state, org.id, exclude);
  if (heir) {
    rest.push({ characterId: heir, share: round4(amount) });
    const character = state.characters[heir];
    if (character && character.organizationId === null) character.organizationId = org.id;
  }
}

export function retireCharacter(state: WorldState, id: CharacterId): RetireReport {
  let sharesRemoved = 0;
  let leadershipsHanded = 0;
  let officesCleared = 0;
  let thronesFilled = 0;

  const character = state.characters[id];
  const wasAlive = character?.alive ?? false;
  // 临时标记为已故：继承/选举的候选过滤都看 alive，这样本人不会被选回原位。
  if (character) character.alive = false;

  try {
    for (const orgId of sortedIds(state.organizations)) {
      const org = state.organizations[orgId];
      if (!org) continue;

      const index = org.shares.findIndex((share) => share.characterId === id);
      if (index >= 0) {
        const [removed] = org.shares.splice(index, 1);
        sharesRemoved += 1;
        redistributeShares(state, org, id, removed?.share ?? 0);
      }

      if (org.leadership.leaderId === id) {
        const successor = pickSuccessor(state, orgId, id);
        if (successor) {
          org.leadership.leaderId = successor;
          leadershipsHanded += 1;
          const heir = state.characters[successor];
          // 继任者若还没有组织归属，就挂到这个组织上，避免出现"外部人当领袖"。
          if (heir && heir.organizationId === null) heir.organizationId = orgId;
        }
      }
    }

    for (const countryId of sortedIds(state.countries)) {
      const country = state.countries[countryId];
      if (!country) continue;

      const before = country.offices.length;
      country.offices = country.offices.filter((office) => office.holderId !== id);
      officesCleared += before - country.offices.length;

      if (country.rulerId === id) {
        installRuler(state, country, country.polity);
        thronesFilled += 1;
      }
    }

    if (character) character.offices = [];
  } finally {
    if (character) character.alive = wasAlive;
  }

  return { sharesRemoved, leadershipsHanded, officesCleared, thronesFilled };
}
