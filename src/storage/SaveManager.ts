/**
 * 存档管理：信封结构、序列化/校验、IndexedDB 槽位与文件导出。
 *
 * 安全原则（计划 §7.7）：
 * - 读档必须校验（结构 + 引用完整性 + 哈希），失败给出可读原因；
 * - 存档就是 `WorldState` 的快照，不含任何"模拟中"的临时对象；
 * - 浏览器没有 IndexedDB 时降级为纯文件导出，不阻塞游戏。
 */

import { hashWorld, validateWorld, type WorldState } from '../core/WorldState';
import { SAVE_FORMAT, SAVE_FORMAT_VERSION, SaveError, migrateSave } from './Migration';

export interface SaveEnvelope {
  readonly format: typeof SAVE_FORMAT;
  readonly formatVersion: number;
  readonly schemaVersion: number;
  readonly contentVersion: string;
  readonly savedAt: number;
  readonly seed: string;
  readonly day: number;
  readonly hash: string;
  readonly state: WorldState;
}

export const AUTO_SLOT = 'auto';

/** 由当前状态生成存档信封（哈希用于读档时的完整性校验）。 */
export function createEnvelope(state: WorldState, savedAt = 0): SaveEnvelope {
  return {
    format: SAVE_FORMAT,
    formatVersion: SAVE_FORMAT_VERSION,
    schemaVersion: state.meta.schemaVersion,
    contentVersion: state.meta.contentVersion,
    savedAt,
    seed: state.meta.seed,
    day: state.clock.day,
    hash: hashWorld(state),
    state,
  };
}

export function serializeSave(state: WorldState, savedAt = 0): string {
  return JSON.stringify(createEnvelope(state, savedAt));
}

/** 解析并校验存档文本；任何时候都不返回半可信的状态。 */
export function parseSave(text: string, savedAt = 0): SaveEnvelope {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SaveError('存档不是合法的 JSON');
  }
  const envelope = migrateSave(raw, savedAt);
  const problems = validateWorld(envelope.state);
  if (problems.length > 0) {
    const head = problems.slice(0, 3).join('；');
    throw new SaveError(`存档校验失败（${problems.length} 项）：${head}`);
  }
  if (envelope.hash.length > 0 && hashWorld(envelope.state) !== envelope.hash) {
    throw new SaveError('存档哈希不一致，文件可能被修改或损坏');
  }
  return envelope;
}

/* ------------------------------------------------------------------ */
/* IndexedDB 槽位                                                       */
/* ------------------------------------------------------------------ */

const DB_NAME = 'throne-and-gold';
const DB_VERSION = 1;
const STORE_NAME = 'saves';

interface SaveRecord {
  slot: string;
  label: string;
  savedAt: number;
  day: number;
  json: string;
}

export interface SlotInfo {
  readonly slot: string;
  readonly label: string;
  readonly savedAt: number;
  readonly day: number;
}

export function storageAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'slot' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new SaveError('无法打开浏览器存档数据库'));
  });
}

function transaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    openDatabase().then((db) => {
      const tx = db.transaction(STORE_NAME, mode);
      const request = run(tx.objectStore(STORE_NAME));
      request.onsuccess = () => {
        resolve(request.result);
        db.close();
      };
      request.onerror = () => {
        reject(new SaveError('存档数据库操作失败'));
        db.close();
      };
    }, reject);
  });
}

export async function writeSlot(
  slot: string,
  state: WorldState,
  label: string,
  savedAt = 0,
): Promise<void> {
  const record: SaveRecord = {
    slot,
    label,
    savedAt,
    day: state.clock.day,
    json: serializeSave(state, savedAt),
  };
  await transaction('readwrite', (store) => store.put(record) as IDBRequest<IDBValidKey>);
}

export async function readSlot(slot: string): Promise<SaveEnvelope | null> {
  const record = (await transaction(
    'readonly',
    (store) => store.get(slot) as IDBRequest<SaveRecord | undefined>,
  )) as SaveRecord | undefined;
  if (!record) return null;
  return parseSave(record.json, record.savedAt);
}

export async function listSlots(): Promise<SlotInfo[]> {
  const records = (await transaction(
    'readonly',
    (store) => store.getAll() as IDBRequest<SaveRecord[]>,
  )) as SaveRecord[];
  return records
    .map((record) => ({
      slot: record.slot,
      label: record.label,
      savedAt: record.savedAt,
      day: record.day,
    }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

export async function deleteSlot(slot: string): Promise<void> {
  await transaction('readwrite', (store) => store.delete(slot) as IDBRequest<undefined>);
}

/* ------------------------------------------------------------------ */
/* 文件导入导出                                                         */
/* ------------------------------------------------------------------ */

/** 触发浏览器下载；无 DOM 环境（测试、CLI）时直接抛错，由调用方决定降级。 */
export function downloadSave(state: WorldState, filename = 'throne-and-gold-save.json'): void {
  if (typeof document === 'undefined') {
    throw new SaveError('当前环境不支持文件下载');
  }
  const blob = new Blob([serializeSave(state, 0)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function readSaveFile(file: File): Promise<SaveEnvelope> {
  const text = await file.text();
  return parseSave(text, 0);
}
