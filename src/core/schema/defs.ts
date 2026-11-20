/* 内容包 schema（定义层）：世界定义、平衡参数、风险表、事件与抉择。注意本文件名刻意不叫 content，避免与 src/content 装配器混淆。 */

import type { CharacterDef } from './character';
import type { CountryDef, RegionDef, Terrain } from './country';
import type { GoodDef } from './economy';
import type { Alignment, AttributeKey, Attributes, CharacterId, EntityId, RegionId } from './ids';
import type { OrganizationDef } from './organization';

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

export interface EventWhen {
  readonly countryId?: string | readonly string[];
  readonly regionIds?: readonly string[];
  readonly terrains?: readonly Terrain[];
}

export interface ChoiceCheck {
  readonly attribute: AttributeKey;
  readonly difficulty: number;
}

export interface ChoiceDef {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  /** 需要掷骰时：看哪个属性、门槛多少；成功走 effects，失败走 failureEffects。 */
  readonly check?: ChoiceCheck;
  readonly effects: readonly Effect[];
  /** 检定失败时的后果；缺省表示失败没有额外损失。 */
  readonly failureEffects?: readonly Effect[];
  readonly conditions?: Expr;
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
  /**
   * 世界门控（阶段 4）：事件只在其发生地成立时才有资格成为候选。
   * countryId 允许数组（同一闹剧在多国上演时复用一条事件）。
   */
  readonly when?: EventWhen;
  readonly effects: readonly Effect[];
  readonly text: { readonly title: string; readonly body: string };
  /** 所属事件链与步序：step>1 的只能由父事件排定，不参与随机候选。 */
  readonly chain?: EventChainRef;
  /** 事件发生后按延迟排定的后续事件（可带概率与条件）。 */
  readonly followUps?: readonly FollowUpDef[];
  /** 需要玩家/当事人二选一的选项；有 choices 时 effects 不再自动应用。 */
  readonly choices?: readonly ChoiceDef[];
}

export interface PendingChoice {
  readonly id: string;
  readonly eventId: string;
  readonly scope: EventDef['scope'];
  readonly entityId: EntityId;
  readonly day: number;
  readonly expiresDay: number;
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
