/**
 * 存档格式迁移。
 *
 * 两条版本线互不干扰：
 * - `formatVersion`：存档外壳（信封）的结构版本，本文件负责；
 * - `schemaVersion`：`WorldState` 的字段版本，由 `WorldState.ts` 的 `SCHEMA_VERSION` 定义。
 *
 * 迁移函数一律"纯函数 + 逐级升版"：v1 → v2 → v3，每步只做一件事，
 * 便于回归测试与问题定位。当前只有 v1，后续新增版本时在这里追加。
 */

import { SCHEMA_VERSION, type WorldState } from '../core/WorldState';
import type { SaveEnvelope } from './SaveManager';

export class SaveError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SaveError';
  }
}

/** 当前信封结构版本。 */
export const SAVE_FORMAT_VERSION = 1;
export const SAVE_FORMAT = 'throne-and-gold-save';

interface LegacyState extends Record<string, unknown> {
  meta?: { schemaVersion?: number };
}

/**
 * 把任意读入的原始对象升到当前信封版本。
 * 兼容两种历史形态：
 * - 裸 `WorldState`（早期手写存档）；
 * - 已带信封但 `formatVersion` 落后。
 */
export function migrateSave(raw: unknown, savedAt = 0): SaveEnvelope {
  if (typeof raw !== 'object' || raw === null) {
    throw new SaveError('存档内容不是对象');
  }
  const record = raw as Record<string, unknown>;

  if (record['format'] === SAVE_FORMAT) {
    const version = Number(record['formatVersion'] ?? 1);
    if (!Number.isInteger(version) || version < 1) {
      throw new SaveError(`未知的存档格式版本 ${String(record['formatVersion'])}`);
    }
    if (version > SAVE_FORMAT_VERSION) {
      throw new SaveError(`存档来自更新的版本（formatVersion ${version}），请升级游戏`);
    }
    const state = migrateWorldState(record['state']);
    return {
      format: SAVE_FORMAT,
      formatVersion: SAVE_FORMAT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      contentVersion: String(record['contentVersion'] ?? state.meta.contentVersion),
      savedAt: Number(record['savedAt'] ?? savedAt),
      seed: String(record['seed'] ?? state.meta.seed),
      day: Number(record['day'] ?? state.clock.day),
      hash: String(record['hash'] ?? ''),
      state,
    };
  }

  // 裸 WorldState：包装成当前信封。
  const state = migrateWorldState(record);
  return {
    format: SAVE_FORMAT,
    formatVersion: SAVE_FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    contentVersion: state.meta.contentVersion,
    savedAt,
    seed: state.meta.seed,
    day: state.clock.day,
    hash: '',
    state,
  };
}

/** 把 `WorldState` 从它的 `schemaVersion` 升到当前版本。 */
export function migrateWorldState(raw: unknown): WorldState {
  if (typeof raw !== 'object' || raw === null) {
    throw new SaveError('存档中缺少世界状态');
  }
  const state = raw as LegacyState;
  const version = Number(state.meta?.schemaVersion ?? 0);
  if (!Number.isInteger(version) || version < 1) {
    throw new SaveError('世界状态缺少合法的 schemaVersion');
  }
  if (version > SCHEMA_VERSION) {
    throw new SaveError(`存档 schemaVersion ${version} 高于当前 ${SCHEMA_VERSION}`);
  }
  if (version === SCHEMA_VERSION) return state as unknown as WorldState;

  throw new SaveError(`缺少 v${version} → v${SCHEMA_VERSION} 的迁移步骤`);
}
