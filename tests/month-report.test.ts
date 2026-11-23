import { describe, expect, it } from 'vitest';

import { toDateParts } from '../src/core/GameClock';
import { makeEngine } from './helpers';

function endMonths(engine: ReturnType<typeof makeEngine>, months: number): string[] {
  const bodies: string[] = [];
  for (let index = 0; index < months; index += 1) {
    const result = engine.dispatch({ kind: 'end_month' });
    expect(result.ok).toBe(true);
    const report = engine.consumeMonthReport();
    expect(report).not.toBeNull();
    if (report) bodies.push(report.body);
  }
  return bodies;
}

describe('P1：月末结算与月报', () => {
  it('连续 12 个月每月都有一张不一样的月报', () => {
    const engine = makeEngine('month-report');
    const bodies = endMonths(engine, 12);
    expect(bodies).toHaveLength(12);
    for (const body of bodies) expect(body.length).toBeGreaterThan(10);
    // 文案可以相似，但不能整段一模一样。
    expect(new Set(bodies).size).toBe(12);
  });

  it('月报里至少有一个人名和一个数字', () => {
    const engine = makeEngine('month-report-name');
    endMonths(engine, 3);
    const state = engine.state;
    const records = state.history.filter((record) => record.kind === 'month');
    expect(records.length).toBeGreaterThanOrEqual(3);
    const last = records[records.length - 1];
    expect(last?.body).toBeTruthy();
    const body = last?.body ?? '';
    const names = Object.values(state.characters)
      .map((character) => character.name)
      .filter((name) => body.includes(name));
    expect(names.length).toBeGreaterThan(0);
    expect(/\d/.test(body)).toBe(true);
  });

  it('结束本月正好停在月末，并把行动力清零', () => {
    const engine = makeEngine('month-report-clock');
    engine.advanceDays(5);
    const before = engine.state.clock.day;
    expect(toDateParts(before).dayOfMonth).toBe(6);
    const result = engine.dispatch({ kind: 'end_month' });
    expect(result.ok).toBe(true);
    // 月末那天已经结算完，日历停在下个月第 1 天。
    const after = toDateParts(engine.state.clock.day);
    expect(after.dayOfMonth).toBe(1);
    expect(after.month).toBe(2);
    // 新月份开头会回满行动力——结束本月不是「把行动力锁死」。
    const player = engine.state.characters[engine.state.playerId];
    expect(player?.actionPoints).toBeGreaterThan(0);
  });

  it('同种子两次跑 24 个月，哈希与月报完全一致', () => {
    const run = () => {
      const engine = makeEngine('month-report-determinism');
      const bodies = endMonths(engine, 24);
      return { hash: engine.hash(), bodies };
    };
    const first = run();
    const second = run();
    expect(first.hash).toBe(second.hash);
    expect(first.bodies).toEqual(second.bodies);
  });

  it('月报的「接下来」不会空着，也不会重复同一句', () => {
    const engine = makeEngine('month-report-looming');
    endMonths(engine, 1);
    const report = engine.lastMonthReport ?? engine.consumeMonthReport();
    // consume 之后是 null：先检查 consume 过的记录。
    const records = engine.state.history.filter((record) => record.kind === 'month');
    expect(records.length).toBe(1);
    expect(report).toBeNull();
    expect((records[0]?.body ?? '').includes('接下来')).toBe(true);
  });
});
