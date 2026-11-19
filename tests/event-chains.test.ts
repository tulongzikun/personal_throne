/**
 * M4.4 事件链：后续事件只能由父事件排定，且可带概率与条件。
 */

import { describe, expect, it } from 'vitest';
import { makeEngine, makeWorld, content } from './helpers/index';
import {
  applyEvent,
  collectCandidates,
  readFeature,
  scheduleFollowUps,
} from '../src/core/EventEngine';
import type { EventDef, WorldState } from '../src/core/WorldState';
import { Random } from '../src/core/Random';

const eventById = (id: string): EventDef => {
  const def = content.events.find((event) => event.id === id);
  if (!def) throw new Error(`未知事件 ${id}`);
  return def;
};

describe('事件链', () => {
  it('链条第二步及以后不进入随机候选', () => {
    const world = makeWorld();
    const candidates = collectCandidates(world, content, 400, 3);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((candidate) => (candidate.def.chain?.step ?? 0) <= 1)).toBe(true);
  });

  it('父事件按延迟排定后续事件，并记录父事件与步序', () => {
    const world = makeWorld();
    const rng = new Random(world.meta.seed);
    const def = eventById('ev_country_unrest');
    const target = { scope: 'country' as const, entityId: 'c_kingdom' };
    applyEvent(world, content, { def, target }, rng);

    const pending = world.pendingEvents.filter((event) => event.refId === 'ev_country_riot');
    expect(pending).toHaveLength(1);
    const first = pending[0]!;
    expect(first.day).toBe(world.clock.day + 20);
    expect(first.parentEventId).toBe('ev_country_unrest');
    expect(first.chainStep).toBe(2);
    expect(first.targetEntityId).toBe('c_kingdom');
  });

  it('概率为 0 时不排定，概率为 1 时必排定', () => {
    const world = makeWorld();
    const rng = new Random(world.meta.seed);
    const target = { scope: 'organization' as const, entityId: 'o_leaguebank' };

    const zero: EventDef = {
      ...eventById('ev_org_debt_spiral'),
      id: 'test_zero',
      followUps: [{ eventId: 'ev_org_debt_default', delayDays: 10, chance: 0 }],
    };
    expect(scheduleFollowUps(world, zero, target, rng)).toHaveLength(0);

    const sure: EventDef = {
      ...eventById('ev_org_debt_spiral'),
      id: 'test_sure',
      followUps: [{ eventId: 'ev_org_debt_default', delayDays: 10, chance: 1 }],
    };
    expect(scheduleFollowUps(world, sure, target, rng)).toHaveLength(1);
  });

  it('后续事件的条件按目标实体求值', () => {
    const world = makeWorld();
    const rng = new Random(world.meta.seed);
    const def = eventById('ev_adv_ambush');
    const target = { scope: 'character' as const, entityId: world.playerId };

    const player = world.characters[world.playerId]!;
    player.skills.melee = 1;
    expect(scheduleFollowUps(world, def, target, rng)).toHaveLength(0);

    player.skills.melee = 6;
    expect(scheduleFollowUps(world, def, target, rng)).toHaveLength(1);
  });

  it('history.<eventId> 统计目标实体近一年经历该事件的次数', () => {
    const world = makeWorld();
    const target = { scope: 'country' as const, entityId: 'c_league' };
    expect(readFeature(world, target, 'history.ev_country_unrest')).toBe(0);

    world.history.push(
      {
        id: 1,
        day: world.clock.day - 5,
        phase: 4,
        kind: 'event',
        summary: 'x',
        refs: [{ type: 'country', id: 'c_league' }],
        causeEventId: 'ev_country_unrest',
      },
      {
        id: 2,
        day: world.clock.day - 900,
        phase: 4,
        kind: 'event',
        summary: 'y',
        refs: [{ type: 'country', id: 'c_league' }],
        causeEventId: 'ev_country_unrest',
      },
      {
        id: 3,
        day: world.clock.day - 2,
        phase: 4,
        kind: 'event',
        summary: 'z',
        refs: [{ type: 'country', id: 'c_kingdom' }],
        causeEventId: 'ev_country_unrest',
      },
    );
    expect(readFeature(world, target, 'history.ev_country_unrest')).toBe(1);
  });

  it('引擎按时执行排定的后续事件，步序不符的排程被丢弃', () => {
    const engine = makeEngine();
    const world: WorldState = engine.state;
    world.scheduleSeq += 1;
    world.pendingEvents.push({
      day: world.clock.day + 1,
      phase: 4,
      seq: world.scheduleSeq,
      kind: 'event',
      refId: 'ev_country_riot',
      parentEventId: 'ev_country_unrest',
      targetScope: 'country',
      targetEntityId: 'c_kingdom',
      chainStep: 2,
    });
    world.scheduleSeq += 1;
    world.pendingEvents.push({
      day: world.clock.day + 1,
      phase: 4,
      seq: world.scheduleSeq,
      kind: 'event',
      refId: 'ev_country_martial_law',
      parentEventId: 'ev_country_riot',
      targetScope: 'country',
      targetEntityId: 'c_kingdom',
      chainStep: 9,
    });

    const before = world.history.length;
    engine.advanceDays(2);
    const fired = world.history
      .slice(before)
      .filter((record) => record.causeEventId === 'ev_country_riot');
    expect(fired).toHaveLength(1);
    expect(world.history.some((record) => record.causeEventId === 'ev_country_martial_law')).toBe(
      false,
    );
  });
});
