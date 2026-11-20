/* 国家与地区：公职、政体、继承、地形、政策与实体。 */

import type { CharacterId, CountryId, RegionId } from './ids';

/** 国家公职：M3 只保留结构，M4 的事件/议会模型再填充。 */
export interface CountryOffice {
  id: string;
  title: string;
  holderId: CharacterId;
  /** 0–1，供政策支持度与事件使用。 */
  influence: number;
  salaryMonthly: number;
}

export type Polity = 'monarchy' | 'republic';

export type SuccessionMode = 'primogeniture' | 'elective' | 'council';

export type Terrain = 'city' | 'plains' | 'mountains' | 'coast' | 'forest';

export interface RegionLinkDef {
  readonly to: RegionId;
  readonly days: number;
  readonly capacity: number;
}

export interface PolicyVector {
  taxRate: number;
  tariffRate: number;
  militaryShare: number;
  tradeFreedom: number;
  regulation: number;
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
  /** 未成年统治者时的摄政；成年后清空。 */
  regentId?: CharacterId | null;
  /** 公职列表；M3 允许为空，M4 议会/内阁模型再填充。 */
  offices: CountryOffice[];
  /** 交战对象（双向写入，排序稳定）。 */
  atWarWith: CountryId[];
  /** 最近一次开战日；0 表示从未开战。 */
  warStartDay: number;
  /** 厌战度 0–1：随战争月数与伤亡累积，满 1 会被迫议和。 */
  warExhaustion: number;
  /** 国债的债权方：组织 ID → 持有国债额。赤字借债时记名，还本付息时钱流向这里。 */
  creditors: Record<string, number>;
  /** 连续没有领土的月数；满 60 个月判定灭亡（0 地区国不能永远挂账）。 */
  vacantMonths: number;
  /** 已灭亡：不再参与财政、外交与战争，也不能复活。 */
  extinct: boolean;
}
