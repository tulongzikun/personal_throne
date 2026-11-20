/**
 * 一个月里同一事件刷屏是内容事故：同一取样周期同一事件最多触发一次，
 * 排定的后续也不能重复。
 */

import { describe, expect, it } from 'vitest';

import { GameEngine } from '../src/core/GameEngine';
import { createWorld } from '../src/core/WorldState';
import { content } from './helpers';

function monthOf(day: number): number {
  return Math.floor((day - 1) / 30);
}

describe('事件频率与去重', () => {
  it('同一个月里同一事件最多出现一次', () => {
    const world = createWorld(content, { seed: 'event-noise', createdAt: 0 });
    const engine = new GameEngine(world, content, { stopAtChoices: true });
    const seen = new Map<string, string[]>();

    for (let m = 0; m < 12; m += 1) {
      const before = engine.state.history.length;
      engine.advanceDays(30);
      const month = new Map<string, string[]>();
      for (const record of engine.state.history.slice(before)) {
        if (record.kind !== 'event') continue;
        const id = record.causeEventId ?? '?';
        month.set(id, [...(month.get(id) ?? []), record.summary]);
      }
      for (const [id, rows] of month) {
        expect(rows.length, `${monthOf(engine.state.clock.day)} 月重复事件 ${id}`).toBe(1);
        seen.set(id, rows);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
    // 一年里玩家至少会遇到一次「有事要你做」的选择事件。
    const player = engine.state.playerId;
    const own = engine.state.history.filter(
      (record) => record.kind === 'event' && record.refs.some((ref) => ref.id === player),
    );
    expect(own.length).toBeGreaterThanOrEqual(2);
  });

  it('排定的后续不会在同一天重复排队', () => {
    const world = createWorld(content, { seed: 'event-noise', createdAt: 0 });
    const engine = new GameEngine(world, content, { stopAtChoices: true });
    for (let m = 0; m < 24; m += 1) engine.advanceDays(30);

    const keys = engine.state.pendingEvents
      .filter((item) => item.kind === 'event')
      .map((item) => `${item.refId}@${item.targetEntityId ?? '?'}@${item.day}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
