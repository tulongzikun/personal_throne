/**
 * 命令校验用的小工具：控制权、金额、邻接、技能属性与政策上下限。
 */

import type { AttributeKey, CountryId, OrgId, RegionId, WorldState } from './WorldState';
import type { CommandResult } from './commandTypes';

export const POLICY_MIN = 0;
export const POLICY_MAX = 1;

/** 玩家对国家的控制权：本国统治者，或持有本国公职（rank ≥ 2）。 */
export function canCommandCountry(state: WorldState, countryId: CountryId): boolean {
  const country = state.countries[countryId];
  if (!country) return false;
  if (country.rulerId === state.playerId) return true;
  return country.offices.some(
    (office) => office.holderId === state.playerId && office.influence >= 0.4,
  );
}

/** 玩家所属（效忠）的国家：所在地区所属国，否则按国籍取第一个。 */
export function ownCountryOf(state: WorldState): WorldState['countries'][string] | null {
  const player = state.characters[state.playerId];
  const region = player ? state.regions[player.location.regionId] : null;
  if (region) {
    const country = state.countries[region.countryId];
    if (country) return country;
  }
  return null;
}

/** 玩家对组织的控制权：领袖，或持股 ≥ 20%。 */
export function canControl(state: WorldState, orgId: OrgId): boolean {
  const org = state.organizations[orgId];
  if (!org) return false;
  if (org.leadership.leaderId === state.playerId) return true;
  return org.shares.some((share) => share.characterId === state.playerId && share.share >= 0.2);
}

export function isAmount(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

export function fail(error: string): CommandResult {
  return { ok: false, error };
}

export function regionHasPath(state: WorldState, from: RegionId, to: RegionId): boolean {
  if (from === to) return true;
  const visited = new Set<RegionId>([from]);
  let frontier: RegionId[] = [from];
  for (let hop = 0; hop < 4; hop += 1) {
    const next: RegionId[] = [];
    for (const id of frontier) {
      const region = state.regions[id];
      if (!region) continue;
      for (const link of region.links) {
        if (link.to === to) return true;
        if (!visited.has(link.to)) {
          visited.add(link.to);
          next.push(link.to);
        }
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return false;
}

/** 技能对应的主属性（六维），用于训练上限。 */
export const SKILL_ATTRIBUTE: Readonly<Record<string, AttributeKey>> = {
  trade: 'intellect',
  negotiation: 'charisma',
  persuasion: 'charisma',
  intimidation: 'willpower',
  insight: 'perception',
  law: 'intellect',
  melee: 'physique',
  tactics: 'intellect',
  stealth: 'agility',
  appraisal: 'perception',
  craft: 'agility',
};

export function skillAttribute(skill: string): AttributeKey {
  return SKILL_ATTRIBUTE[skill] ?? 'intellect';
}
