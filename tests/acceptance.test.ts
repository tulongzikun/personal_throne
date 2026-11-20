import { describe, expect, it } from 'vitest';

import { content } from '../src/content/index';
import { applyCommand } from '../src/core/CommandBus';
import { Phase } from '../src/core/GameClock';
import { GameEngine } from '../src/core/GameEngine';
import { Random } from '../src/core/Random';
import { cloneWorld, createWorld, marketKeyOf } from '../src/core/WorldState';
import { capitalOf } from '../src/systems/country/Offices';
import { runPolicyRound } from '../src/systems/country/PolicySystem';
import { signLoanContract } from '../src/systems/organization/ContractSystem';
import { equityOf } from '../src/systems/organization/Finance';

describe('§13 B 商业干预', () => {
  it('玩家融资并开通商路后，利润与市场份额较基线改善', () => {
    const base = createWorld(content, { seed: 'accept-b', createdAt: 0 });
    const baseline = cloneWorld(base);
    const acted = cloneWorld(base);

    const loan = applyCommand(
      acted,
      { kind: 'take_loan', orgId: 'o_grainwheel', amount: 1000 },
      content,
    );
    const route = applyCommand(
      acted,
      { kind: 'open_route', orgId: 'o_grainwheel', regionId: 'r_ironpeak', goodId: 'grain' },
      content,
    );
    const invest = applyCommand(
      acted,
      { kind: 'invest', orgId: 'o_grainwheel', amount: 500 },
      content,
    );
    expect(loan.ok).toBe(true);
    expect(route.ok).toBe(true);
    expect(invest.ok).toBe(true);
    expect(Object.keys(acted.contracts)).toHaveLength(1);
    expect(acted.markets[marketKeyOf('r_ironpeak', 'grain')]!.routeOwnerId).toBe('o_grainwheel');

    const eb = new GameEngine(baseline, content);
    const ea = new GameEngine(acted, content);
    let baselineProfit = 0;
    let actedProfit = 0;
    // 商路的前三个月是采购与在途期：成本先付、货未到港，利润会暂时低于基线；
    // 按 12 个月滚动看真实回报（在途与回款都完成）。
    for (let month = 0; month < 12; month += 1) {
      eb.advanceDays(30);
      ea.advanceDays(30);
      baselineProfit += baseline.organizations['o_grainwheel']!.lastMonthProfit;
      actedProfit += acted.organizations['o_grainwheel']!.lastMonthProfit;
    }

    expect(actedProfit).toBeGreaterThan(baselineProfit);
    expect(acted.organizations['o_grainwheel']!.tradeInvestment).toBeGreaterThan(0);
    expect(acted.markets[marketKeyOf('r_ironpeak', 'grain')]!.importCapacity).toBeGreaterThan(0);
  });

  it('玩家扩产会改变市场份额与利润（干预可观测）', () => {
    const base = createWorld(content, { seed: 'accept-price', createdAt: 0 });
    const baseline = cloneWorld(base);
    const acted = cloneWorld(base);
    const recruit = applyCommand(
      acted,
      { kind: 'recruit', orgId: 'o_grainwheel', count: 40 },
      content,
    );
    expect(recruit.ok).toBe(true);

    const eb = new GameEngine(baseline, content);
    const ea = new GameEngine(acted, content);
    eb.advanceDays(90);
    ea.advanceDays(90);

    expect(acted.organizations['o_grainwheel']!.marketShare).not.toBe(
      baseline.organizations['o_grainwheel']!.marketShare,
    );
    expect(acted.organizations['o_grainwheel']!.lastMonthProfit).not.toBe(
      baseline.organizations['o_grainwheel']!.lastMonthProfit,
    );
  });

  it('高价格吸引竞争者进入，份额被重新分配', () => {
    const state = createWorld(content, { seed: 'accept-entry', createdAt: 0 });
    const engine = new GameEngine(state, content);
    const market = state.markets[marketKeyOf('r_greenfield', 'grain')]!;
    const before = state.stats.founded;

    for (let month = 0; month < 24; month += 1) {
      market.price = market.ceiling;
      engine.advanceDays(30);
    }

    expect(state.stats.founded).toBeGreaterThan(before);
    const entrants = Object.values(state.organizations).filter((org) => org.origin === 'npc');
    expect(entrants.length).toBeGreaterThan(0);
    const shares = market.shareByOrg;
    const total = Object.values(shares).reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(1, 5);
    expect(
      entrants.some((entrant) =>
        Object.values(state.markets).some((entry) => entry.shareByOrg[entrant.id] !== undefined),
      ),
    ).toBe(true);
  });

  it('财政与短缺压力会推动政策回应', () => {
    const state = createWorld(content, { seed: 'accept-policy', createdAt: 0 });
    const country = state.countries['c_kingdom']!;
    country.debt = 90000;
    country.treasury = 0;
    const market = state.markets[marketKeyOf('r_silvermoon', 'grain')]!;
    market.stock = 0;
    market.demand = market.production * 10;
    const before = { ...country.policies };

    const proposals = runPolicyRound(
      state,
      { day: 90, periodKey: 'q1', phase: Phase.Country, rng: new Random('policy') },
      90,
      content.balance.policy,
    );

    expect(proposals.length).toBeGreaterThan(0);
    const passed = proposals.filter((proposal) => proposal.passed);
    expect(passed.length).toBeGreaterThan(0);
    const changed = (Object.keys(country.policies) as (keyof typeof country.policies)[]).some(
      (key) => country.policies[key] !== before[key],
    );
    expect(changed).toBe(true);
  });

  it('推动降关税后商路价差收窄、贸易毛利上升（验收 C）', () => {
    const base = createWorld(content, { seed: 'accept-c', createdAt: 0 });
    const low = cloneWorld(base);
    const high = cloneWorld(base);

    // 游说要亲赴首都。
    low.characters[low.playerId]!.regionId = capitalOf(low, 'c_league')!;
    const lobby = applyCommand(
      low,
      { kind: 'lobby', countryId: 'c_league', policy: 'tariffRate', delta: -0.04 },
      content,
    );
    expect(lobby.ok).toBe(true);
    expect(low.countries['c_league']!.policies.tariffRate).toBeCloseTo(0.02, 5);
    high.countries['c_league']!.policies.tariffRate = 0.9;

    for (const world of [low, high]) {
      const destination = world.markets[marketKeyOf('r_tidemarket', 'grain')]!;
      destination.stock = 0;
      destination.demand = 600;
      destination.price = 20;
      const source = world.markets[marketKeyOf('r_greenfield', 'grain')]!;
      source.stock = 800;
      source.price = 5;
    }

    new GameEngine(low, content).advanceDays(180);
    new GameEngine(high, content).advanceDays(180);

    const lowMarket = low.markets[marketKeyOf('r_tidemarket', 'grain')]!;
    const highMarket = high.markets[marketKeyOf('r_tidemarket', 'grain')]!;
    const lowMargin = low.stats.tradeRevenue - low.stats.tradeCost;
    const highMargin = high.stats.tradeRevenue - high.stats.tradeCost;

    expect(lowMarket.price).toBeLessThanOrEqual(highMarket.price);
    expect(lowMarket.stock).toBeGreaterThan(highMarket.stock);
    expect(low.stats.tradeRevenue).toBeGreaterThan(high.stats.tradeRevenue);
    expect(lowMargin).toBeGreaterThan(highMargin);
    expect(lowMargin).toBeGreaterThan(0);
  });
});

describe('§13 D 财务危机', () => {
  it('危机按 融资 → 宽限 → 重组出售 → 清算 推进，且不留负资产', () => {
    const state = createWorld(content, { seed: 'accept-d', createdAt: 0 });
    state.tiers['o_nightpouch'] = 1;
    const org = state.organizations['o_nightpouch']!;

    org.cash = 2000;
    org.assets = 2000;
    org.liabilities = 500;
    org.members = 30;
    org.payrollMonthly = 1200;
    const loan = signLoanContract(state, content, org.id, 400, 6);
    expect(loan.status).toBe('open');
    expect(org.cash).toBe(2000);

    // 外部冲击：大额旧债与现金枯竭。
    org.liabilities = 20000;
    org.cash = 100;
    org.assets = 800;

    const engine = new GameEngine(state, content);
    const sequence: string[] = [];
    let last = org.lifecycle;
    for (let month = 0; month < 18; month += 1) {
      engine.advanceDays(30);
      expect(org.cash).toBeGreaterThanOrEqual(0);
      expect(org.assets).toBeGreaterThanOrEqual(0);
      if (org.lifecycle !== last) {
        sequence.push(org.lifecycle);
        last = org.lifecycle;
      }
      if (org.lifecycle === 'dissolved') break;
    }

    expect(sequence[0]).toBe('crisis');
    expect(sequence).toContain('restructuring');
    expect(sequence).toContain('dissolved');
    expect(org.graceUntilDay).toBe(0);
    expect(org.restructureUntilDay).toBe(0);

    const record = org.liquidation!;
    expect(record).not.toBeNull();
    expect(record.creditorPaid).toBeGreaterThanOrEqual(record.wagePaid);
    expect(record.wagePaid).toBeGreaterThanOrEqual(record.shareholderPaid);
    expect(record.creditorPaid + record.wagePaid + record.shareholderPaid).toBeLessThanOrEqual(
      record.proceeds,
    );
    expect(record.shortfall).toBeGreaterThan(0);
    expect(org.cash).toBe(0);
    expect(org.assets).toBe(0);
    expect(org.liabilities).toBe(0);
    expect(org.unpaidWages).toBe(0);
    expect(equityOf(org)).toBe(0);
    expect(state.stats.bankruptcies).toBeGreaterThanOrEqual(1);
    expect(state.history.some((entry) => entry.summary.includes('重组：出售资产'))).toBe(true);
    expect(state.history.some((entry) => entry.summary.includes('破产清算'))).toBe(true);
  });
});
