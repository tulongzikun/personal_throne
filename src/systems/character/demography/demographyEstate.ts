import type { CharacterId, OrgId, WorldState } from '../../../core/WorldState';
import { sortedIds } from '../../../core/WorldState';
import { kinOf } from './demographyFamily';
import type { EstateShare } from './demographyTypes';

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

/** 供测试/事件使用：某组织的股份总和（应恒为 1）。 */
export function shareTotal(state: WorldState, orgId: OrgId): number {
  const org = state.organizations[orgId];
  if (!org) return 0;
  return org.shares.reduce((sum, entry) => sum + entry.share, 0);
}
