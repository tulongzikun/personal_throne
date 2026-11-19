/**
 * R2：逐月推进与一次快进必须得到同一状态。
 * R3：存档 → 读档 → 继续模拟，必须与不间断模拟一致。
 *
 * 两者都依赖"所有随机数来自命名流"，而不是调用次数计数器。
 */

import { describe, expect, it } from 'vitest';
import { content, makeEngine } from './helpers/index';
import { DAYS_PER_MONTH } from '../src/core/GameClock';
import { GameEngine } from '../src/core/GameEngine';
import { parseSave, serializeSave } from '../src/storage/SaveManager';

describe('快进一致性（R2）', () => {
  it('逐月 120 次与一次推进 3600 天结果相同', () => {
    const stepwise = makeEngine('r2-seed');
    const oneShot = makeEngine('r2-seed');

    for (let month = 0; month < 120; month += 1) {
      stepwise.advanceDays(DAYS_PER_MONTH);
    }
    oneShot.advanceTo(DAYS_PER_MONTH * 120);

    expect(stepwise.day).toBe(oneShot.day);
    expect(stepwise.hash()).toBe(oneShot.hash());
  });

  it('拆分推进（1 年 + 9 年）与连续 10 年一致', () => {
    const split = makeEngine('r2-split');
    const continuous = makeEngine('r2-split');

    split.advanceDays(360);
    split.advanceDays(3240);
    continuous.advanceDays(3600);

    expect(split.hash()).toBe(continuous.hash());
  });
});

describe('存档往返（R3）', () => {
  it('存档 → 读档 → 继续 10 年，与直接继续一致', () => {
    const direct = makeEngine('r3-seed');
    direct.advanceDays(720);

    const resumed = makeEngine('r3-seed');
    resumed.advanceDays(720);

    const saved = serializeSave(resumed.state, 12345);
    const envelope = parseSave(saved, 12345);
    expect(envelope.seed).toBe('r3-seed');
    expect(envelope.day).toBe(resumed.day);
    expect(envelope.hash).toBe(resumed.hash());

    const restored = new GameEngine(envelope.state, content);
    restored.advanceDays(3600);
    direct.advanceDays(3600);

    expect(restored.hash()).toBe(direct.hash());
  }, 30_000);

  it('损坏的存档会被拒绝', () => {
    expect(() => parseSave('{not json')).toThrow(/JSON/);

    const engine = makeEngine('r3-bad');
    const text = serializeSave(engine.state, 0);
    // 篡改世界状态本身（种子也被哈希覆盖），解析时应拒绝。
    const tampered = text.split('"r3-bad"').join('"r3-evil"');
    expect(() => parseSave(tampered, 0)).toThrow(/哈希/);
  });
});
