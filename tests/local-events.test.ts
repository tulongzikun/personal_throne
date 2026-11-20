/**
 * M7 阶段 4：本地事件与世界门控。
 *
 * 验收：每国 ≥ 6 条本地事件；「石渡关雪崩」只发生在高谷。
 */

import { describe, expect, it } from 'vitest';

import {
  collectCandidates,
  eventText,
  eventTextForRefs,
  matchesWhen,
  targetCountryOf,
} from '../src/core/EventEngine';
import { GameEngine } from '../src/core/GameEngine';
import { content } from './helpers';
import { createWorld } from '../src/core/WorldState';

const LOCAL_PREFIX = 'ev_local_';

describe('本地事件', () => {
  it('每个国家至少 6 条本地事件', () => {
    const probe = createWorld(content, { seed: 'x', createdAt: 0 });
    for (const countryId of Object.keys(probe.countries)) {
      const local = content.events.filter(
        (event) =>
          event.id.startsWith(LOCAL_PREFIX) &&
          matchesWhen(probe, event.when, { scope: 'country', entityId: countryId }),
      );
      expect(local.length, countryId).toBeGreaterThanOrEqual(6);
    }
  });
  it('雪崩事件只在高谷成为候选', () => {
    const world = createWorld(content, { seed: 'gating', createdAt: 0 });
    const avalanche = content.events.find((event) => event.id === 'ev_country_vale_avalanche')!;
    expect(avalanche.when?.countryId).toBe('c_highvale');
    for (const countryId of ['c_kingdom', 'c_league', 'c_covenant']) {
      expect(
        matchesWhen(world, avalanche.when, { scope: 'country', entityId: countryId }),
        countryId,
      ).toBe(false);
    }
    expect(matchesWhen(world, avalanche.when, { scope: 'country', entityId: 'c_highvale' })).toBe(
      true,
    );
    const candidates = collectCandidates(world, content, 1, 3).filter(
      (candidate) => candidate.def.id === 'ev_country_vale_avalanche',
    );
    for (const candidate of candidates) {
      expect(targetCountryOf(world, candidate.target)).toBe('c_highvale');
    }
  });

  it('占位符换成国家名', () => {
    const world = createWorld(content, { seed: 'text', createdAt: 0 });
    const local = content.events.find((event) => event.id.includes('harvest_feast'))!;
    const text = eventText(world, local, { scope: 'country', entityId: 'c_kingdom' });
    expect(text.title).not.toContain('{country}');
    expect(text.title).toContain(world.countries['c_kingdom']!.name);
  });

  it('二十年模拟里至少 5 个国家触发过本地事件', () => {
    const world = createWorld(content, { seed: 'local-run', createdAt: 0 });
    const engine = new GameEngine(world, content);
    engine.advanceDays(360 * 20);
    const fired = new Set<string>();
    for (const record of world.history) {
      const eventId = record.causeEventId ?? '';
      if (!eventId.startsWith(LOCAL_PREFIX)) continue;
      for (const ref of record.refs) {
        if (ref.type === 'country') fired.add(ref.id);
      }
    }
    expect(fired.size).toBeGreaterThanOrEqual(5);
  });
  it('历史与弹窗里的标题、正文都不残留占位符', () => {
    const world = createWorld(content, { seed: 'local-placeholder', createdAt: 0 });
    const engine = new GameEngine(world, content);
    engine.advanceDays(360 * 3);
    let checked = 0;
    for (const record of world.history) {
      if (record.kind !== 'event' || !record.causeEventId) continue;
      const def = content.events.find((event) => event.id === record.causeEventId);
      if (!def) continue;
      const filled = eventTextForRefs(world, def, record.refs);
      expect(filled.title).not.toMatch(/{w+}/);
      expect(filled.body).not.toMatch(/{w+}/);
      expect(record.summary).not.toMatch(/{(country|place|subject)}/);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
