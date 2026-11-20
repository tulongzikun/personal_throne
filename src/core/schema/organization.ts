/* 组织：类型、战略、生命周期、定义与运行时实体。 */

import type { CharacterId, GoodId, OrgId, RegionId } from './ids';

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
