/**
 * 世界状态的**类型层**：ID、实体、内容、事件与状态 schema，以及少量纯常量。
 *
 * 这一层只有 `type` / `interface` / `const` 声明，不含任何逻辑，因此可以被
 * 任何模块（包括 systems 与 ui）安全地 `import type` 而不引入运行时依赖。
 * 逻辑（工厂 / 校验 / 哈希）在 `WorldState.ts`；对外仍然只用
 * `from './WorldState'` 一个入口，见那边的 re-export。
 *
 * 约定（见开发计划 §6）：
 * - 金额一律整数"铜币"；
 * - 0–1 的抽象指标（合法性、冲突、治理、效率）内部用 0–1 浮点，展示层再乘 100；
 * - 所有 ID 为稳定字符串，不使用自增数字；
 * - 时间只存 `day`（1 起），年月日由 GameClock 派生。
 */

export { SCHEMA_VERSION, ATTRIBUTE_KEYS, SITE_KINDS } from './schema/ids';
export type {
  CharacterId,
  OrgId,
  CountryId,
  RegionId,
  GoodId,
  MarketKey,
  ContractId,
  ArmyId,
  EntityId,
  AttributeKey,
  Attributes,
  SiteKind,
  Alignment,
  FamilyId,
  Family,
} from './schema/ids';
export type {
  Sex,
  CharacterLocation,
  CharacterOffice,
  CharacterDef,
  Character,
} from './schema/character';
export type {
  OrgType,
  OrgStrategy,
  OrgLifecycle,
  OrganizationDef,
  Organization,
  LiquidationRecord,
} from './schema/organization';
export type {
  CountryOffice,
  Polity,
  SuccessionMode,
  Terrain,
  RegionLinkDef,
  PolicyVector,
  RegionDef,
  Region,
  CountryDef,
  Country,
} from './schema/country';
export type {
  GoodDef,
  Market,
  ContractStatus,
  ContractKind,
  Contract,
  ShipmentId,
  Shipment,
  TradeFlow,
} from './schema/economy';
export type {
  WorldDef,
  BalanceConfig,
  RiskTable,
  CondExpr,
  Expr,
  RiskTerm,
  StatKey,
  Effect,
  EventWhen,
  ChoiceCheck,
  ChoiceDef,
  EventChainRef,
  FollowUpDef,
  EventDef,
  PendingChoice,
  FaithDef,
  BackgroundDef,
  CultureNames,
  NamePools,
  WorldContent,
} from './schema/defs';
export type {
  WorldMeta,
  WorldStats,
  Relation,
  ArmyStance,
  Army,
  ScheduledKind,
  ScheduledEvent,
  WorldState,
  SettleContext,
} from './schema/state';
