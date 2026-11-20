/* 世界状态根：元数据、统计、关系、军团、定时事件与结算上下文。 */

import type { Phase } from '../GameClock';
import type { HistoryRecord } from '../History';
import type { Random } from '../Random';
import type { Character } from './character';
import type { EventDef, PendingChoice } from './defs';
import type { Country, Region } from './country';
import type { Contract, Market, Shipment, ShipmentId } from './economy';
import type {
  ArmyId,
  CharacterId,
  ContractId,
  CountryId,
  EntityId,
  Family,
  FamilyId,
  MarketKey,
  OrgId,
  RegionId,
} from './ids';
import type { Organization } from './organization';

export interface WorldMeta {
  schemaVersion: number;
  contentVersion: string;
  seed: string;
  createdAt: number;
  worldId: string;
}

export interface WorldStats {
  bankruptcies: number;
  restructurings: number;
  splits: number;
  mergers: number;
  founded: number;
  dissolved: number;
  contractDefaults: number;
  priceDeviationSum: number;
  priceSamples: number;
  tariffRevenue: number;
  tradeRevenue: number;
  tradeCost: number;
  /** 组织税后净利润累计（经济闭合校验：Δ权益/净利润 应接近 1）。 */
  profitTotal: number;
  /** 累计分红（权益的合法流出，校验时加回）。 */
  dividendsPaid: number;
  orgCountSum: number;
  orgCountSamples: number;
  /** 政策三阶段的可观测统计（M3）。 */
  policyProposals: number;
  policyChanges: number;
  policyCost: number;
  /** 同一政策两次成功变更之间的最小间隔（天，0 = 尚无第二次）。 */
  minPolicyIntervalDays: number;
  polityChanges: number;
}

export interface Relation {
  from: string;
  to: string;
  type: 'rival' | 'ally' | 'family' | 'debt' | 'feud';
  value: number;
}

export type ArmyStance = 'defend' | 'march' | 'siege';

export interface Army {
  id: ArmyId;
  countryId: CountryId;
  size: number;
  locationRegionId: RegionId;
  morale: number;
  /** 训练度 0–1：征兵是 0.35，常备军随年度训练上升。 */
  training: number;
  /** 统帅（可为空，空缺时按 0 战术结算）。 */
  commanderId: CharacterId | null;
  stance: ArmyStance;
  /** 行军目标（stance = march 时有效）。 */
  targetRegionId: RegionId | null;
}

export type ScheduledKind = 'event' | 'contract' | 'interrupt';

export interface ScheduledEvent {
  day: number;
  phase: Phase;
  /** 入队序号，保证同日同相位稳定排序。 */
  seq: number;
  kind: ScheduledKind;
  refId: string;
  parentEventId: string | null;
  /** 后续事件的作用对象（继承自父事件；跨对象调度时由内容指定）。 */
  targetScope: EventDef['scope'] | null;
  targetEntityId: string | null;
  /** 事件链步序（排定时写入，执行时校验先后）。 */
  chainStep?: number;
}

export interface WorldState {
  meta: WorldMeta;
  clock: { day: number };
  playerId: CharacterId;
  characters: Record<CharacterId, Character>;
  organizations: Record<OrgId, Organization>;
  countries: Record<CountryId, Country>;
  regions: Record<RegionId, Region>;
  /** 键为 `${regionId}:${goodId}`。 */
  markets: Record<MarketKey, Market>;
  contracts: Record<ContractId, Contract>;
  shipments: Record<ShipmentId, Shipment>;
  relations: Relation[];
  armies: Record<ArmyId, Army>;
  tiers: Record<EntityId, 1 | 2 | 3>;
  pendingEvents: ScheduledEvent[];
  /** 等待抉择的事件（玩家点击或到期自动选）。 */
  pendingChoices: PendingChoice[];
  rngCounters: Record<string, number>;
  /** 事件冷却：`${eventId}@${entityId}` → 解禁日。 */
  cooldowns: Record<string, number>;
  history: HistoryRecord[];
  /** 已入队的调度序号，只增不减。 */
  scheduleSeq: number;
  /** 契约 ID 序号，只增不减。 */
  contractSeq: number;
  /** NPC 新建组织 ID 序号，只增不减。 */
  orgSeq: number;
  /** 无继承人时补位的统治者序号，只增不减。 */
  characterSeq: number;
  /** 家族表：M4 出生/婚姻时写入。 */
  families: Record<FamilyId, Family>;
  /** 已考察的市场：regionId → 情报到期日（含当日）。 */
  inspections: Record<RegionId, number>;
  stats: WorldStats;
}

export interface SettleContext {
  readonly day: number;
  /** 结算点键，如 `m120`（第 120 天 = 第 4 月月末附近的月度键）。 */
  readonly periodKey: string;
  readonly phase: Phase;
  readonly rng: Random;
}
