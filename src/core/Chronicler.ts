/**
 * 编年史：把机器可读的记录翻译成「谁、在哪、做了什么」的叙事。
 *
 * 设计约束（docs/redesign-v2.md 阶段 4）：
 * - 历史记录必须带专名（人物/组织/国家/地区），不再出现裸 id；
 * - 记录要带主体（subject）与地点（place），供编年史面板筛选；
 * - 纯函数，不改状态，便于在任意记录点复用。
 */

import type { HistoryRef } from './History';
import type { Country, RegionId, WorldState } from './WorldState';

const ID_TOKEN = /[a-z]+_[a-z0-9_]+/g;

/**
 * 实体 id → 展示名（只读视图，调用方不得修改）。
 *
 * 缓存按 state 保存，失效由**显式调用** `invalidateEntityNames()` 触发，
 * 而不是猜一个启发式键。旧实现以「人物数量」当失效键：人数不变而改名
 * （迁移重算档案、未来加入改名功能）时会读到旧表。数量只是改名事件的
 * 一个必要不充分条件，不能当键。
 *
 * 全量实体不足百条，但 `record()` 每条历史都要查一次，100 年模拟会调用
 * 上万次——不缓存会让 sim 从 3.6 s 涨到 4.5 s，超出 D7 预算。
 */
const nameCache = new WeakMap<WorldState, Map<string, string>>();

/** 实体增删或改名后必须调用，否则编年史会继续用旧名字。 */
export function invalidateEntityNames(state: WorldState): void {
  nameCache.delete(state);
}

export function entityNames(state: WorldState): Map<string, string> {
  const cached = nameCache.get(state);
  if (cached) return cached;
  const names = new Map<string, string>();
  for (const region of Object.values(state.regions)) names.set(region.id, region.name);
  for (const country of Object.values(state.countries)) names.set(country.id, country.name);
  for (const org of Object.values(state.organizations)) names.set(org.id, org.name);
  for (const character of Object.values(state.characters)) names.set(character.id, character.name);
  nameCache.set(state, names);
  return names;
}

export function nameOf(state: WorldState, id: string): string | null {
  return entityNames(state).get(id) ?? null;
}

/** 主体所在地区：人物看所在地，组织看母地区，地区看自身，国家看人口最多的地区。 */
export function regionOfRef(state: WorldState, ref: HistoryRef): RegionId | null {
  if (ref.type === 'character') return state.characters[ref.id]?.regionId ?? null;
  if (ref.type === 'organization') return state.organizations[ref.id]?.homeRegionId ?? null;
  if (ref.type === 'region') return state.regions[ref.id] ? ref.id : null;
  if (ref.type === 'country') return seatOf(state, ref.id);
  return null;
}

/** 国家的「都城」：该国人口最多的地区。 */
function seatOf(state: WorldState, countryId: string): RegionId | null {
  const country: Country | undefined = state.countries[countryId];
  if (!country) return null;
  let best: RegionId | null = null;
  let population = -1;
  for (const id of country.regionIds) {
    const region = state.regions[id];
    if (region && region.population > population) {
      population = region.population;
      best = id;
    }
  }
  return best;
}

/** 把摘要里的裸 id 换成展示名（一次扫描，不做全表比对）。 */
export function humanize(state: WorldState, summary: string): string {
  const names = entityNames(state);
  return summary.replace(ID_TOKEN, (token) => names.get(token) ?? token);
}

export interface Chronicle {
  readonly summary: string;
  readonly subject: HistoryRef | null;
  readonly place: RegionId | null;
}

/**
 * 生成一条编年史：
 * 1. 裸 id → 专名；
 * 2. 取第一个可解析的 ref 作为主体、其所在地区作为地点；
 * 3. 若文本里仍没有任何专名，用「地点 · 主体：」补出来。
 */
export function composeChronicle(
  state: WorldState,
  summary: string,
  refs: readonly HistoryRef[],
): Chronicle {
  const names = entityNames(state);
  const text = humanize(state, summary);
  let subject: HistoryRef | null = null;
  let place: RegionId | null = null;
  for (const ref of refs) {
    if (names.has(ref.id)) {
      subject ??= ref;
      place ??= regionOfRef(state, ref);
    }
    if (subject && place) break;
  }
  if (!subject) {
    for (const ref of refs) {
      if (names.has(ref.id)) subject = ref;
    }
  }
  if (place) {
    // 只要发生过一次 id→名字替换，或文本里已经出现主体名，就算有专名；避免全表扫描。
    const subjectName = subject ? (names.get(subject.id) ?? null) : null;
    const anyName = text !== summary || (subjectName !== null && text.includes(subjectName));
    if (!anyName) {
      const prefixSubject = subjectName;
      const placeName = state.regions[place]?.name ?? null;
      const prefix = [placeName, prefixSubject].filter(Boolean).join(' · ');
      if (prefix) return { summary: `${prefix}：${text}`, subject, place };
    }
  } else if (subject && names.has(subject.id)) {
    const name = names.get(subject.id)!;
    if (!text.includes(name)) return { summary: `${name}：${text}`, subject, place };
  }
  return { summary: text, subject, place };
}
