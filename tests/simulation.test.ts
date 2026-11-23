/**
 * R1：同种子同命令的 100 年模拟必须完全一致。
 *
 * 这是整个项目最重要的一条回归：所有分叉（浮点误差、遍历顺序、
 * 未命名随机流）都会在这里变成哈希差异。
 */

import { describe, expect, it } from 'vitest';
import { content, makeEngine, makeWorld } from './helpers/index';
import { DAYS_PER_YEAR } from '../src/core/GameClock';
import { validateWorld } from '../src/core/WorldState';

describe('模拟确定性（R1）', () => {
  it('初始世界通过结构校验', () => {
    expect(validateWorld(makeWorld())).toEqual([]);
  });

  it('同种子 100 年两次模拟哈希一致', () => {
    const first = makeEngine('r1-seed');
    const second = makeEngine('r1-seed');

    first.advanceDays(DAYS_PER_YEAR * 100);
    second.advanceDays(DAYS_PER_YEAR * 100);

    expect(first.hash()).toBe(second.hash());
    expect(first.day).toBe(second.day);
  }, 90_000);

  it('100 年模拟后世界仍然自洽且数值有限', () => {
    const engine = makeEngine('r1-health');
    engine.advanceDays(DAYS_PER_YEAR * 100);
    const state = engine.state;

    expect(validateWorld(state)).toEqual([]);

    for (const [key, market] of Object.entries(state.markets)) {
      expect(Number.isFinite(market.price), key).toBe(true);
      expect(market.price).toBeGreaterThan(0);
      expect(market.stock).toBeGreaterThanOrEqual(0);
    }
    for (const [key, org] of Object.entries(state.organizations)) {
      expect(org.cash, key).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(org.cash), key).toBe(true);
    }
    for (const [key, country] of Object.entries(state.countries)) {
      expect(country.treasury, key).toBeGreaterThanOrEqual(0);
      expect(country.debt, key).toBeGreaterThanOrEqual(0);
    }
    // 100 年至少产出月度摘要（1200 条）级别的历史。
    expect(state.history.length).toBeGreaterThan(1200);
  }, 60_000);

  it('100 年快进在性能预算内（计划 §9.3 / D7：14 区 < 3.5s，门禁 4.0s）', () => {
    // 用 CPU 时间而不是墙钟：整套用例并行跑时，墙钟会被同机的其它测试拖长，
    // 而这条门禁要衡量的是模拟本身的算力成本。
    // 跑两次取更小的一次：第一次常被 JIT 预热与前序用例的 GC 拖慢，取最小值才是
    // 「这个模拟要多久」而不是「这台机器当时有多忙」。
    const measure = () => {
      const engine = makeEngine('r1-perf');
      const before = process.cpuUsage();
      const started = performance.now();
      engine.advanceDays(DAYS_PER_YEAR * 100);
      const wall = performance.now() - started;
      const cpu = process.cpuUsage(before);
      return { cpuMs: (cpu.user + cpu.system) / 1000, wall };
    };
    const first = measure();
    const second = measure();
    const best = second.cpuMs < first.cpuMs ? second : first;
    expect(
      best.cpuMs,
      `CPU ${best.cpuMs.toFixed(0)}ms / 墙钟 ${best.wall.toFixed(0)}ms（两次：${first.cpuMs.toFixed(0)}、${second.cpuMs.toFixed(0)}）`,
    ).toBeLessThan(4000);
  }, 120_000);

  it('不同种子会得到不同世界', () => {
    const a = makeEngine('seed-a');
    const b = makeEngine('seed-b');
    a.advanceDays(DAYS_PER_YEAR);
    b.advanceDays(DAYS_PER_YEAR);
    expect(a.hash()).not.toBe(b.hash());
  });

  it('世界内容包含 MVP 规模的实体', () => {
    expect(Object.keys(makeWorld().regions).length).toBeGreaterThanOrEqual(4);
    expect(Object.keys(makeWorld().organizations).length).toBe(21);
    expect(Object.keys(makeWorld().characters).length).toBe(54);
    expect(content.events.length).toBeGreaterThanOrEqual(22);
  });
});
