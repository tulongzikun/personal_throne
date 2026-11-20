/**
 * 信号分级：判断一条历史记录与玩家是什么关系。
 *
 * UI 只把 `self` / `family` / `org` / `region` / `country` 级别的事件弹成模态，
 * 其余归入「本月见闻」摘要。判定只读状态，不做任何写入。
 */

import type { HistoryRecord } from '../core/History';
import type { CharacterId, WorldState } from '../core/WorldState';

export type Relation = 'self' | 'family' | 'org' | 'region' | 'country' | 'world';

export const RELATION_LABELS: Readonly<Record<Relation, string>> = {
  self: '与你有关',
  family: '你的家族',
  org: '你的组织',
  region: '你所在地区',
  country: '你的国家',
  world: '远方',
};

const RELATED: ReadonlySet<Relation> = new Set<Relation>([
  'self',
  'family',
  'org',
  'region',
  'country',
]);

export function isRelated(relation: Relation): boolean {
  return RELATED.has(relation);
}

interface PlayerContext {
  readonly playerId: CharacterId;
  readonly familyId: string | null;
  readonly regionIds: ReadonlySet<string>;
  readonly countryId: string | null;
  readonly orgIds: ReadonlySet<string>;
}

function playerContext(state: WorldState): PlayerContext | null {
  const player = state.characters[state.playerId];
  if (!player) return null;

  const regionIds = new Set<string>([player.location.regionId, player.homeRegionId]);
  const homeRegion = state.regions[player.location.regionId] ?? state.regions[player.homeRegionId];
  const orgIds = new Set<string>();
  for (const org of Object.values(state.organizations)) {
    if (org.leadership.leaderId === player.id) orgIds.add(org.id);
    else if (org.shares.some((share) => share.characterId === player.id)) orgIds.add(org.id);
  }
  return {
    playerId: player.id,
    familyId: player.familyId,
    regionIds,
    countryId: homeRegion?.countryId ?? null,
    orgIds,
  };
}

/** 按「自己 > 家族 > 组织 > 地区 > 国家 > 远方」的顺序判定记录与玩家的关系。 */
export function relationOf(
  state: WorldState,
  record: Pick<HistoryRecord, 'refs'>,
  context: PlayerContext | null = playerContext(state),
): Relation {
  if (!context) return 'world';
  const refs = record.refs;

  if (refs.some((ref) => ref.type === 'character' && ref.id === context.playerId)) return 'self';

  if (context.familyId !== null) {
    const family = state.families[context.familyId];
    if (
      family &&
      refs.some((ref) => ref.type === 'character' && family.memberIds.includes(ref.id))
    ) {
      return 'family';
    }
  }

  if (refs.some((ref) => ref.type === 'organization' && context.orgIds.has(ref.id))) return 'org';
  if (refs.some((ref) => ref.type === 'region' && context.regionIds.has(ref.id))) return 'region';
  if (refs.some((ref) => ref.type === 'country' && ref.id === context.countryId)) return 'country';
  return 'world';
}

export interface SignalSubject {
  readonly kind: 'character' | 'organization' | 'country' | 'region' | 'unknown';
  readonly id: string;
  readonly label: string;
}

/** 取记录的第一个可识别实体作为「主体」，用于标题行。 */
export function subjectOf(
  state: WorldState,
  record: Pick<HistoryRecord, 'refs'>,
): SignalSubject | null {
  for (const ref of record.refs) {
    switch (ref.type) {
      case 'character': {
        const character = state.characters[ref.id];
        if (character) return { kind: 'character', id: ref.id, label: character.name };
        break;
      }
      case 'organization': {
        const org = state.organizations[ref.id];
        if (org) return { kind: 'organization', id: ref.id, label: org.name };
        break;
      }
      case 'country': {
        const country = state.countries[ref.id];
        if (country) return { kind: 'country', id: ref.id, label: country.name };
        break;
      }
      case 'region': {
        const region = state.regions[ref.id];
        if (region) return { kind: 'region', id: ref.id, label: region.name };
        break;
      }
      default:
        break;
    }
  }
  return null;
}
