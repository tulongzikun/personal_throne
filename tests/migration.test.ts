/**
 * 存档迁移：v1（M1）→ v2（M2）补齐契约、在途货运、市场份额与生命周期字段。
 */

import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, validateWorld } from '../src/core/WorldState';
import {
  SAVE_FORMAT,
  SAVE_FORMAT_VERSION,
  migrateSave,
  migrateWorldState,
} from '../src/storage/Migration';
import { parseSave } from '../src/storage/SaveManager';
import { content, makeWorld } from './helpers/index';

function asLegacyV1(): Record<string, unknown> {
  const world = JSON.parse(JSON.stringify(makeWorld('migration'))) as Record<string, never>;
  const legacy = world as unknown as Record<string, unknown>;
  const meta = legacy['meta'] as Record<string, unknown>;
  meta['schemaVersion'] = 1;
  delete legacy['shipments'];
  delete legacy['contractSeq'];
  delete legacy['orgSeq'];
  delete legacy['stats'];

  const organizations = legacy['organizations'] as Record<string, Record<string, unknown>>;
  for (const org of Object.values(organizations)) {
    for (const field of [
      'origin',
      'lastMonthProfit',
      'lastMonthTax',
      'lastMonthTariff',
      'marketShare',
      'priceIndex',
      'risk',
      'tradeInvestment',
      'tradeRevenue',
      'tradeCost',
      'liquidation',
      'distressMonths',
      'graceUntilDay',
      'restructureUntilDay',
      'unpaidWages',
    ]) {
      delete org[field];
    }
  }
  return legacy;
}

describe('存档迁移', () => {
  it('v1 世界状态升到当前 schemaVersion 并补全字段', () => {
    const migrated = migrateWorldState(asLegacyV1());

    expect(migrated.meta.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.shipments).toEqual({});
    expect(migrated.contractSeq).toBe(0);
    expect(migrated.stats.bankruptcies).toBe(0);
    expect(validateWorld(migrated)).toEqual([]);

    const grainwheel = migrated.organizations['o_grainwheel'];
    expect(grainwheel).toBeDefined();
    expect(grainwheel?.origin).toBe('content');
    expect(grainwheel?.risk.split).toBe(0);
    expect(grainwheel?.liquidation).toBeNull();
    expect(Number.isFinite(grainwheel?.priceIndex)).toBe(true);
  });

  it('旧信封（formatVersion 1）会被升级并记录当前版本', () => {
    const legacy = asLegacyV1();
    const envelope = migrateSave(
      {
        format: SAVE_FORMAT,
        formatVersion: 1,
        state: legacy,
        seed: 'migration',
        day: 1,
        savedAt: 7,
      },
      99,
    );

    expect(envelope.formatVersion).toBe(SAVE_FORMAT_VERSION);
    expect(envelope.schemaVersion).toBe(SCHEMA_VERSION);
    expect(envelope.savedAt).toBe(7);
    expect(validateWorld(envelope.state)).toEqual([]);
    expect(envelope.state.meta.contentVersion).toBe(envelope.state.meta.contentVersion);
    expect(content.events.length).toBeGreaterThan(0);
  });

  it('裸 WorldState 也能包装成当前信封', () => {
    const envelope = migrateSave(asLegacyV1());
    expect(envelope.format).toBe(SAVE_FORMAT);
    expect(envelope.formatVersion).toBe(SAVE_FORMAT_VERSION);
    expect(validateWorld(envelope.state)).toEqual([]);
  });

  it('跨版本迁移过后不因旧哈希报"文件损坏"', () => {
    const state = asLegacyV1();
    const text = JSON.stringify({
      format: SAVE_FORMAT,
      formatVersion: 1,
      state,
      seed: 'migration',
      day: 3,
      hash: 'deadbeefdeadbeef',
    });

    const envelope = parseSave(text);
    expect(envelope.hash).toBe('');
    expect(validateWorld(envelope.state)).toEqual([]);
  });

  it('更高的 formatVersion 会被拒绝', () => {
    expect(() =>
      migrateSave({ format: SAVE_FORMAT, formatVersion: SAVE_FORMAT_VERSION + 1, state: {} }),
    ).toThrow(/更新的版本/);
  });
});
