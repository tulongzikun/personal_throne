/**
 * 月报（P1）：每月结算完，把「这个月发生了什么、下个月有什么要应付」写成一张小报。
 *
 * 它只读 `WorldState`，不读界面状态，也不掷骰子——同一局同样的月份，月报必须一模一样。
 * 文案从实体变化派生（谁拿走了什么、谁记恨了你），不写「国库为此支付了一笔开销」这类没有对象的句子。
 */

import type { WorldState } from './schema/state';
import { DAYS_PER_MONTH } from './GameClock';
import { monthlyUpkeep } from '../systems/character/Upkeep';

export interface MonthlyReport {
  /** 结算所在的最后一天。 */
  readonly day: number;
  readonly title: string;
  /** 这个月真正发生的事（带人名与数字）。 */
  readonly changes: readonly string[];
  /** 下个月要应付的事。 */
  readonly looming: readonly string[];
  /** 写进编年史的一段话。 */
  readonly body: string;
}

function playerRefs(state: WorldState): boolean {
  return state.playerId !== '';
}

/** 只扫数组尾部当月窗口：历史按日追加，100 年历史也不该每月全表过滤。 */
function recent(state: WorldState, from: number, day: number) {
  const out: WorldState['history'] = [];
  for (let index = state.history.length - 1; index >= 0; index -= 1) {
    const record = state.history[index]!;
    if (record.day < from) break;
    if (record.day <= day) out.push(record);
  }
  return out;
}

function pickChanges(state: WorldState, day: number): string[] {
  const from = day - DAYS_PER_MONTH + 1;
  const playerId = state.playerId;
  const monthRecords = recent(state, from, day);
  const mine = monthRecords.filter(
    (record) => record.importance !== 'minor' && record.refs.some((ref) => ref.id === playerId),
  );
  // 玩家自己的事优先；这个月什么都没做，就看你所在的组织/国家/地区发生了什么。
  const near = new Set<string>();
  const player = state.characters[state.playerId];
  if (player) {
    if (player.organizationId) near.add(player.organizationId);
    const region = state.regions[player.location.regionId];
    if (region) {
      near.add(region.id);
      if (region.countryId) near.add(region.countryId);
    }
  }
  const source =
    mine.length > 0
      ? mine
      : monthRecords.filter(
          (record) => record.importance !== 'minor' && record.refs.some((ref) => near.has(ref.id)),
        );
  const seen = new Set<string>();
  const picked: string[] = [];
  for (const record of [...source].reverse()) {
    if (seen.has(record.summary)) continue;
    seen.add(record.summary);
    picked.push(record.summary);
    if (picked.length >= 4) break;
  }
  return picked;
}

function pickLooming(state: WorldState, day: number): string[] {
  const player = state.characters[state.playerId];
  const lines: string[] = [];
  if (!player) return ['你已经不在了，后面的账由别人记。'];

  const pending = state.pendingChoices.filter(
    (choice) => choice.scope === 'character' && choice.entityId === player.id,
  ).length;
  if (pending > 0) lines.push(`还有 ${pending} 件没拿主意的事在等你`);

  if (player.health < 70) lines.push(`健康 ${player.health}，再硬撑下去就得躺下了`);

  const upkeep = monthlyUpkeep(player.wealth);
  if (player.wealth < upkeep * 2) {
    lines.push(`下个月的生活开销 ${upkeep} 铜，钱袋只剩 ${player.wealth} 铜`);
  }

  const org = player.organizationId ? state.organizations[player.organizationId] : null;
  if (org && org.unpaidWages > 0) {
    lines.push(`${org.name}还欠着 ${org.unpaidWages} 铜工钱，再不补发要出乱子`);
  }

  const country = Object.values(state.countries)
    .filter((item) => !item.extinct && item.rulerId === player.id)
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  if (country) lines.push(`${country.name}的国库还剩 ${country.treasury} 铜，账要一笔一笔看`);

  if (lines.length === 0) lines.push('眼下没有非做不可的事，可以按自己的节奏来');
  void day;
  return lines.slice(0, 4);
}

export function buildMonthlyReport(state: WorldState, day: number): MonthlyReport {
  if (!playerRefs(state)) {
    return { day, title: '第 0 月', changes: [], looming: [], body: '世界还没有主角。' };
  }
  const { year, month } = monthParts(day);
  const changes = pickChanges(state, day);
  const looming = pickLooming(state, day);
  const player = state.characters[state.playerId];
  const title = `第 ${month} 月 ${year} 年`;
  const body = [
    changes.length > 0 ? `这个月：${changes.join('；')}。` : '这个月没什么值得记的事。',
    looming.length > 0 ? `接下来：${looming.join('；')}。` : '',
    player ? `${player.name}：现金 ${player.wealth} 铜，健康 ${player.health}。` : '',
  ]
    .filter((line) => line !== '')
    .join('');

  return { day, title, changes, looming, body };
}

function monthParts(day: number): { year: number; month: number } {
  const absolute = Math.max(0, day - 1);
  const months = Math.floor(absolute / DAYS_PER_MONTH);
  return { year: Math.floor(months / 12) + 1, month: (months % 12) + 1 };
}
