/**
 * 政策：压力累积 → 提案 → 按政体决策（GDD §10.3）。
 *
 * MVP 只把三个阶段跑通，不做完整议会/派系模型：
 * - 压力来自：市场短缺（民生）、组织亏损（资本）、战争风险（军事）、国库赤字（财政）；
 * - 每季度检查一次，压力超过阈值生成提案（policies 单字段 ±0.05）；
 * - 君主制由统治者特质（authority/legitimacy）决定是否采纳；
 *   共和制由"资本权重"投票——大组织所在国家更容易推动商业政策；
 * - 决策写入历史，供 UI 与验收场景 C 观察。
 */

import type { CountryId, PolicyVector, SettleContext, WorldState } from '../../core/WorldState';
import { sortedIds } from '../../core/WorldState';

export type PolicyKey = keyof PolicyVector;

export interface PolicyProposal {
  readonly countryId: CountryId;
  readonly policy: PolicyKey;
  readonly delta: number;
  readonly pressure: number;
  readonly passed: boolean;
  readonly reason: string;
}

interface Pressure {
  readonly policy: PolicyKey;
  readonly delta: number;
  readonly value: number;
  readonly reason: string;
}

const THRESHOLD = 0.35;

export function evaluatePolicyPressure(state: WorldState, countryId: CountryId): Pressure[] {
  const country = state.countries[countryId];
  if (!country) return [];
  const pressures: Pressure[] = [];

  const regions = country.regionIds.map((id) => state.regions[id]).filter(Boolean);
  let shortage = 0;
  let demand = 0;
  for (const market of Object.values(state.markets)) {
    if (!regions.some((region) => region?.id === market.regionId)) continue;
    demand += market.demand;
    shortage += Math.max(0, market.demand - market.stock);
  }
  const shortageRatio = demand > 0 ? shortage / demand : 0;
  if (shortageRatio > THRESHOLD) {
    pressures.push({
      policy: 'regulation',
      delta: 0.05,
      value: shortageRatio,
      reason: `粮食/商品缺口 ${(shortageRatio * 100).toFixed(0)}%，民生压力上升`,
    });
  }

  const debtRatio = country.debt / Math.max(1, country.monthlyRevenue * 12);
  if (debtRatio > 0.5) {
    pressures.push({
      policy: 'taxRate',
      delta: 0.02,
      value: Math.min(1, debtRatio),
      reason: `债务达到年收入的 ${(debtRatio * 100).toFixed(0)}%，需要增税`,
    });
  }

  const orgs = Object.values(state.organizations).filter((org) =>
    country.regionIds.includes(org.homeRegionId),
  );
  const losing = orgs.filter((org) => org.lastMonthRevenue < org.lastMonthCost).length;
  if (orgs.length > 0 && losing / orgs.length > 0.5) {
    pressures.push({
      policy: 'tradeFreedom',
      delta: 0.05,
      value: losing / orgs.length,
      reason: `${losing}/${orgs.length} 家组织亏损，商会要求放开贸易`,
    });
  }

  if (country.diplomacy && Object.values(country.diplomacy).some((value) => value < -40)) {
    pressures.push({
      policy: 'militaryShare',
      delta: 0.03,
      value: 0.6,
      reason: '邻国关系恶化，军方要求增加军费',
    });
  }

  return pressures;
}

/** 按政体决定是否采纳；返回提案记录。 */
export function runPolicyRound(
  state: WorldState,
  ctx: SettleContext,
  day: number,
): PolicyProposal[] {
  void ctx;
  const proposals: PolicyProposal[] = [];

  for (const countryId of sortedIds(state.countries)) {
    const country = state.countries[countryId];
    if (!country) continue;

    for (const pressure of evaluatePolicyPressure(state, countryId)) {
      const current = country.policies[pressure.policy];
      const next = Math.min(1, Math.max(0, Number((current + pressure.delta).toFixed(4))));
      if (next === current) continue;

      const support =
        country.polity === 'monarchy'
          ? 0.4 + country.legitimacy * 0.5
          : 0.3 + Math.min(0.6, capitalWeight(state, countryId));

      const passed = pressure.value * 0.5 + support * 0.6 >= 0.45;
      if (passed) country.policies[pressure.policy] = next;

      proposals.push({
        countryId,
        policy: pressure.policy,
        delta: pressure.delta,
        pressure: Number(pressure.value.toFixed(3)),
        passed,
        reason: `${pressure.reason}${passed ? '，提案通过' : '，提案被否决'}（第 ${day} 天）`,
      });
    }
  }

  return proposals;
}

/** 国内组织资产占全国资产的比重，用作共和制投票权重。 */
export function capitalWeight(state: WorldState, countryId: CountryId): number {
  const country = state.countries[countryId];
  if (!country) return 0;
  let total = 0;
  let domestic = 0;
  for (const org of Object.values(state.organizations)) {
    total += org.assets;
    if (country.regionIds.includes(org.homeRegionId)) domestic += org.assets;
  }
  return total > 0 ? domestic / total : 0;
}
