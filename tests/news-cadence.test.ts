/**
 * 远方见闻的播报节奏。
 *
 * 地区局势本身每天都可能变，但「世界在别处继续」这类汇总卡不该逐日弹窗；
 * 按月聚合一次即可（见 docs/redesign-v2.md「远方见闻按月聚合」）。
 */

import { describe, expect, it } from 'vitest';

import { monthIndex } from '../src/core/GameClock';
import { collectSignals, newSignalTracker } from '../src/ui/app/signalsFeed';
import type { SignalTracker } from '../src/ui/app/signalsFeed';
import type { WorldState } from '../src/core/WorldState';
import type { WorldSignal } from '../src/ui/EventDialog';
import { content, makeWorld } from './helpers';

/** 一个处处不太平的世界：保证地区见闻非空，这样才看得出「有没有弹」。 */
function troubledWorld(seed = 'news-cadence'): WorldState {
  const world = makeWorld(seed);
  for (const country of Object.values(world.countries)) {
    country.stability = 0.1;
    country.legitimacy = 0.2;
  }
  for (const org of Object.values(world.organizations)) org.conflict = 0.9;
  for (const market of Object.values(world.markets)) {
    market.price = Math.round(market.ceiling * 0.95);
  }
  return world;
}

function digestsOn(world: WorldState, tracker: SignalTracker, day: number): WorldSignal[] {
  world.clock.day = day;
  return collectSignals({ state: world, content, tracker }).filter(
    (signal) => signal.tone === 'digest',
  );
}

describe('远方见闻按月汇总', () => {
  it('月内逐日推进一次也不弹，只在跨月时弹一张', () => {
    const world = troubledWorld();
    const tracker = newSignalTracker(world);
    expect(monthIndex(1)).toBe(0);

    for (let day = 1; day <= 30; day += 1) {
      expect(digestsOn(world, tracker, day), `第 ${day} 天不该弹见闻`).toHaveLength(0);
    }

    // 第 31 天进入下一个月：这一张是本月唯一的一张。
    expect(digestsOn(world, tracker, 31)).toHaveLength(1);
    for (let day = 32; day <= 60; day += 1) {
      expect(digestsOn(world, tracker, day), `第 ${day} 天不该弹见闻`).toHaveLength(0);
    }
    expect(digestsOn(world, tracker, 61)).toHaveLength(1);
  });

  it('30× 一次跳 3 天时，跨月后仍补上且只补一次', () => {
    const world = troubledWorld();
    const tracker = newSignalTracker(world);
    let digests = 0;

    for (let day = 1; day <= 61; day += 3) {
      digests += digestsOn(world, tracker, day).length;
    }

    // 第 1 月 1 张（第 31 天那次）、第 2 月 1 张（第 61 天那次）。
    expect(digests).toBe(2);
  });

  it('读档落在月中时，不会立刻弹上一张旧见闻', () => {
    const world = troubledWorld();
    world.clock.day = 45;
    const tracker = newSignalTracker(world);

    expect(digestsOn(world, tracker, 45)).toHaveLength(0);
    expect(digestsOn(world, tracker, 60)).toHaveLength(0);
    expect(digestsOn(world, tracker, 61)).toHaveLength(1);
  });

  it('见闻内容仍是当月最要紧的几条，且不超过 3 条', () => {
    const world = troubledWorld();
    const tracker = newSignalTracker(world);
    world.clock.day = 31;

    const [digest] = digestsOn(world, tracker, 31);
    expect(digest?.items?.length).toBeGreaterThan(0);
    expect(digest?.items?.length).toBeLessThanOrEqual(3);
  });
});
