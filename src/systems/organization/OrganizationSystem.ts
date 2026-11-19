/**
 * 组织系统：月度结算编排。
 *
 * 顺序固定（铁律：先财务再风险再结构，最后生命周期）：
 *   1. Finance            —— 损益、市场份额、欠薪、税费、利息、权益；
 *   2. OrganizationRisk   —— 冲突/合法性/治理/效率漂移与四类风险强度；
 *   3. 结构               —— 规模随盈利与效率微调，成员流入流出；
 *   4. Lifecycle          —— 危机 → 宽限 → 重组 → 清算；
 *   5. 市场进入           —— 高价 + 低竞争时 NPC 竞争者进入。
 */

import type { OrgId, SettleContext, WorldContent, WorldState } from '../../core/WorldState';
import { marketKeyOf, sortedIds } from '../../core/WorldState';
import { settleMonthlyFinance, type FinanceEntry } from './Finance';
import { settleMonthlyRisk, type RiskDelta } from './OrganizationRisk';
import {
  settleOrganizationLifecycle,
  type LifecycleEvent,
  type LifecycleResult,
} from './Lifecycle';
import { settleMonthlyContracts } from './ContractSystem';

export interface OrganizationSettlement {
  readonly finance: readonly FinanceEntry[];
  readonly risk: readonly RiskDelta[];
  readonly dissolved: readonly string[];
  readonly events: readonly LifecycleEvent[];
  readonly created: readonly OrgId[];
}

export function monthlyOrganizationSettlement(
  state: WorldState,
  content: WorldContent,
  ctx: SettleContext,
): OrganizationSettlement {
  const finance = settleMonthlyFinance(state, content);
  const risk = settleMonthlyRisk(state, content, ctx);

  for (const orgId of sortedIds(state.organizations)) {
    const org = state.organizations[orgId];
    if (!org) continue;
    if ((state.tiers[org.id] ?? 3) > 2) continue;
    if (org.lifecycle === 'dissolved') continue;

    const profit = org.lastMonthRevenue - org.lastMonthCost;
    // 份额越高，可扩张的空间越小：垄断者不再无限增长，除非新竞争者进入。
    const room = Math.max(0, 1 - org.marketShare);
    const growth = profit > 0 ? 0.02 * room : -0.01;
    org.scale = Math.min(3, Math.max(0.1, Number((org.scale * (1 + growth)).toFixed(4))));

    // 成员随规模缓慢调整，工资同步重算（保持 per-head 工资不跳变）。
    const perHead = Math.max(1, Math.round(org.payrollMonthly / Math.max(1, org.members)));
    const region = state.regions[org.homeRegionId];
    const memberCap = Math.max(1, Math.round((region?.population ?? 1000) * 0.02));
    const targetMembers = Math.min(memberCap, Math.max(1, Math.round(org.members * (1 + growth))));
    const delta = targetMembers - org.members;
    if (delta !== 0) {
      org.members = targetMembers;
      org.payrollMonthly = perHead * org.members;
    }
  }

  const contracts = settleMonthlyContracts(state, content, ctx);
  const lifecycle: LifecycleResult = settleOrganizationLifecycle(state, content, ctx);
  const entry = maybeEnterMarkets(state, content, ctx);

  return {
    finance,
    risk,
    dissolved: lifecycle.dissolved,
    events: [...contracts.events, ...lifecycle.events, ...entry.events],
    created: entry.created,
  };
}

interface EntryResult {
  readonly events: LifecycleEvent[];
  readonly created: OrgId[];
}

/**
 * 竞争进入：当某地区某商品价格显著高于基准价、且同行业组织少于上限时，
 * NPC 商人带着资本进入。新组织会立刻改变下一月的产量、价格与份额。
 */
function maybeEnterMarkets(
  state: WorldState,
  content: WorldContent,
  ctx: SettleContext,
): EntryResult {
  const events: LifecycleEvent[] = [];
  const created: OrgId[] = [];
  const { entryPriceRatio, maxOrgsPerMarket, entryCapital } = content.balance.market;

  for (const regionId of sortedIds(state.regions)) {
    const region = state.regions[regionId];
    if (!region) continue;
    for (const good of content.goods) {
      const market = state.markets[marketKeyOf(regionId, good.id)];
      if (!market) continue;
      if (market.price < good.basePrice * entryPriceRatio) continue;

      let rivals = 0;
      for (const rivalId of sortedIds(state.organizations)) {
        const rival = state.organizations[rivalId];
        if (!rival || rival.lifecycle === 'dissolved') continue;
        if (rival.homeRegionId === regionId && rival.industry === good.id) rivals += 1;
      }
      if (rivals >= maxOrgsPerMarket) continue;

      const chance = 0.12;
      const key = {
        stream: 'entry',
        entityId: `${regionId}:${good.id}`,
        periodKey: ctx.periodKey,
      };
      if (!ctx.rng.chance(key, chance)) continue;

      const leader = pickFreeCharacter(state, regionId);
      if (!leader) continue;

      state.orgSeq += 1;
      let id = `o_npc_${state.orgSeq}`;
      while (state.organizations[id]) {
        state.orgSeq += 1;
        id = `o_npc_${state.orgSeq}`;
      }
      const members = 18;
      state.organizations[id] = {
        id,
        name: `${region.name.slice(0, 2)}${good.name}行`,
        type: 'company',
        industry: good.id,
        foundedDay: ctx.day,
        homeRegionId: regionId,
        origin: 'npc',
        scale: 0.3,
        cash: entryCapital,
        assets: Math.round(entryCapital * 2),
        liabilities: Math.round(entryCapital * 0.4),
        members,
        payrollMonthly: members * content.balance.finance.payrollPerMember,
        leadership: { leaderId: leader.id, legitimacy: 0.55 },
        conflict: 0.2,
        governance: 0.6,
        efficiency: 0.55,
        strategy: 'expand',
        lifecycle: 'founded',
        shares: [{ characterId: leader.id, share: 0.7 }],
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
      leader.organizationId = id;
      state.stats.founded += 1;
      created.push(id);
      events.push({
        kind: 'milestone',
        summary: `${ctx.day} ${region.name} 的${good.name}价 ${market.price} 高于基准 ${good.basePrice}，${leader.name} 创办 ${state.organizations[id]?.name ?? id} 进入市场`,
        refs: [
          { kind: 'organization', id },
          { kind: 'character', id: leader.id },
        ],
      });
    }
  }

  return { events, created };
}

function pickFreeCharacter(
  state: WorldState,
  regionId: string,
): WorldState['characters'][string] | null {
  const candidates = sortedIds(state.characters)
    .map((id) => state.characters[id])
    .filter(
      (character) =>
        character !== undefined &&
        character.alive &&
        character.organizationId === null &&
        character.regionId === regionId,
    );
  return candidates[0] ?? null;
}
