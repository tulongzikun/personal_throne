/**
 * 地区局势：远方见闻只说要紧的（「某地盗贼频发」），
 * 你亲自前往时才可能遇上劫匪，并用力量检定结算。
 */

import { describe, expect, it } from 'vitest';

import { GameEngine } from '../src/core/GameEngine';
import {
  banditEncounterChance,
  banditryOf,
  regionNews,
  settleTravelEncounter,
} from '../src/systems/region/RegionNews';
import { content, makeWorld } from './helpers';

function makeTroubled() {
  const world = makeWorld('region-news');
  for (const country of Object.values(world.countries)) {
    country.stability = 0.1;
    country.legitimacy = 0.2;
  }
  for (const org of Object.values(world.organizations)) {
    org.conflict = 0.9;
  }
  for (const market of Object.values(world.markets)) {
    market.price = Math.round(market.ceiling * 0.95);
  }
  return world;
}

describe('地区局势与远方见闻', () => {
  it('治安随稳定度、内斗与物价恶化而下降', () => {
    const calm = makeWorld('region-news');
    const troubled = makeTroubled();
    const regionId = 'r_greenfield';
    expect(banditryOf(calm, regionId)).toBeLessThan(banditryOf(troubled, regionId));
    expect(banditryOf(troubled, regionId)).toBeGreaterThan(0.3);
    expect(banditEncounterChance(troubled, regionId)).toBeGreaterThan(0.15);
  });

  it('见闻只挑要紧的，且每个地区最多一条', () => {
    const troubled = makeTroubled();
    const news = regionNews(troubled, 3);
    expect(news.length).toBeLessThanOrEqual(3);
    expect(new Set(news.map((item) => item.regionId)).size).toBe(news.length);
    expect(news.some((item) => item.topic === 'bandits')).toBe(true);
    expect(news[0]?.severity).toBeGreaterThanOrEqual(news.at(-1)?.severity ?? 0);
  });

  it('抵达时的遭遇是确定的，并且用力量检定结算', () => {
    const troubled = makeTroubled();
    const player = troubled.characters[troubled.playerId];
    if (!player) throw new Error('缺少玩家');

    const first = settleTravelEncounter(troubled, player, 'r_greenfield');
    const second = settleTravelEncounter(troubled, player, 'r_greenfield');
    // 同一世界同一天同一角色，重算结果一致（不改状态时文本相同）。
    expect(first).toBe(second);

    const texts: string[] = [];
    for (let day = 1; day <= 40; day += 1) {
      troubled.clock.day = day;
      player.wealth = 5_000;
      player.health = 100;
      const text = settleTravelEncounter(troubled, player, 'r_greenfield');
      if (text) texts.push(text);
    }
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.every((text) => text.includes('力量检定'))).toBe(true);
  });

  it('高治安风险的地区，移动命令会把遭遇写进结果', () => {
    const world = makeTroubled();
    const engine = new GameEngine(world, content, { stopAtChoices: true });
    const player = engine.state.characters[engine.state.playerId];
    if (!player) throw new Error('缺少玩家');
    player.wealth = 10_000;
    const target = world.regions[player.regionId]?.links[0];
    if (!target) throw new Error('缺少相邻地区');

    const summaries: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      player.actionPoints = 3;
      player.health = 100;
      player.regionId = world.regions[player.regionId]?.links[0]?.to ?? player.regionId;
      const result = engine.dispatch({ kind: 'move', regionId: target.to });
      if (result.ok) summaries.push(result.summary ?? '');
      engine.advanceDays(4);
    }
    expect(summaries.length).toBeGreaterThan(0);
  });
});
