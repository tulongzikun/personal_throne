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
export const SAVE_FORMAT_VERSION = 2;
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
    const rawState = record['state'] as Record<string, unknown> | undefined;
    const rawSchema = Number(
      (rawState?.['meta'] as Record<string, unknown> | undefined)?.['schemaVersion'] ?? 0,
    );
    const state = migrateWorldState(record['state']);
    // 发生过跨版本迁移时，旧哈希对应的已经不是同一份状态，丢弃它而不是报"文件损坏"。
    const hash = rawSchema === SCHEMA_VERSION ? String(record['hash'] ?? '') : '';
    return {
      format: SAVE_FORMAT,
      formatVersion: SAVE_FORMAT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      contentVersion: String(record['contentVersion'] ?? state.meta.contentVersion),
      savedAt: Number(record['savedAt'] ?? savedAt),
      seed: String(record['seed'] ?? state.meta.seed),
      day: Number(record['day'] ?? state.clock.day),
      hash,
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

/** 空的世界统计（v2 新增）。 */
function emptyStats(): Record<string, number> {
  return {
    bankruptcies: 0,
    restructurings: 0,
    splits: 0,
    mergers: 0,
    founded: 0,
    dissolved: 0,
    contractDefaults: 0,
    priceDeviationSum: 0,
    priceSamples: 0,
    tariffRevenue: 0,
    tradeRevenue: 0,
    tradeCost: 0,
    orgCountSum: 0,
    orgCountSamples: 0,
    policyProposals: 0,
    policyChanges: 0,
    policyCost: 0,
    minPolicyIntervalDays: 0,
    polityChanges: 0,
  };
}

/**
 * v1 → v2（M2 组织与经济）：补齐契约、在途货运、市场份额、四类风险与生命周期字段。
 * 只填补缺失字段，不覆盖已有值，因此对"半新半旧"的存档也安全。
 */
function migrateV1toV2(raw: Record<string, unknown>): void {
  const organizations = (raw['organizations'] ?? {}) as Record<string, Record<string, unknown>>;
  let maxNpc = 0;
  for (const [id, org] of Object.entries(organizations)) {
    const match = /^o_npc_(\d+)$/.exec(id);
    if (match) maxNpc = Math.max(maxNpc, Number(match[1]));
    org['origin'] ??= match ? 'npc' : 'content';
    org['lastMonthProfit'] ??= 0;
    org['lastMonthTax'] ??= 0;
    org['lastMonthTransport'] ??= 0;
    org['lastMonthTariff'] ??= 0;
    org['lastMonthTradeRevenue'] ??= 0;
    org['unpaidWages'] ??= 0;
    org['distressMonths'] ??= 0;
    org['graceUntilDay'] ??= 0;
    org['restructureUntilDay'] ??= 0;
    org['marketShare'] ??= 0;
    org['priceIndex'] ??= 1;
    org['risk'] ??= { split: 0, bankruptcy: 0, corruption: 0, unrest: 0 };
    org['tradeInvestment'] ??= 0;
    org['tradeRevenue'] ??= 0;
    org['tradeCost'] ??= 0;
    org['liquidation'] ??= null;
  }

  const markets = (raw['markets'] ?? {}) as Record<string, Record<string, unknown>>;
  for (const market of Object.values(markets)) {
    market['shareByOrg'] ??= {};
    market['routeOwnerId'] ??= null;
  }

  const rawContracts = raw['contracts'] ?? {};
  const contracts = (
    Array.isArray(rawContracts)
      ? rawContracts
      : Object.values(rawContracts as Record<string, unknown>)
  ) as Record<string, unknown>[];
  for (const contract of contracts) {
    contract['principal'] ??= contract['value'] ?? 0;
    contract['collateral'] ??= 0;
    contract['rateMonthly'] ??= 0;
    contract['nextDueDay'] ??= contract['endDay'] ?? 0;
    contract['installments'] ??= 1;
    contract['paidInstallments'] ??= 0;
    contract['quantity'] ??= 1;
    contract['unitPrice'] ??= 0;
    contract['penaltyRate'] ??= 0;
    contract['goodId'] ??= null;
  }

  raw['shipments'] ??= {};
  raw['contractSeq'] ??= 0;
  raw['orgSeq'] ??= maxNpc;
  raw['stats'] ??= emptyStats();
}

/** v2 → v3（M3 国家与政策）：补齐政策冷却、政体压力、内阁路线与进口计价字段。 */
function migrateV2toV3(raw: Record<string, unknown>): void {
  const countries = (raw['countries'] ?? {}) as Record<string, Record<string, unknown>>;
  for (const country of Object.values(countries)) {
    country['policyCooldowns'] ??= {};
    country['polityPressureMonths'] ??= 0;
    country['lastPolityChangeDay'] ??= 0;
    country['cabinetAction'] ??= null;
    country['cabinetUtility'] ??= 0;
    country['succession'] ??= country['polity'] === 'republic' ? 'elective' : 'primogeniture';
    country['offices'] ??= [];
  }

  const markets = (raw['markets'] ?? {}) as Record<string, Record<string, unknown>>;
  for (const market of Object.values(markets)) {
    market['importedUnits'] ??= 0;
  }

  const stats = raw['stats'];
  if (stats && typeof stats === 'object') {
    const record = stats as Record<string, unknown>;
    record['policyProposals'] ??= 0;
    record['policyChanges'] ??= 0;
    record['policyCost'] ??= 0;
    record['minPolicyIntervalDays'] ??= 0;
    record['polityChanges'] ??= 0;
  } else {
    raw['stats'] = emptyStats();
  }

  raw['characterSeq'] ??= 0;
}

/** 把 `WorldState` 从它的 `schemaVersion` 升到当前版本。 */
export function migrateWorldState(raw: unknown): WorldState {
  if (typeof raw !== 'object' || raw === null) {
    throw new SaveError('存档中缺少世界状态');
  }
  const state = raw as LegacyState & Record<string, unknown>;
  let version = Number(state.meta?.schemaVersion ?? 0);
  if (!Number.isInteger(version) || version < 1) {
    throw new SaveError('世界状态缺少合法的 schemaVersion');
  }
  if (version > SCHEMA_VERSION) {
    throw new SaveError(`存档 schemaVersion ${version} 高于当前 ${SCHEMA_VERSION}`);
  }

  while (version < SCHEMA_VERSION) {
    if (version === 1) {
      migrateV1toV2(state);
      version = 2;
      continue;
    }
    if (version === 2) {
      migrateV2toV3(state);
      version = 3;
      continue;
    }
    throw new SaveError(`缺少 v${version} → v${SCHEMA_VERSION} 的迁移步骤`);
  }

  const meta = state.meta;
  if (meta) meta.schemaVersion = SCHEMA_VERSION;
  return state as unknown as WorldState;
}
