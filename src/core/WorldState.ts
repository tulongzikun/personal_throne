/**
 * 世界状态：权威数据类型、工厂、校验与规范哈希。
 *
 * 约定（见开发计划 §6）：
 * - 金额一律整数"铜币"；
 * - 0–1 的抽象指标（合法性、冲突、治理、效率）内部用 0–1 浮点，展示层再乘 100；
 * - 所有 ID 为稳定字符串，不使用自增数字；
 * - 时间只存 `day`（1 起），年月日由 GameClock 派生。
 */

import { DAYS_PER_MONTH, type Phase } from './GameClock';
import type { HistoryRecord } from './History';
import { fnv1a64, Random } from './Random';

export type CharacterId = string;
export type OrgId = string;
export type CountryId = string;
export type RegionId = string;
export type GoodId = string;
export type MarketKey = string;
export type ContractId = string;
export type ArmyId = string;
export type EntityId = string;

export const SCHEMA_VERSION = 8;

/* ------------------------------------------------------------------ */
/* 人物档案（schema，M4）                                               */
/* ------------------------------------------------------------------ */

/** 六维属性：1–20 整数，人类均值 10。 */
export const ATTRIBUTE_KEYS = [
  'physique',
  'agility',
  'intellect',
  'willpower',
  'perception',
  'charisma',
] as const;
export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];
export type Attributes = Record<AttributeKey, number>;

/** 人物所在地点的粒度（M5 再细化到城区）。 */
export const SITE_KINDS = ['city', 'town', 'village', 'road', 'court', 'camp', 'sea'] as const;
export type SiteKind = (typeof SITE_KINDS)[number];

/** 阵营双轴：`law` 守序(+)↔混乱(−)，`good` 善良(+)↔邪恶(−)，各 −100..100。 */
export interface Alignment {
  law: number;
  good: number;
}

export type FamilyId = string;

/** 家族：只承载姓氏与文化，继承判定走 `parentIds`/`spouseId`。 */
export interface Family {
  id: FamilyId;
  name: string;
  culture: string;
  memberIds: CharacterId[];
}

export interface CharacterLocation {
  regionId: RegionId;
  site: SiteKind;
  sinceDay: number;
}

/** 人物担任的公职；`CountryOffice` 是国家侧视图，这里是人物侧履历。 */
export interface CharacterOffice {
  id: string;
  countryId: CountryId | null;
  orgId: OrgId | null;
  title: string;
  /** 0 最高（君主/执政），3 最低（文书）。 */
  rank: number;
  salaryMonthly: number;
  sinceDay: number;
}

/** 人物性别：只影响婚姻与生育结算，不参与数值。 */
export type Sex = 'male' | 'female';

/* ------------------------------------------------------------------ */
/* 静态内容（schema）                                                   */
/* ------------------------------------------------------------------ */

export type OrgType = 'guild' | 'company' | 'mercenary' | 'noble_house' | 'smugglers' | 'bank';
export type OrgStrategy = 'expand' | 'steady' | 'contract' | 'pivot';
export type OrgLifecycle =
  | 'founded'
  | 'growing'
  | 'stable'
  | 'expanding'
  | 'crisis'
  | 'restructuring'
  | 'shrinking'
  | 'dissolved';
export type Polity = 'monarchy' | 'republic';
export type SuccessionMode = 'primogeniture' | 'elective' | 'council';

/** 国家公职：M3 只保留结构，M4 的事件/议会模型再填充。 */
export interface CountryOffice {
  id: string;
  title: string;
  holderId: CharacterId;
  /** 0–1，供政策支持度与事件使用。 */
  influence: number;
  salaryMonthly: number;
}
export type Terrain = 'city' | 'plains' | 'mountains' | 'coast' | 'forest';

export interface GoodDef {
  readonly id: GoodId;
  readonly name: string;
  readonly basePrice: number;
  /** 价格调整系数 α。 */
  readonly alpha: number;
  readonly floorRatio: number;
  readonly ceilingRatio: number;
  /** 人均月消费量（单位：件/人·月）。 */
  readonly consumptionPerCapita: number;
  /** 本地自给比例（0–1）：这部分需求由小农/家庭作坊满足，不需要组织产能。 */
  readonly subsistenceShare?: number;
}

export interface RegionLinkDef {
  readonly to: RegionId;
  readonly days: number;
  readonly capacity: number;
}

export interface RegionDef {
  readonly id: RegionId;
  readonly name: string;
  readonly countryId: CountryId;
  readonly population: number;
  readonly terrain: Terrain;
  readonly x: number;
  readonly y: number;
  readonly links: readonly RegionLinkDef[];
}

export interface CharacterDef {
  readonly id: CharacterId;
  readonly name: string;
  readonly raceId: string;
  readonly classId: string;
  readonly age: number;
  readonly regionId: RegionId;
  readonly organizationId: OrgId | null;
  readonly wealth: number;
  readonly skills: Readonly<Record<string, number>>;
  readonly traits: Readonly<Record<string, number>>;
  /* ---- 档案字段（全部可选，缺省由 createWorld 补齐） ---- */
  /** 文化名池标识（对应 names.json 的 cultures 键）。 */
  readonly culture?: string;
  readonly sex?: Sex;
  readonly faithId?: string | null;
  readonly alignment?: Alignment;
  readonly attributes?: Partial<Attributes>;
  readonly familyId?: FamilyId | null;
  readonly generation?: number;
  readonly parentIds?: readonly [CharacterId | null, CharacterId | null];
  readonly spouseId?: CharacterId | null;
  readonly location?: {
    readonly regionId: RegionId;
    readonly site?: SiteKind;
    readonly sinceDay?: number;
  };
  readonly offices?: readonly CharacterOffice[];
  /** 生涯阶梯等级（0 起步 … 3 顶尖），见 systems/character/Career.ts。 */
  readonly careerRank?: number;
  readonly careerSinceDay?: number;
  readonly health?: number;
  readonly actionPoints?: number;
  readonly deposits?: Record<string, number>;
}

export interface OrganizationDef {
  readonly id: OrgId;
  readonly name: string;
  readonly type: OrgType;
  readonly industry: GoodId | 'service';
  readonly foundedDay: number;
  readonly homeRegionId: RegionId;
  readonly scale: number;
  readonly cash: number;
  readonly assets: number;
  readonly liabilities: number;
  readonly members: number;
  readonly payrollMonthly: number;
  readonly leaderId: CharacterId;
  readonly legitimacy: number;
  readonly conflict: number;
  readonly governance: number;
  readonly efficiency: number;
  readonly strategy: OrgStrategy;
  readonly lifecycle: OrgLifecycle;
  readonly shares: readonly { readonly characterId: CharacterId; readonly share: number }[];
}

export interface PolicyVector {
  taxRate: number;
  tariffRate: number;
  militaryShare: number;
  tradeFreedom: number;
  regulation: number;
}

export interface CountryDef {
  readonly id: CountryId;
  readonly name: string;
  readonly polity: Polity;
  readonly population: number;
  readonly treasury: number;
  readonly monthlyRevenue: number;
  readonly monthlyExpense: number;
  readonly debt: number;
  readonly military: number;
  readonly legitimacy: number;
  readonly stability: number;
  readonly rulerId: CharacterId;
  readonly policies: PolicyVector;
}

export interface WorldDef {
  readonly id: string;
  readonly startDay: number;
  readonly playerId: CharacterId;
  readonly regions: readonly RegionDef[];
  readonly characters: readonly CharacterDef[];
}

export interface BalanceConfig {
  readonly economy: {
    readonly consumptionPerCapitaScale: number;
    readonly productionPerWorker: number;
    readonly stockMonthsTarget: number;
    readonly priceAdjustFloor: number;
    readonly priceAdjustCeiling: number;
  };
  readonly finance: {
    readonly interestRateMonthly: number;
    readonly profitTaxRate: number;
    readonly adminRateOfRevenue: number;
    readonly payrollPerMember: number;
  };
  readonly events: {
    readonly samplingDays: number;
    readonly defaultCooldownDays: number;
  };
  readonly tiers: {
    readonly promoteThreshold: number;
    readonly demoteThreshold: number;
    readonly distanceWeight: number;
    readonly relationWeight: number;
    readonly scaleWeight: number;
    readonly focusWeight: number;
  };
  /**
   * 四类组织风险的系数表（GDD §7.3）。代码只读表，不写死系数：
   *   hazard = lambda0 × exp(Σ coef × feature)，risk = clamp01(hazard × scale)
   * feature 由 EventEngine.readFeature 提供（conflict、legitimacy、cashRatio…）。
   */
  readonly risk: {
    readonly split: RiskTable;
    readonly bankruptcy: RiskTable;
    readonly corruption: RiskTable;
    readonly unrest: RiskTable;
  };
  readonly contract: {
    /** 违约时按未履行金额收取的违约金比例。 */
    readonly defaultPenaltyRate: number;
    /** 资不抵债后的宽限月数（宽限期内仍可融资自救）。 */
    readonly graceMonths: number;
    /** 重组期最长月数，逾期仍不清偿则进入清算。 */
    readonly restructureMonths: number;
    /** 清算时资产的变现折扣（0–1）。 */
    readonly liquidationHaircut: number;
    /** 新增贷款月利率（在 take_loan 中写入契约）。 */
    readonly loanRateMonthly: number;
    readonly maxLoanMonths: number;
    readonly minPenalty: number;
  };
  readonly market: {
    /** 吸引力 = (0.5+质量)^w · (0.5+商誉)^w / 价格指数^w。 */
    readonly qualityWeight: number;
    readonly reputationWeight: number;
    readonly priceWeight: number;
    /** 价格高于基准价该倍数时，NPC 竞争者可能进入。 */
    readonly entryPriceRatio: number;
    readonly maxOrgsPerMarket: number;
    readonly entryCapital: number;
  };
  readonly trade: {
    readonly unitTransportCost: number;
    /** 在途损耗比例（0–1）。 */
    readonly lossRate: number;
    readonly tariffEnabled: boolean;
  };
  /** 战争参数（M6）：征兵成本、维持费、伤亡区间、厌战与围城节奏。 */
  readonly war: {
    readonly levyCostPerSoldier: number;
    readonly upkeepPerSoldier: number;
    readonly casualtyMin: number;
    readonly casualtyMax: number;
    readonly exhaustionPerMonth: number;
    readonly occupationMonths: number;
    readonly peaceExhaustion: number;
    readonly trainingPerMonth: number;
    readonly desertionRate: number;
  };
  /**
   * 政策三阶段的校准参数（M3）：
   * 压力 → 提案（成本 + 冷却）→ 按政体决策；政权更迭只在长期崩溃时发生。
   */
  readonly policy: {
    /** 同一国家同一政策的变更冷却（月）。 */
    readonly cooldownMonths: number;
    /** 提案的固定行政成本（铜币）。 */
    readonly proposalCostBase: number;
    /** 提案成本占月收入的比率。 */
    readonly proposalCostRate: number;
    /** 压力 × 0.5 + 支持度 × 0.6 达到该阈值才通过。 */
    readonly supportThreshold: number;
    /** 压力强度低于该值不进入表决（避免财政小波动引发每月改革）。 */
    readonly minPressure: number;
    /** 单轮单政策的最大变更幅度。 */
    readonly maxDeltaPerRound: number;
    /** 政权更迭条件需要连续满足的月数。 */
    readonly polityChangeMonths: number;
    readonly polityChangeLegitimacy: number;
    readonly polityChangeStability: number;
    readonly polityChangeDebtRatio: number;
    /** 两次政权更迭的最小间隔（月）。 */
    readonly polityChangeCooldownMonths: number;
    /** 满足条件后的单次判定概率。 */
    readonly polityChangeChance: number;
  };
}

export interface RiskTable {
  /** 基准月度风险率。 */
  readonly lambda0: number;
  readonly terms: readonly RiskTerm[];
  /** 风险率 → 0–1 展示指数的放大倍数。 */
  readonly scale: number;
}

/* ------------------------------------------------------------------ */
/* 事件定义（受限 DSL）                                                 */
/* ------------------------------------------------------------------ */

export interface CondExpr {
  readonly path: string;
  readonly op: '>' | '>=' | '<' | '<=' | '==' | '!=';
  readonly value: number;
}

export type Expr =
  | { readonly all: readonly Expr[] }
  | { readonly any: readonly Expr[] }
  | { readonly not: Expr }
  | CondExpr;

export interface RiskTerm {
  /** 归一化状态变量路径，如 `org.conflict`。 */
  readonly path: string;
  readonly coef: number;
}

export type StatKey =
  | 'bankruptcies'
  | 'restructurings'
  | 'splits'
  | 'mergers'
  | 'founded'
  | 'dissolved'
  | 'contractDefaults';

export type Effect =
  | { readonly kind: 'add'; readonly path: string; readonly value: number }
  | { readonly kind: 'mul'; readonly path: string; readonly value: number }
  | { readonly kind: 'set'; readonly path: string; readonly value: number }
  | { readonly kind: 'schedule'; readonly eventId: string; readonly inDays: number }
  /** 并购：被作用组织并入同地区同行业资产最大的竞争者，随后注销。 */
  | { readonly kind: 'merge' }
  /** 统计计数（分裂、并购等），供 sim 与 UI 观测。 */
  | { readonly kind: 'stat'; readonly key: StatKey; readonly value: number };

export interface EventDef {
  readonly id: string;
  readonly domain: 'organization' | 'country' | 'economy' | 'adventure';
  readonly scope: 'organization' | 'country' | 'region' | 'character';
  readonly conditions?: Expr;
  readonly risk: { readonly lambda0: number; readonly terms: readonly RiskTerm[] };
  /** 同一互斥组内用指数竞速，只允许一个事件发生。 */
  readonly exclusivity?: string;
  readonly cooldownDays: number;
  readonly weight?: number;
  readonly effects: readonly Effect[];
  readonly text: { readonly title: string; readonly body: string };
  /** 所属事件链与步序：step>1 的只能由父事件排定，不参与随机候选。 */
  readonly chain?: EventChainRef;
  /** 事件发生后按延迟排定的后续事件（可带概率与条件）。 */
  readonly followUps?: readonly FollowUpDef[];
  /** 需要玩家/当事人二选一的选项；有 choices 时 effects 不再自动应用。 */
  readonly choices?: readonly ChoiceDef[];
}

export interface ChoiceDef {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly effects: readonly Effect[];
  readonly conditions?: Expr;
}

export interface PendingChoice {
  readonly id: string;
  readonly eventId: string;
  readonly scope: EventDef['scope'];
  readonly entityId: EntityId;
  readonly day: number;
  readonly expiresDay: number;
}

export interface EventChainRef {
  readonly id: string;
  readonly step: number;
}

export interface FollowUpDef {
  readonly eventId: string;
  readonly delayDays: number;
  /** 触发概率 0–1，缺省 1。 */
  readonly chance?: number;
  readonly conditions?: Expr;
}

export interface FaithDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly domains: readonly string[];
  readonly alignmentLean: Alignment;
}

export interface BackgroundDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly classId: string;
  readonly regionId: RegionId;
  readonly faithId: string | null;
  readonly wealth: number;
  readonly skills: Readonly<Record<string, number>>;
  readonly attributes: Partial<Attributes>;
}

export interface CultureNames {
  readonly male: readonly string[];
  readonly female: readonly string[];
  readonly family: readonly string[];
}

export interface NamePools {
  readonly cultures: Readonly<Record<string, CultureNames>>;
}

export interface WorldContent {
  readonly version: string;
  readonly world: WorldDef;
  readonly countries: readonly CountryDef[];
  readonly organizations: readonly OrganizationDef[];
  readonly goods: readonly GoodDef[];
  readonly events: readonly EventDef[];
  readonly balance: BalanceConfig;
  /** M4 起可选：信仰、开局背景、姓名池。 */
  readonly faiths?: readonly FaithDef[];
  readonly backgrounds?: readonly BackgroundDef[];
  readonly names?: NamePools;
}

/* ------------------------------------------------------------------ */
/* 运行时状态                                                           */
/* ------------------------------------------------------------------ */

export interface WorldMeta {
  schemaVersion: number;
  contentVersion: string;
  seed: string;
  createdAt: number;
  worldId: string;
}

export interface Character {
  id: CharacterId;
  name: string;
  /** 文化名池标识；旧存档/生成人物可能缺省。 */
  culture?: string;
  raceId: string;
  classId: string;
  age: number;
  alive: boolean;
  regionId: RegionId;
  organizationId: OrgId | null;
  wealth: number;
  skills: Record<string, number>;
  traits: Record<string, number>;
  /* ---- 档案（M4）：六维、阵营、信仰、地点、家系 ---- */
  sex: Sex;
  /** 出生年份（相对纪元，`0` 为开局年）。`age` 是派生缓存，年末与出生时同步。 */
  birthYear: number;
  generation: number;
  familyId: FamilyId | null;
  parentIds: [CharacterId | null, CharacterId | null];
  spouseId: CharacterId | null;
  attributes: Attributes;
  alignment: Alignment;
  /** 信仰 ID；`null` 表示无信仰（合法值，不是缺失）。 */
  faith: string | null;
  /** 故乡地区，用于"返乡/流亡"类事件。 */
  homeRegionId: RegionId;
  location: CharacterLocation;
  offices: CharacterOffice[];
  /** 生涯阶梯等级（0–3），晋升由 Career 系统按财富/技能/声望判定。 */
  careerRank: number;
  /** 进入当前阶梯的日期（天）。 */
  careerSinceDay: number;
  /* ---- 阶段 3：个人行动（健康、行动力、存款） ---- */
  /** 健康 0–100；低于 40 时死亡率上升、事件更可能走坏结局。 */
  health: number;
  /** 本月剩余行动力（每月刷新为 3，个人动词各消耗 1 点）。 */
  actionPoints: number;
  /** 存在银行类组织里的钱（提款时从组织现金支付利息后归还）。 */
  deposits: Record<string, number>;
}

export interface Organization {
  id: OrgId;
  name: string;
  type: OrgType;
  industry: GoodId | 'service';
  foundedDay: number;
  homeRegionId: RegionId;
  /** 来源：内容初始 / 玩家创建 / NPC 进入。 */
  origin: 'content' | 'player' | 'npc';
  scale: number;
  cash: number;
  assets: number;
  liabilities: number;
  members: number;
  payrollMonthly: number;
  leadership: { leaderId: CharacterId; legitimacy: number };
  conflict: number;
  governance: number;
  efficiency: number;
  strategy: OrgStrategy;
  lifecycle: OrgLifecycle;
  shares: { characterId: CharacterId; share: number }[];
  /** 最近一个月结算出的经营数据，供 UI 与再投资决策使用。 */
  lastMonthRevenue: number;
  lastMonthCost: number;
  lastMonthProfit: number;
  lastMonthTax: number;
  /** 上月运输成本（由贸易系统写入，财务结算后清零），避免与损益重复记账。 */
  lastMonthTransport: number;
  /** 上月关税（由贸易系统写入，财务结算后清零）。 */
  lastMonthTariff: number;
  /** 上月贸易收入（由贸易系统写入，计入损益后清零）。 */
  lastMonthTradeRevenue: number;
  /** 欠薪：现金不足以发工资时转入负债，清算时优先于股东受偿。 */
  unpaidWages: number;
  /** 已连续处于危机/宽限的月数。 */
  distressMonths: number;
  /** 宽限期截止日（0 表示没有宽限期）。 */
  graceUntilDay: number;
  /** 重组期截止日（0 表示未进入重组）。 */
  restructureUntilDay: number;
  /** 本月在同地区同行业的市场份额（0–1）。 */
  marketShare: number;
  /** 相对市场价的定价指数（1 = 随行就市）。 */
  priceIndex: number;
  /** 四类风险指数（0–1），由 balance.risk 系数表计算。 */
  risk: { split: number; bankruptcy: number; corruption: number; unrest: number };
  /** 商路累计投入与收益，用于计算 open_route 的投资回报。 */
  tradeInvestment: number;
  tradeRevenue: number;
  tradeCost: number;
  /** 解散清算的审计快照；未解散为 null。 */
  liquidation: LiquidationRecord | null;
}

export interface LiquidationRecord {
  day: number;
  /** 资产变现所得。 */
  proceeds: number;
  /** 清偿债主（含贷款、供应商）的金额。 */
  creditorPaid: number;
  /** 清偿员工欠薪的金额。 */
  wagePaid: number;
  /** 分配给股东的金额。 */
  shareholderPaid: number;
  /** 资不抵债、由股东承担的损失（进历史，不允许凭空消失）。 */
  shortfall: number;
}

export interface Country {
  id: CountryId;
  name: string;
  polity: Polity;
  regionIds: RegionId[];
  population: number;
  treasury: number;
  monthlyRevenue: number;
  monthlyExpense: number;
  debt: number;
  military: number;
  legitimacy: number;
  stability: number;
  rulerId: CharacterId;
  policies: PolicyVector;
  diplomacy: Record<CountryId, number>;
  /** 各政策上次成功变更的日期（`PolicyKey` → day），用于冷却。 */
  policyCooldowns: Record<string, number>;
  /** 连续满足政权更迭条件的月数（确定性计数，不做随机抖动）。 */
  polityPressureMonths: number;
  /** 上次政权更迭日期（0 表示从未）。 */
  lastPolityChangeDay: number;
  /** 内阁最近一次采纳的财政路线，供政策压力与 UI 观察。 */
  cabinetAction: 'raise_tax' | 'cut_military' | 'borrow' | null;
  cabinetUtility: number;
  /** 继承规则：君主制默认 primogeniture，共和制默认 elective（M4 可用 council）。 */
  succession: SuccessionMode;
  /** 公职列表；M3 允许为空，M4 议会/内阁模型再填充。 */
  offices: CountryOffice[];
  /** 交战对象（双向写入，排序稳定）。 */
  atWarWith: CountryId[];
  /** 最近一次开战日；0 表示从未开战。 */
  warStartDay: number;
  /** 厌战度 0–1：随战争月数与伤亡累积，满 1 会被迫议和。 */
  warExhaustion: number;
}

export interface Region {
  id: RegionId;
  name: string;
  countryId: CountryId;
  population: number;
  terrain: Terrain;
  x: number;
  y: number;
  links: RegionLinkDef[];
  /** 被敌国占领时的占领方；停战协议决定是否割让。 */
  occupiedBy: CountryId | null;
  /** 围城进度（月）；达到 `balance.war.occupationMonths` 即占领。 */
  siegeProgress: number;
}

export interface Market {
  regionId: RegionId;
  goodId: GoodId;
  stock: number;
  production: number;
  demand: number;
  price: number;
  floor: number;
  ceiling: number;
  importCapacity: number;
  exportCapacity: number;
  /** 本月同地区同行业各组织的市场份额，按吸引力归一化，份额和 = 1。 */
  shareByOrg: Record<OrgId, number>;
  /** 开通该地区商路的组织；货到后由其收取贸易收益并承担关税。 */
  routeOwnerId: OrgId | null;
  /** 本月到港、尚未被市场计价吸收的进口量（M3：进口参与定价）。 */
  importedUnits: number;
}

export type ContractStatus = 'open' | 'fulfilled' | 'defaulted' | 'cancelled';
export type ContractKind =
  | 'supply'
  | 'transport'
  | 'loan'
  | 'employment'
  /** M1 遗留值，保留以兼容旧存档。 */
  | 'trade'
  | 'service';

export interface Contract {
  id: ContractId;
  kind: ContractKind;
  /** [付款方/义务方, 收款方/权利方]；雇佣契约第二项是人物 ID。 */
  parties: string[];
  fromOrgId: OrgId;
  toOrgId: OrgId | CharacterId;
  startDay: number;
  endDay: number;
  /** 合同总额（贷款为本金 + 利息上限）。 */
  value: number;
  status: ContractStatus;
  goodId: GoodId | null;
  /** 每期数量（供货/运输）或 1（贷款/雇佣）。 */
  quantity: number;
  unitPrice: number;
  penaltyRate: number;
  /** 贷款月利率。 */
  rateMonthly: number;
  principal: number;
  collateral: number;
  nextDueDay: number;
  installments: number;
  paidInstallments: number;
}

export type ShipmentId = string;

/** 在途货物：离港时扣减来源库存，抵港时才进入目的地库存。 */
export interface Shipment {
  id: ShipmentId;
  fromRegionId: RegionId;
  toRegionId: RegionId;
  goodId: GoodId;
  units: number;
  lost: number;
  ownerOrgId: OrgId | null;
  departDay: number;
  arriveDay: number;
  transportCost: number;
  tariffDue: number;
  status: 'in_transit' | 'arrived';
}

export interface TradeFlow {
  readonly from: RegionId;
  readonly to: RegionId;
  readonly goodId: GoodId;
  readonly units: number;
  readonly transportCost: number;
  readonly tariff: number;
  readonly arriveDay: number;
  readonly ownerOrgId: OrgId | null;
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
  stats: WorldStats;
}

export interface SettleContext {
  readonly day: number;
  /** 结算点键，如 `m120`（第 120 天 = 第 4 月月末附近的月度键）。 */
  readonly periodKey: string;
  readonly phase: Phase;
  readonly rng: Random;
}

/* ------------------------------------------------------------------ */
/* 工厂                                                                 */
/* ------------------------------------------------------------------ */

export interface CreateWorldOptions {
  readonly seed: string;
  /** 真实时间戳，仅写入 meta，不参与模拟。 */
  readonly createdAt?: number;
}

export function marketKeyOf(regionId: RegionId, goodId: GoodId): MarketKey {
  return `${regionId}:${goodId}`;
}

/** 六维缺省值：人类均值 10。 */
export function neutralAttributes(): Attributes {
  return { physique: 10, agility: 10, intellect: 10, willpower: 10, perception: 10, charisma: 10 };
}

function clampToRange(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * 由人物定义补齐档案字段。
 * 内容作者只写关心的字段，其余取缺省：属性 10、阵营 (0,0)、无信仰、地点 = 所属地区。
 */
export function buildCharacter(def: CharacterDef): Character {
  const regionId = def.location?.regionId ?? def.regionId;
  const attributes = neutralAttributes();
  if (def.attributes) {
    for (const key of ATTRIBUTE_KEYS) {
      const value = def.attributes[key];
      if (value !== undefined) attributes[key] = clampToRange(value, 1, 20);
    }
  }
  const alignment = def.alignment ?? { law: 0, good: 0 };
  const age = Math.max(0, Math.round(def.age));
  return {
    id: def.id,
    name: def.name,
    ...(def.culture ? { culture: def.culture } : {}),
    raceId: def.raceId,
    classId: def.classId,
    age,
    alive: true,
    regionId,
    organizationId: def.organizationId,
    wealth: Math.max(0, Math.round(def.wealth)),
    skills: { ...def.skills },
    traits: { ...def.traits },
    sex: def.sex ?? (fnv1a64(def.id) % 2n === 0n ? 'male' : 'female'),
    birthYear: -age,
    generation: def.generation ?? 1,
    familyId: def.familyId ?? null,
    parentIds: [def.parentIds?.[0] ?? null, def.parentIds?.[1] ?? null],
    spouseId: def.spouseId ?? null,
    attributes,
    alignment: {
      law: clampToRange(alignment.law, -100, 100),
      good: clampToRange(alignment.good, -100, 100),
    },
    faith: def.faithId ?? null,
    homeRegionId: regionId,
    location: {
      regionId,
      site: def.location?.site ?? 'city',
      sinceDay: def.location?.sinceDay ?? 0,
    },
    offices: def.offices ? def.offices.map((office) => ({ ...office })) : [],
    careerRank: clampToRange(Math.round(def.careerRank ?? 0), 0, 3),
    careerSinceDay: Math.max(0, Math.round(def.careerSinceDay ?? 0)),
    health: clampToRange(Math.round(def.health ?? 100), 0, 100),
    actionPoints: clampToRange(Math.round(def.actionPoints ?? 3), 0, 6),
    deposits: { ...(def.deposits ?? {}) },
  };
}

/** 地形对行市的初始扰动（±10%），只影响开局价格，之后由供需决定。 */
function terrainPriceFactor(terrain: Terrain): number {
  switch (terrain) {
    case 'mountains':
      return 1.15;
    case 'plains':
      return 0.9;
    case 'city':
      return 1.06;
    case 'coast':
      return 1.0;
    case 'forest':
      return 0.97;
  }
}

/** 由静态内容生成初始世界。纯函数：同内容 + 同种子 → 同状态。 */
export function createWorld(content: WorldContent, options: CreateWorldOptions): WorldState {
  const characters: Record<CharacterId, Character> = {};
  for (const def of content.world.characters) {
    characters[def.id] = buildCharacter(def);
  }
  const families: Record<FamilyId, Family> = {};

  const organizations: Record<OrgId, Organization> = {};
  for (const def of content.organizations) {
    organizations[def.id] = {
      id: def.id,
      name: def.name,
      type: def.type,
      industry: def.industry,
      foundedDay: def.foundedDay,
      homeRegionId: def.homeRegionId,
      origin: 'content',
      scale: def.scale,
      cash: def.cash,
      assets: def.assets,
      liabilities: def.liabilities,
      members: def.members,
      payrollMonthly: def.payrollMonthly,
      leadership: { leaderId: def.leaderId, legitimacy: def.legitimacy },
      conflict: def.conflict,
      governance: def.governance,
      efficiency: def.efficiency,
      strategy: def.strategy,
      lifecycle: def.lifecycle,
      shares: def.shares.map((share) => ({ ...share })),
      lastMonthRevenue: 0,
      lastMonthCost: 0,
      lastMonthProfit: 0,
      lastMonthTax: 0,
      lastMonthTransport: 0,
      lastMonthTariff: 0,
      lastMonthTradeRevenue: 0,
      unpaidWages: 0,
      distressMonths: 0,
      graceUntilDay: 0,
      restructureUntilDay: 0,
      marketShare: 0,
      priceIndex: 1,
      risk: { split: 0, bankruptcy: 0, corruption: 0, unrest: 0 },
      tradeInvestment: 0,
      tradeRevenue: 0,
      tradeCost: 0,
      liquidation: null,
    };
  }

  const regions: Record<RegionId, Region> = {};
  for (const def of content.world.regions) {
    regions[def.id] = {
      id: def.id,
      name: def.name,
      countryId: def.countryId,
      population: def.population,
      terrain: def.terrain,
      x: def.x,
      y: def.y,
      links: def.links.map((link) => ({ ...link })),
      occupiedBy: null,
      siegeProgress: 0,
    };
  }

  const countries: Record<CountryId, Country> = {};
  for (const def of content.countries) {
    const regionIds = content.world.regions
      .filter((region) => region.countryId === def.id)
      .map((region) => region.id);
    countries[def.id] = {
      id: def.id,
      name: def.name,
      polity: def.polity,
      regionIds,
      population: def.population,
      treasury: def.treasury,
      monthlyRevenue: def.monthlyRevenue,
      monthlyExpense: def.monthlyExpense,
      debt: def.debt,
      military: def.military,
      legitimacy: def.legitimacy,
      stability: def.stability,
      rulerId: def.rulerId,
      policies: { ...def.policies },
      diplomacy: {},
      policyCooldowns: {},
      polityPressureMonths: 0,
      lastPolityChangeDay: 0,
      cabinetAction: null,
      cabinetUtility: 0,
      succession: def.polity === 'monarchy' ? 'primogeniture' : 'elective',
      offices: [],
      atWarWith: [],
      warStartDay: 0,
      warExhaustion: 0,
    };
  }
  // 外交初始值：同政体 20，异政体 -10，自国除外。
  for (const from of Object.values(countries)) {
    for (const to of Object.values(countries)) {
      if (from.id === to.id) continue;
      from.diplomacy[to.id] = from.polity === to.polity ? 20 : -10;
    }
  }

  const markets: Record<MarketKey, Market> = {};
  const { stockMonthsTarget } = content.balance.economy;
  for (const region of Object.values(regions)) {
    for (const good of content.goods) {
      const monthlyDemand = Math.max(1, Math.round(region.population * good.consumptionPerCapita));
      markets[marketKeyOf(region.id, good.id)] = {
        regionId: region.id,
        goodId: good.id,
        stock: Math.round(monthlyDemand * stockMonthsTarget),
        production: 0,
        demand: monthlyDemand,
        // 初始行市按地形略有差异：山地缺粮贵、平原产粮便宜，给个人贩运留出第一笔价差。
        price: Math.max(1, Math.round(good.basePrice * terrainPriceFactor(region.terrain))),
        floor: Math.max(1, Math.round(good.basePrice * good.floorRatio)),
        ceiling: Math.round(good.basePrice * good.ceilingRatio),
        importCapacity: 0,
        exportCapacity: 0,
        shareByOrg: {},
        routeOwnerId: null,
        importedUnits: 0,
      };
    }
  }

  const tiers: Record<EntityId, 1 | 2 | 3> = {};
  for (const org of Object.values(organizations)) {
    tiers[org.id] = 2;
  }
  for (const country of Object.values(countries)) {
    tiers[country.id] = 2;
  }
  for (const region of Object.values(regions)) {
    tiers[region.id] = 3;
  }

  // 开局就有一支常备军：army:<countryId> 驻扎在人口最多的地区（首都）。
  const armies: Record<ArmyId, Army> = {};
  for (const country of Object.values(countries)) {
    const capital = country.regionIds
      .map((id) => regions[id])
      .filter((region): region is Region => Boolean(region))
      .sort((a, b) => b.population - a.population)[0];
    if (!capital) continue;
    armies[`army:${country.id}`] = {
      id: `army:${country.id}`,
      countryId: country.id,
      size: Math.max(
        50,
        Math.round(country.population * 0.008 * (0.5 + country.policies.militaryShare * 2)),
      ),
      locationRegionId: capital.id,
      morale: 0.6,
      training: 0.35,
      commanderId: null,
      stance: 'defend',
      targetRegionId: null,
    };
  }

  return {
    meta: {
      schemaVersion: SCHEMA_VERSION,
      contentVersion: content.version,
      seed: options.seed,
      createdAt: options.createdAt ?? 0,
      worldId: content.world.id,
    },
    clock: { day: content.world.startDay },
    playerId: content.world.playerId,
    characters,
    families,
    organizations,
    countries,
    regions,
    markets,
    contracts: {},
    shipments: {},
    relations: [],
    armies,
    tiers,
    pendingEvents: [],
    pendingChoices: [],
    rngCounters: {},
    cooldowns: {},
    history: [],
    scheduleSeq: 0,
    contractSeq: 0,
    orgSeq: 0,
    characterSeq: 0,
    stats: {
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
      profitTotal: 0,
      dividendsPaid: 0,
      orgCountSum: 0,
      orgCountSamples: 0,
      policyProposals: 0,
      policyChanges: 0,
      policyCost: 0,
      minPolicyIntervalDays: 0,
      polityChanges: 0,
    },
  };
}

/* ------------------------------------------------------------------ */
/* 校验                                                                 */
/* ------------------------------------------------------------------ */

const MONEY_FIELDS = ['cash', 'assets', 'liabilities'] as const;

/** 返回问题清单；空数组表示通过。 */
export function validateWorld(state: WorldState): string[] {
  const problems: string[] = [];

  if (!Number.isInteger(state.meta.schemaVersion) || state.meta.schemaVersion < 1) {
    problems.push('meta.schemaVersion 非法');
  }
  if (state.meta.seed.length === 0) problems.push('meta.seed 为空');
  if (!Number.isInteger(state.clock.day) || state.clock.day < 1) {
    problems.push('clock.day 必须为 >=1 的整数');
  }
  if (!state.characters[state.playerId]) {
    problems.push(`playerId 指向不存在的人物 ${state.playerId}`);
  }

  for (const [key, character] of Object.entries(state.characters)) {
    if (key !== character.id) problems.push(`人物键 ${key} 与 id ${character.id} 不一致`);
    if (!state.regions[character.regionId]) {
      problems.push(`人物 ${character.id} 的地区 ${character.regionId} 不存在`);
    }
    if (character.organizationId !== null && !state.organizations[character.organizationId]) {
      problems.push(`人物 ${character.id} 的组织 ${character.organizationId} 不存在`);
    }
    if (character.wealth < 0) problems.push(`人物 ${character.id} 财富为负`);
    if (
      !Number.isInteger(character.careerRank) ||
      character.careerRank < 0 ||
      character.careerRank > 3
    ) {
      problems.push(`人物 ${character.id} 的生涯等级越界`);
    }
    if (!Number.isFinite(character.health) || character.health < 0 || character.health > 100) {
      problems.push(`人物 ${character.id} 的健康值越界`);
    }
    if (
      !Number.isInteger(character.actionPoints) ||
      character.actionPoints < 0 ||
      character.actionPoints > 6
    ) {
      problems.push(`人物 ${character.id} 的行动力越界`);
    }
    for (const key of ATTRIBUTE_KEYS) {
      const value = character.attributes?.[key];
      if (!Number.isInteger(value) || value < 1 || value > 20) {
        problems.push(`人物 ${character.id} 的属性 ${key} 越界`);
      }
    }
    if (!SITE_KINDS.includes(character.location.site)) {
      problems.push(`人物 ${character.id} 的地点类型 ${String(character.location.site)} 非法`);
    }
    if (!state.regions[character.location.regionId]) {
      problems.push(`人物 ${character.id} 的地点地区 ${character.location.regionId} 不存在`);
    }
    if (!state.regions[character.homeRegionId]) {
      problems.push(`人物 ${character.id} 的故乡 ${character.homeRegionId} 不存在`);
    }
    if (Math.abs(character.alignment.law) > 100 || Math.abs(character.alignment.good) > 100) {
      problems.push(`人物 ${character.id} 的阵营越界`);
    }
    if (character.faith !== null && typeof character.faith !== 'string') {
      problems.push(`人物 ${character.id} 的信仰不是字符串或 null`);
    }
    if (character.spouseId !== null && !state.characters[character.spouseId]) {
      problems.push(`人物 ${character.id} 的配偶 ${character.spouseId} 不存在`);
    }
    for (const parentId of character.parentIds) {
      if (parentId !== null && !state.characters[parentId]) {
        problems.push(`人物 ${character.id} 的亲属 ${parentId} 不存在`);
      }
    }
    if (character.familyId !== null && !state.families?.[character.familyId]) {
      problems.push(`人物 ${character.id} 的家族 ${character.familyId} 不存在`);
    }
  }

  for (const [key, family] of Object.entries(state.families ?? {})) {
    if (key !== family.id) problems.push(`家族键 ${key} 与 id ${family.id} 不一致`);
    for (const memberId of family.memberIds) {
      if (!state.characters[memberId]) problems.push(`家族 ${family.id} 的成员 ${memberId} 不存在`);
    }
  }

  for (const [key, org] of Object.entries(state.organizations)) {
    if (key !== org.id) problems.push(`组织键 ${key} 与 id ${org.id} 不一致`);
    if (!state.regions[org.homeRegionId]) {
      problems.push(`组织 ${org.id} 的母地区 ${org.homeRegionId} 不存在`);
    }
    if (!state.characters[org.leadership.leaderId]) {
      problems.push(`组织 ${org.id} 的领袖 ${org.leadership.leaderId} 不存在`);
    }
    for (const field of MONEY_FIELDS) {
      if (org[field] < 0) problems.push(`组织 ${org.id} 的 ${field} 为负`);
    }
    for (const share of org.shares) {
      if (!state.characters[share.characterId]) {
        problems.push(`组织 ${org.id} 的股东 ${share.characterId} 不存在`);
      }
    }
  }

  for (const [key, country] of Object.entries(state.countries)) {
    if (key !== country.id) problems.push(`国家键 ${key} 与 id ${country.id} 不一致`);
    if (!state.characters[country.rulerId]) {
      problems.push(`国家 ${country.id} 的统治者在人物表中不存在`);
    } else if (!state.characters[country.rulerId]?.alive) {
      problems.push(`国家 ${country.id} 的统治者已死亡（不允许无主国家）`);
    }
    for (const regionId of country.regionIds) {
      if (!state.regions[regionId]) problems.push(`国家 ${country.id} 的地区 ${regionId} 不存在`);
    }
    if (country.treasury < 0) problems.push(`国家 ${country.id} 国库为负`);
    if (country.debt < 0) problems.push(`国家 ${country.id} 债务为负`);
  }

  for (const [key, market] of Object.entries(state.markets)) {
    if (key !== marketKeyOf(market.regionId, market.goodId)) {
      problems.push(`市场键 ${key} 与 ${market.regionId}:${market.goodId} 不一致`);
    }
    if (!state.regions[market.regionId]) {
      problems.push(`市场 ${key} 的地区不存在`);
    }
    if (market.price < 0 || market.stock < 0) problems.push(`市场 ${key} 价格或库存为负`);
    if (market.importedUnits < 0) problems.push(`市场 ${key} 进口量为负`);
  }

  for (const [key, region] of Object.entries(state.regions)) {
    if (key !== region.id) problems.push(`地区键 ${key} 与 id ${region.id} 不一致`);
    if (!state.countries[region.countryId]) {
      problems.push(`地区 ${region.id} 的国家 ${region.countryId} 不存在`);
    }
    for (const link of region.links) {
      if (!state.regions[link.to]) problems.push(`地区 ${region.id} 的商路指向 ${link.to} 不存在`);
    }
  }

  for (const scheduled of state.pendingEvents) {
    if (!Number.isInteger(scheduled.day) || scheduled.day < 1) {
      problems.push(`待办事件 ${scheduled.refId} 的日期非法`);
    }
  }

  for (const [key, contract] of Object.entries(state.contracts)) {
    if (key !== contract.id) problems.push(`契约键 ${key} 与 id ${contract.id} 不一致`);
    if (!state.organizations[contract.fromOrgId]) {
      problems.push(`契约 ${key} 的义务方 ${contract.fromOrgId} 不存在`);
    }
    if (contract.kind === 'employment') {
      if (!state.characters[contract.toOrgId]) {
        problems.push(`雇佣契约 ${key} 的雇员 ${contract.toOrgId} 不存在`);
      }
    } else if (!state.organizations[contract.toOrgId]) {
      problems.push(`契约 ${key} 的权利方 ${contract.toOrgId} 不存在`);
    }
    if (contract.endDay < contract.startDay) problems.push(`契约 ${key} 的到期日早于起始日`);
    if (contract.value < 0 || contract.principal < 0 || contract.collateral < 0) {
      problems.push(`契约 ${key} 的金额为负`);
    }
  }

  for (const [key, shipment] of Object.entries(state.shipments)) {
    if (key !== shipment.id) problems.push(`货运键 ${key} 与 id ${shipment.id} 不一致`);
    if (!state.regions[shipment.fromRegionId] || !state.regions[shipment.toRegionId]) {
      problems.push(`货运 ${key} 的地区不存在`);
    }
    if (!state.markets[marketKeyOf(shipment.toRegionId, shipment.goodId)]) {
      problems.push(`货运 ${key} 的目的地没有该商品市场`);
    }
    if (shipment.units < 0 || shipment.lost < 0) problems.push(`货运 ${key} 的数量为负`);
    if (shipment.arriveDay < shipment.departDay) problems.push(`货运 ${key} 的抵达日早于离港日`);
    if (shipment.ownerOrgId !== null && !state.organizations[shipment.ownerOrgId]) {
      problems.push(`货运 ${key} 的所有者 ${shipment.ownerOrgId} 不存在`);
    }
  }

  const scheduleKeys = new Set<string>();
  for (const scheduled of state.pendingEvents) {
    const id = `${scheduled.day}:${scheduled.phase}:${scheduled.seq}`;
    if (scheduleKeys.has(id)) problems.push(`待办队列存在重复排序键 ${id}`);
    scheduleKeys.add(id);
  }

  return problems;
}

/* ------------------------------------------------------------------ */
/* 规范化哈希                                                           */
/* ------------------------------------------------------------------ */

/** 稳定序列化：对象键排序，数组保持顺序。 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const body = entries
    .filter(([, item]) => item !== undefined)
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(',');
  return `{${body}}`;
}

/** 状态哈希：确定性回归（R1、R2）与回放校验的基础。 */
export function hashWorld(state: WorldState): string {
  return fnv1a64(stableStringify(state)).toString(16).padStart(16, '0');
}

/** 稳定 ID 顺序：禁止依赖对象插入顺序（铁律 4）。 */
export function sortedIds<T>(record: Record<string, T>): string[] {
  return Object.keys(record).sort();
}

/** 深拷贝，用于事务回滚。 */
export function cloneWorld(state: WorldState): WorldState {
  return structuredClone(state);
}

/** 月度键，如 `m0042`（第 42 个月）。 */
export function monthKeyOf(day: number): string {
  const month = Math.floor((day - 1) / DAYS_PER_MONTH) + 1;
  return `m${String(month).padStart(4, '0')}`;
}
