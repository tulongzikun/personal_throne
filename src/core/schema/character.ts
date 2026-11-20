/* 人物（角色）相关的定义与运行时实体。 */

import type {
  Alignment,
  Attributes,
  CharacterId,
  CountryId,
  FamilyId,
  OrgId,
  RegionId,
  SiteKind,
} from './ids';

/** 人物性别：只影响婚姻与生育结算，不参与数值。 */
export type Sex = 'male' | 'female';

/* ------------------------------------------------------------------ */
/* 静态内容（schema）                                                   */
/* ------------------------------------------------------------------ */

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
  /** 最近一次亲自出手（玩家命令）的日期；用于月俸与晋升的"在岗"判定。 */
  readonly lastActionDay?: number;
  readonly health?: number;
  readonly actionPoints?: number;
  readonly deposits?: Record<string, number>;
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
  /** 最近一次亲自出手（玩家命令）的日期；NPC 恒为 0，表示"一直在岗"。 */
  lastActionDay: number;
  /* ---- 阶段 3：个人行动（健康、行动力、存款） ---- */
  /** 健康 0–100；低于 40 时死亡率上升、事件更可能走坏结局。 */
  health: number;
  /** 本月剩余行动力（每月刷新为 3，个人动词各消耗 1 点）。 */
  actionPoints: number;
  /** 存在银行类组织里的钱（提款时从组织现金支付利息后归还）。 */
  deposits: Record<string, number>;
}
