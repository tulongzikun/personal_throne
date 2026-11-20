/**
 * 野心与章节（M7 阶段 5）。
 *
 * 野心不是新的存档字段：由职业推导，进度由现有状态算出，
 * 这样既不升存档版本，也能在每次刷新时立刻反映现实。
 */

import type { WorldState } from '../../core/WorldState';
import { influenceOf } from '../country/Offices';

export type AmbitionId = 'fortune' | 'power' | 'renown';

export interface Ambition {
  readonly id: AmbitionId;
  readonly name: string;
  readonly goal: string;
  readonly progress: number;
  readonly hint: string;
}

const AMBITION_BY_CLASS: Readonly<Record<string, AmbitionId>> = {
  merchant: 'fortune',
  mercenary: 'renown',
  politician: 'power',
};

export function ambitionIdOf(classId: string): AmbitionId {
  return AMBITION_BY_CLASS[classId] ?? 'fortune';
}

export function ambitionOf(state: WorldState): Ambition | null {
  const player = state.characters[state.playerId];
  if (!player) return null;
  const id = ambitionIdOf(player.classId);
  const share = player.organizationId
    ? (state.organizations[player.organizationId]?.shares.find(
        (item) => item.characterId === player.id,
      )?.share ?? 0)
    : 0;
  const influence = player.offices.length * 0.4 + share;
  if (id === 'fortune') {
    const progress = Math.min(1, player.wealth / 100_000);
    return {
      id,
      name: '富甲一方',
      goal: '积攒十万铜币',
      progress,
      hint: `现有 ${player.wealth} 铜币`,
    };
  }
  if (id === 'power') {
    const progress = Math.min(1, influence);
    return {
      id,
      name: '权倾朝野',
      goal: '身居公职并握住一家字号的三分之一',
      progress,
      hint: `影响力 ${(influence * 100).toFixed(0)}%`,
    };
  }
  const renown = player.offices.length * 2 + Math.max(0, player.careerRank);
  const progress = Math.min(1, renown / 6);
  return {
    id,
    name: '名动四方',
    goal: '从行伍里挣出名声',
    progress,
    hint: `公职 ${player.offices.length} 席、生涯 ${player.careerRank}/3`,
  };
}

/** 章节：每十年一章，标题跟着玩家处境变。 */
export function chapterOf(state: WorldState): { index: number; title: string } {
  const player = state.characters[state.playerId];
  const year = Math.floor((state.clock.day - 1) / 360) + 1;
  const index = Math.floor((year - 1) / 10) + 1;
  if (!player) return { index, title: '无名之章' };
  const titles = ['少年得志', '渐入佳境', '风起云涌', '名动一方', '执掌乾坤', '功成名就'];
  const bucket = Math.min(
    titles.length - 1,
    Math.floor((player.wealth / 20_000 + player.offices.length * 0.6 + player.careerRank) / 1.5),
  );
  return { index, title: titles[bucket] ?? titles[0]! };
}

export function influenceLabel(state: WorldState): string {
  const player = state.characters[state.playerId];
  if (!player) return '—';
  const region = state.regions[player.regionId];
  return region?.countryId
    ? `${Math.round(influenceOf(state, player.id, region.countryId) * 100)}%`
    : '—';
}
