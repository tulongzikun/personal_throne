/* 经济：商品、市场、契约、货运与贸易流。 */

import type { CharacterId, ContractId, GoodId, OrgId, RegionId } from './ids';

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
