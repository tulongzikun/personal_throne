/* 外壳常量与轻量类型：标签页、时间速度、顶栏/时间条句柄。 */

import { describeCheck } from '../../systems/character/Check';
import type { ChoiceDef, ScheduledEvent, WorldState } from '../../core/WorldState';

export type TabId = 'region' | 'character' | 'organization' | 'country' | 'army' | 'history';
export type Speed = 0 | 1 | 7 | 30;

export const TABS: readonly { readonly id: TabId; readonly label: string }[] = [
  { id: 'region', label: '地区' },
  { id: 'character', label: '人物' },
  { id: 'organization', label: '组织' },
  { id: 'country', label: '国家' },
  { id: 'army', label: '军团' },
  { id: 'history', label: '历史' },
];

export const SPEED_KEYS: Record<1 | 7 | 30, string> = { 1: '1', 7: '2', 30: '3' };

/** 数字键 1/2/3 对应 1×/7×/30×，4 暂停。 */
export const KEY_SPEEDS: Readonly<Record<string, Speed>> = { '1': 1, '2': 7, '3': 30, '4': 0 };

export const SPEED_CONFIG: Record<
  1 | 7 | 30,
  { readonly interval: number; readonly days: number }
> = {
  1: { interval: 1000, days: 1 },
  7: { interval: 250, days: 1 },
  30: { interval: 100, days: 3 },
};

export interface TopbarRefs {
  readonly date: HTMLElement;
  readonly cash: HTMLElement;
  readonly cashDelta: HTMLElement;
  readonly health: HTMLElement;
  readonly healthDelta: HTMLElement;
  readonly daysLeft: HTMLElement;
  readonly speed: HTMLElement;
  readonly toast: HTMLElement;
}

export interface TimebarRefs {
  readonly element: HTMLElement;
  readonly hint: HTMLElement;
}

export function signalKey(event: ScheduledEvent): string {
  return `${event.day}:${event.seq}:${event.refId}`;
}

/** 抉择按钮上的提示：先写规则（看哪个属性、门槛多少），再写后果。 */
export function choiceHint(state: WorldState, choice: ChoiceDef): string {
  const player = state.characters[state.playerId];
  if (!choice.check || !player) return choice.hint ?? '';
  const rule = describeCheck(player, choice.check);
  return choice.hint ? `${choice.hint} · ${rule}` : rule;
}
