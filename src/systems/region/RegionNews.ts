/**
 * 地区局势与「远方见闻」：世界新闻只挑重要的说。
 *
 * 与其把「某位陌生人在山道被伏击」一条条列出来，不如告诉玩家
 * 「绿野镇一带盗贼频发」——前者是噪声，后者既是情报，也解释了
 * 你亲自前往时为什么会遇到劫匪。
 */

import type { Character, WorldState } from '../../core/WorldState';
import { Random } from '../../core/Random';
import { rollCheck } from '../character/Check';

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export interface RegionNewsItem {
  readonly regionId: string;
  readonly topic: 'bandits' | 'famine' | 'unrest' | 'prosperity' | 'war';
  readonly title: string;
  readonly body: string;
  /** 0–1，越大越值得在见闻里排前面。 */
  readonly severity: number;
}

/** 地区治安：物价越高、组织越内斗、国家越不稳，路上越不太平。 */
export function banditryOf(state: WorldState, regionId: string): number {
  const region = state.regions[regionId];
  if (!region) return 0;
  const country = state.countries[region.countryId];

  let worstConflict = 0;
  for (const org of Object.values(state.organizations)) {
    if (org.homeRegionId !== regionId || org.lifecycle === 'dissolved') continue;
    worstConflict = Math.max(worstConflict, org.conflict ?? 0);
  }

  let inflation = 0;
  let count = 0;
  for (const market of Object.values(state.markets)) {
    if (market.regionId !== regionId) continue;
    inflation += Math.max(0, market.price / Math.max(1, market.floor) - 1);
    count += 1;
  }
  const averageInflation = count > 0 ? Math.min(0.6, inflation / count) : 0;
  const stability = country?.stability ?? 0.6;

  return clamp01(0.06 + 0.45 * (1 - stability) + 0.35 * worstConflict + 0.3 * averageInflation);
}

/** 你踏进这个地区时可能遇到劫匪的概率。 */
export function banditEncounterChance(state: WorldState, regionId: string): number {
  return Math.min(0.45, 0.05 + 0.55 * banditryOf(state, regionId));
}

/** 收集值得说给玩家听的地区见闻，按严重度取前几条。 */
export function regionNews(state: WorldState, limit = 3): RegionNewsItem[] {
  const items: RegionNewsItem[] = [];

  for (const region of Object.values(state.regions).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const country = state.countries[region.countryId];
    const banditry = banditryOf(state, region.id);
    if (banditry >= 0.24) {
      items.push({
        regionId: region.id,
        topic: 'bandits',
        title: `${region.name}一带盗贼频发`,
        body: '商队屡遭劫掠，路上的风声很紧；你若亲自前往，可能碰上劫匪（力量检定）。',
        severity: banditry,
      });
    }

    const grain = state.markets[`${region.id}:grain`];
    if (grain) {
      const ratio = grain.price / Math.max(1, grain.floor);
      if (ratio >= 1.25) {
        items.push({
          regionId: region.id,
          topic: 'famine',
          title: `${region.name}粮价飞涨`,
          body: `粮价已到基准的 ${Math.round(ratio * 100)}%，再涨下去要出乱子。`,
          severity: Math.min(1, ratio / 3),
        });
      } else if (ratio <= 0.85) {
        items.push({
          regionId: region.id,
          topic: 'prosperity',
          title: `${region.name}货价低迷`,
          body: `粮食只卖到基准的 ${Math.round(ratio * 100)}%，跑一趟贩运有利可图。`,
          severity: Math.min(0.5, (1 - ratio) * 2),
        });
      }
    }

    if (country && country.stability < 0.38) {
      items.push({
        regionId: region.id,
        topic: 'unrest',
        title: `${country.name}民怨渐起`,
        body: `稳定度跌到 ${Math.round(country.stability * 100)}%，街上开始有人砸铺子。`,
        severity: Math.min(1, 1 - country.stability),
      });
    }

    if (country && country.atWarWith && country.atWarWith.length > 0) {
      items.push({
        regionId: region.id,
        topic: 'war',
        title: `${country.name}战事未歇`,
        body: '征兵与加税接踵而来，商路时断时续。',
        severity: 0.7,
      });
    }
  }

  // 同一地区只说最要紧的一条；跨地区再按严重度排。
  const byRegion = new Map<string, RegionNewsItem>();
  for (const item of items) {
    const current = byRegion.get(item.regionId);
    if (!current || item.severity > current.severity) byRegion.set(item.regionId, item);
  }
  return [...byRegion.values()]
    .sort((a, b) => b.severity - a.severity || (a.title < b.title ? -1 : 1))
    .slice(0, Math.max(1, limit));
}

/** 供界面显示的「此地治安」文案。 */
export function banditryLabel(value: number): string {
  if (value >= 0.45) return '盗匪横行';
  if (value >= 0.28) return '不太平';
  if (value >= 0.15) return '偶有劫案';
  return '还算太平';
}

/**
 * 抵达后的路上遭遇：治安越差越可能遇上劫匪，力量检定决定能否护住钱袋。
 * 返回一句可写进历史的话；没有遭遇时返回 null。
 */
export function settleTravelEncounter(
  state: WorldState,
  character: Character,
  regionId: string,
): string | null {
  const chance = banditEncounterChance(state, regionId);
  if (chance <= 0) return null;
  const rng = new Random(`${state.meta.seed}:travel:${character.id}:${state.clock.day}`);
  const key = `${state.clock.day}:${regionId}`;
  if (!rng.chance({ stream: 'travel', entityId: character.id, periodKey: key }, chance))
    return null;

  const banditry = banditryOf(state, regionId);
  const difficulty = 10 + Math.round(banditry * 4);
  const result = rollCheck(rng, character, { attribute: 'physique', difficulty }, `travel:${key}`);
  if (result.success) return `途中遇到劫匪：${result.text}，你护住了钱袋`;
  const loss = Math.min(character.wealth, 40 + Math.round(banditry * 160));
  character.wealth -= loss;
  character.health = Math.max(10, character.health - 6);
  return `途中遇到劫匪：${result.text}，损失 ${loss} 铜并受了点伤`;
}
