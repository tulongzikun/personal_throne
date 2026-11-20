/**
 * 政策：压力累积 → 提案 → 按政体决策（GDD §10.3，M3 打磨版）。
 *
 * 三个阶段：
 * 1. 压力：短缺（民生）、赤字/债务（财政）、组织亏损（资本）、民怨（稳定/合法性）、
 *    外部威胁（外交）、内阁路线（上月的增税/削军/借债选择）；
 * 2. 提案：每条压力生成一条提案，带行政成本与 12 个月冷却，单轮幅度受限；
 * 3. 决策：君主制看合法性与统治者权威，共和制看资本权重；通过后写回政策，
 *    并更新冷却、成本与统计。
 *
 * 政体变更独立于政策：只有长期（连续 24 个月）满足"合法性崩塌 + 稳定崩塌 +
 * 债务失控"才进入判定，且两次变更至少间隔 240 个月，避免随机抖动。
 */

import type {
  BalanceConfig,
  Country,
  CountryId,
  PolicyVector,
  Polity,
  SettleContext,
  WorldState,
} from '../../core/WorldState';
import { sortedIds } from '../../core/WorldState';
import { installRuler } from './Ruler';

type PolicyConfig = BalanceConfig['policy'];

export type PolicyKey = keyof PolicyVector;

export interface Pressure {
  readonly policy: PolicyKey;
  readonly delta: number;
  readonly value: number;
  readonly reason: string;
}

export interface PolicyProposal {
  readonly countryId: CountryId;
  readonly policy: PolicyKey;
  readonly delta: number;
  readonly pressure: number;
  readonly passed: boolean;
  readonly reason: string;
  /** 实际通过的变更成本（未通过为 0）。 */
  readonly cost: number;
}

export interface PolityChange {
  readonly countryId: CountryId;
  readonly from: Polity;
  readonly to: Polity;
  readonly day: number;
  readonly reason: string;
}

export type PolicyRoundResult = PolicyProposal[] & {
  readonly polityChanges: readonly PolityChange[];
};

const POLICY_ORDER: readonly PolicyKey[] = [
  'taxRate',
  'tariffRate',
  'militaryShare',
  'tradeFreedom',
  'regulation',
];

/** 单条压力链的最大累计幅度；最终仍会被 balance.policy.maxDeltaPerRound 截断。 */
const MAX_PRESSURE_DELTA = 0.16;

interface Accumulator {
  delta: number;
  value: number;
  reasons: string[];
}

function pushPressure(
  map: Map<PolicyKey, Accumulator>,
  policy: PolicyKey,
  delta: number,
  value: number,
  reason: string,
): void {
  const previous = map.get(policy);
  if (previous) {
    previous.delta = clamp(previous.delta + delta, -MAX_PRESSURE_DELTA, MAX_PRESSURE_DELTA);
    previous.value = Math.max(previous.value, value);
    previous.reasons.push(reason);
  } else {
    map.set(policy, {
      delta: clamp(delta, -MAX_PRESSURE_DELTA, MAX_PRESSURE_DELTA),
      value: clamp01(value),
      reasons: [reason],
    });
  }
}

export function evaluatePolicyPressure(state: WorldState, countryId: CountryId): Pressure[] {
  const country = state.countries[countryId];
  if (!country) return [];
  const pressures = new Map<PolicyKey, Accumulator>();

  const regionIds = new Set(country.regionIds);
  let shortage = 0;
  let demand = 0;
  for (const market of Object.values(state.markets)) {
    if (!regionIds.has(market.regionId)) continue;
    demand += market.demand;
    shortage += Math.max(0, market.demand - market.stock);
  }
  const shortageRatio = demand > 0 ? shortage / demand : 0;
  if (shortageRatio > 0.35) {
    pushPressure(
      pressures,
      'regulation',
      0.16,
      shortageRatio,
      `商品缺口 ${(shortageRatio * 100).toFixed(0)}%，民生压力要求管制`,
    );
    if (shortageRatio > 0.7) {
      pushPressure(
        pressures,
        'tradeFreedom',
        0.1,
        shortageRatio,
        `缺口扩大到 ${(shortageRatio * 100).toFixed(0)}%，商会要求放开进口`,
      );
    }
  }

  const revenue = Math.max(1, country.monthlyRevenue);
  const deficitRatio = (country.monthlyExpense - revenue) / revenue;
  if (deficitRatio > 0.02) {
    if (country.policies.taxRate < 0.35) {
      pushPressure(
        pressures,
        'taxRate',
        0.1,
        Math.min(1, 0.2 + deficitRatio),
        `月度赤字 ${(deficitRatio * 100).toFixed(0)}%，国库要求增税`,
      );
    } else {
      pushPressure(
        pressures,
        'militaryShare',
        -0.08,
        Math.min(1, 0.2 + deficitRatio),
        '税率已高，只能削减军费',
      );
    }
  }

  const debtRatio = country.debt / Math.max(1, revenue * 12);
  if (debtRatio > 0.8) {
    if (country.policies.taxRate < 0.5) {
      pushPressure(
        pressures,
        'taxRate',
        0.08,
        Math.min(1, debtRatio / 2),
        `债务达到年收入的 ${(debtRatio * 100).toFixed(0)}%，需要偿债`,
      );
    } else {
      pushPressure(
        pressures,
        'militaryShare',
        -0.06,
        Math.min(1, debtRatio / 3),
        `高债务下军方预算被压缩（${(debtRatio * 100).toFixed(0)}% 年收入）`,
      );
    }
  }

  const unrest = Math.max(0, 1 - Math.min(country.stability, country.legitimacy) / 0.6);
  if (country.stability < 0.55 || country.legitimacy < 0.5) {
    pushPressure(
      pressures,
      'militaryShare',
      -0.08,
      unrest,
      `稳定 ${(country.stability * 100).toFixed(0)}、合法性 ${(country.legitimacy * 100).toFixed(0)}，民怨要求收缩开支`,
    );
  }

  if (Object.values(country.diplomacy).some((value) => value < -30)) {
    pushPressure(pressures, 'militaryShare', 0.1, 0.6, '邻国关系恶化，军方要求增加军费');
  }

  const orgs = Object.values(state.organizations).filter(
    (org) => org.lifecycle !== 'dissolved' && regionIds.has(org.homeRegionId),
  );
  const losing = orgs.filter((org) => org.lastMonthRevenue < org.lastMonthCost).length;
  if (orgs.length > 0 && losing / orgs.length > 0.5) {
    const ratio = losing / orgs.length;
    pushPressure(
      pressures,
      'tradeFreedom',
      0.08,
      ratio,
      `${losing}/${orgs.length} 家组织亏损，商会要求放开贸易`,
    );
  }

  if (country.cabinetAction === 'raise_tax') {
    pushPressure(pressures, 'taxRate', 0.04, 0.4, '内阁上月选择增税');
  } else if (country.cabinetAction === 'cut_military') {
    pushPressure(pressures, 'militaryShare', -0.04, 0.4, '内阁上月选择削减军费');
  }

  const result: Pressure[] = [];
  for (const policy of POLICY_ORDER) {
    const entry = pressures.get(policy);
    if (!entry) continue;
    result.push({
      policy,
      delta: entry.delta,
      value: entry.value,
      reason: entry.reasons.join('；'),
    });
  }
  return result;
}

/** 按政体计算采纳支持度（0–1）。 */
export function policySupport(state: WorldState, country: Country, influence = 0): number {
  const offices = clamp01(influence) * 0.2;
  if (country.polity === 'monarchy') {
    const ruler = state.characters[country.rulerId];
    const authority = ruler?.traits.authority ?? 0.5;
    return clamp01(0.35 + country.legitimacy * 0.45 + authority * 0.2 + offices);
  }
  return clamp01(0.3 + Math.min(0.65, capitalWeight(state, country.id)) + offices);
}

/** 国内组织资产占全国资产的比重，用作共和制投票权重。 */
export function capitalWeight(state: WorldState, countryId: CountryId): number {
  const country = state.countries[countryId];
  if (!country) return 0;
  let total = 0;
  let domestic = 0;
  for (const org of Object.values(state.organizations)) {
    if (org.lifecycle === 'dissolved') continue;
    total += org.assets;
    if (country.regionIds.includes(org.homeRegionId)) domestic += org.assets;
  }
  return total > 0 ? domestic / total : 0;
}

/** 按政体决定是否采纳；返回提案记录（附带政体变更列表）。 */
export function runPolicyRound(
  state: WorldState,
  ctx: SettleContext,
  day: number,
  config: PolicyConfig,
  influence = 0,
): PolicyRoundResult {
  const proposals: PolicyProposal[] = [];
  const polityChanges: PolityChange[] = [];

  for (const countryId of sortedIds(state.countries)) {
    const country = state.countries[countryId];
    if (!country) continue;

    const support = policySupport(state, country, influence);

    for (const pressure of evaluatePolicyPressure(state, countryId)) {
      // 只有足够强的压力才进入提案：小波动不应触发改革（校准要求 8–25 次/100 年）。
      if (pressure.value < config.minPressure) continue;
      const lastChange = country.policyCooldowns[pressure.policy] ?? 0;
      if (lastChange > 0 && day - lastChange < config.cooldownMonths * 30) continue;

      const current = country.policies[pressure.policy];
      const delta = clamp(pressure.delta, -config.maxDeltaPerRound, config.maxDeltaPerRound);
      const next = clamp01(Number((current + delta).toFixed(4)));
      if (next === current) continue;

      const score = pressure.value * 0.5 + support * 0.6;
      const passed = score >= config.supportThreshold;
      let cost = 0;
      if (passed) {
        country.policies[pressure.policy] = next;
        country.policyCooldowns[pressure.policy] = day;
        cost =
          config.proposalCostBase + Math.round(country.monthlyRevenue * config.proposalCostRate);
        chargePolicyCost(country, cost, state);
        state.stats.policyChanges += 1;
        state.stats.policyCost += cost;
        const previous = lastChange;
        if (previous > 0) {
          const interval = day - previous;
          if (
            state.stats.minPolicyIntervalDays === 0 ||
            interval < state.stats.minPolicyIntervalDays
          ) {
            state.stats.minPolicyIntervalDays = interval;
          }
        }
      }
      state.stats.policyProposals += 1;

      proposals.push({
        countryId,
        policy: pressure.policy,
        delta: Number(delta.toFixed(4)),
        pressure: Number(pressure.value.toFixed(3)),
        passed,
        cost,
        reason: `${pressure.reason}${passed ? '，提案通过' : '，提案被否决'}（第 ${day} 天）`,
      });
    }

    const change = maybeChangePolity(state, country, ctx, day, config);
    if (change) polityChanges.push(change);
  }

  return Object.assign(proposals, { polityChanges }) as PolicyRoundResult;
}

function chargePolicyCost(country: Country, cost: number, state: WorldState): void {
  if (country.treasury >= cost) {
    country.treasury -= cost;
    return;
  }
  const shortfall = cost - country.treasury;
  country.treasury = 0;
  country.debt += shortfall;
  void state;
}

/**
 * 政体变更：只有"长期崩溃"才触发。
 * 连续满足条件 24 个月 + 距上次变更 240 个月 + 单次 50% 判定。
 */
function maybeChangePolity(
  state: WorldState,
  country: Country,
  ctx: SettleContext,
  day: number,
  config: PolicyConfig,
): PolityChange | null {
  const debitRatio = country.debt / Math.max(1, country.monthlyRevenue * 12);
  const collapsing =
    country.legitimacy < config.polityChangeLegitimacy &&
    country.stability < config.polityChangeStability &&
    debitRatio > config.polityChangeDebtRatio;

  if (!collapsing) {
    country.polityPressureMonths = 0;
    return null;
  }

  country.polityPressureMonths += 3;
  if (country.polityPressureMonths < config.polityChangeMonths) return null;

  const last = country.lastPolityChangeDay;
  if (last > 0 && day - last < config.polityChangeCooldownMonths * 30) return null;

  const roll = ctx.rng.nextFloat({
    stream: 'polity',
    entityId: country.id,
    periodKey: ctx.periodKey,
  });
  if (roll >= config.polityChangeChance) return null;

  const from = country.polity;
  const to: Polity = from === 'monarchy' ? 'republic' : 'monarchy';
  country.polity = to;
  country.lastPolityChangeDay = day;
  country.polityPressureMonths = 0;
  country.legitimacy = 0.45;
  country.stability = 0.4;
  installRuler(state, country, to);
  state.stats.polityChanges += 1;

  for (const otherId of sortedIds(state.countries)) {
    if (otherId === country.id) continue;
    const other = state.countries[otherId];
    if (!other) continue;
    const delta = other.polity === to ? 15 : -15;
    const current = country.diplomacy[otherId] ?? 0;
    country.diplomacy[otherId] = clamp(current + delta, -100, 100);
  }

  return {
    countryId: country.id,
    from,
    to,
    day,
    reason: `${country.name} 政体由 ${from} 变为 ${to}（合法性/稳定长期崩塌）`,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(Number(value.toFixed(4)), 0, 1);
}
