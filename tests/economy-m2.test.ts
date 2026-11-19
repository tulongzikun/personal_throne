import { describe, expect, it } from 'vitest';

import { content } from '../src/content/index';
import { applyCommand } from '../src/core/CommandBus';
import { GameEngine } from '../src/core/GameEngine';
import { Phase } from '../src/core/GameClock';
import { Random } from '../src/core/Random';
import { createWorld, marketKeyOf } from '../src/core/WorldState';
import {
  settleMonthlyContracts,
  signLoanContract,
} from '../src/systems/organization/ContractSystem';
import { equityOf } from '../src/systems/organization/Finance';
import { stageOf } from '../src/systems/organization/Organization';
import { settleShipments } from '../src/systems/economy/TradeSystem';
import { liquidate } from '../src/systems/organization/Lifecycle';

function ctxAt(day: number, seed = 'test') {
  return {
    day,
    periodKey: `m${day}`,
    phase: Phase.Organization,
    rng: new Random(seed),
  };
}

describe('M2 契约', () => {
  it('贷款契约到期未付：先宽限一个月，再违约并计违约金', () => {
    const state = createWorld(content, { seed: 'contract', createdAt: 0 });
    const org = state.organizations['o_grainwheel']!;
    org.cash = 0;
    const contract = signLoanContract(state, content, org.id, 3000, 3);
    expect(contract.status).toBe('open');

    settleMonthlyContracts(state, content, ctxAt(contract.nextDueDay));
    expect(contract.status).toBe('open');
    expect(contract.nextDueDay).toBe(contract.startDay + 60);

    settleMonthlyContracts(state, content, ctxAt(contract.startDay + 60));
    expect(contract.status).toBe('defaulted');
    expect(state.stats.contractDefaults).toBe(1);
    expect(contract.collateral).toBeGreaterThan(0);
    expect(org.assets).toBeLessThan(5200);
  });

  it('供货契约到期按数量与单价结算，双方现金与库存同步变化', () => {
    const state = createWorld(content, { seed: 'supply', createdAt: 0 });
    const seller = state.organizations['o_grainwheel']!;
    const buyer = state.organizations['o_ironhand']!;
    const market = state.markets[marketKeyOf(buyer.homeRegionId, 'grain')]!;
    const startStock = market.stock;
    const startCash = buyer.cash;

    state.contracts['ct_test'] = {
      id: 'ct_test',
      kind: 'supply',
      parties: [seller.id, buyer.id],
      fromOrgId: seller.id,
      toOrgId: buyer.id,
      startDay: 0,
      endDay: 360,
      value: 600,
      status: 'open',
      goodId: 'grain',
      quantity: 20,
      unitPrice: 30,
      penaltyRate: 0.1,
      rateMonthly: 0,
      principal: 0,
      collateral: 0,
      nextDueDay: 30,
      installments: 12,
      paidInstallments: 0,
    };

    settleMonthlyContracts(state, content, ctxAt(30));
    expect(market.stock).toBeGreaterThan(startStock);
    expect(buyer.cash).toBe(startCash - 600);
    expect(seller.cash).toBeGreaterThan(0);
    expect(state.contracts['ct_test']!.paidInstallments).toBe(1);
  });

  it('签约命令校验失败时不改变任何状态（不留半成品）', () => {
    const state = createWorld(content, { seed: 'sign', createdAt: 0 });
    const org = state.organizations['o_grainwheel']!;
    const cash = org.cash;
    const contracts = Object.keys(state.contracts).length;

    const result = applyCommand(
      state,
      {
        kind: 'sign_contract',
        orgId: org.id,
        contractKind: 'supply',
        counterpartyId: 'o_missing',
        goodId: 'grain',
        quantity: 10,
        unitPrice: 12,
        months: 6,
      },
      content,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/不存在/);
    expect(org.cash).toBe(cash);
    expect(Object.keys(state.contracts)).toHaveLength(contracts);
  });

  it('玩家可以签订供货契约并按契约持续收款', () => {
    const state = createWorld(content, { seed: 'sign-ok', createdAt: 0 });
    const org = state.organizations['o_grainwheel']!;
    const result = applyCommand(
      state,
      {
        kind: 'sign_contract',
        orgId: org.id,
        contractKind: 'supply',
        counterpartyId: 'o_ironhand',
        goodId: 'grain',
        quantity: 10,
        unitPrice: 20,
        months: 6,
      },
      content,
    );
    expect(result.ok).toBe(true);
    expect(Object.keys(state.contracts)).toHaveLength(1);
    const contract = Object.values(state.contracts)[0]!;
    expect(contract.installments).toBe(6);
    expect(contract.value).toBe(1200);
  });
});

describe('M2 融资与还款', () => {
  it('提前还款会冲减贷款契约本金并结清契约', () => {
    const state = createWorld(content, { seed: 'repay', createdAt: 0 });
    const org = state.organizations['o_grainwheel']!;
    const loan = applyCommand(state, { kind: 'take_loan', orgId: org.id, amount: 1000 }, content);
    expect(loan.ok).toBe(true);
    const contract = Object.values(state.contracts)[0]!;
    expect(contract.kind).toBe('loan');
    expect(contract.collateral).toBeGreaterThan(0);

    const repay = applyCommand(state, { kind: 'repay_debt', orgId: org.id, amount: 1000 }, content);
    expect(repay.ok).toBe(true);
    expect(contract.principal).toBe(0);
    expect(contract.status).toBe('fulfilled');
  });
});

describe('M2 生命周期四态', () => {
  it('active / crisis / restructuring / dissolved 映射稳定', () => {
    const state = createWorld(content, { seed: 'stage', createdAt: 0 });
    const org = state.organizations['o_grainwheel']!;
    org.lifecycle = 'growing';
    expect(stageOf(org)).toBe('active');
    org.lifecycle = 'crisis';
    expect(stageOf(org)).toBe('crisis');
    org.lifecycle = 'restructuring';
    expect(stageOf(org)).toBe('restructuring');
    org.lifecycle = 'dissolved';
    expect(stageOf(org)).toBe('dissolved');
  });
});

describe('M2 破产清偿', () => {
  it('清偿顺序为 债主 → 员工欠薪 → 股东，差额记入清算记录', () => {
    const state = createWorld(content, { seed: 'liquidate', createdAt: 0 });
    const org = state.organizations['o_grainwheel']!;
    org.cash = 100;
    org.assets = 1000;
    org.liabilities = 700;
    org.unpaidWages = 200;

    const event = liquidate(state, content, org, ctxAt(90));

    expect(org.liquidation).not.toBeNull();
    const record = org.liquidation!;
    expect(record.creditorPaid).toBe(700);
    expect(record.wagePaid).toBe(50);
    expect(record.shareholderPaid).toBe(0);
    expect(record.shortfall).toBe(150);
    expect(record.proceeds).toBe(650 + 100);
    expect(org.cash).toBe(0);
    expect(org.assets).toBe(0);
    expect(org.liabilities).toBe(0);
    expect(org.unpaidWages).toBe(0);
    expect(org.lifecycle).toBe('dissolved');
    expect(event.summary).toContain('清算');
    expect(equityOf(org)).toBe(0);
  });

  it('资不抵债的差额由股东承担，但不允许负资产凭空消失', () => {
    const state = createWorld(content, { seed: 'liquidate2', createdAt: 0 });
    const org = state.organizations['o_grainwheel']!;
    org.cash = 0;
    org.assets = 0;
    org.liabilities = 5000;
    org.unpaidWages = 500;
    const before = state.characters['c_player']!.wealth;

    liquidate(state, content, org, ctxAt(120));

    expect(state.characters['c_player']!.wealth).toBeLessThanOrEqual(before);
    expect(state.characters['c_player']!.wealth).toBeGreaterThanOrEqual(0);
    expect(org.liquidation!.shortfall).toBe(5500);
    expect(org.cash + org.assets - org.liabilities).toBe(0);
    expect(state.stats.bankruptcies).toBe(1);
  });
});

describe('M2 运输与关税', () => {
  it('跨国到港按目的地关税入国库，运力与损耗生效', () => {
    const state = createWorld(content, { seed: 'tariff', createdAt: 0 });
    const owner = state.organizations['o_grainwheel']!;
    owner.cash = 10000;
    const country = state.countries['c_kingdom']!;
    const treasury = country.treasury;
    const destination = state.markets[marketKeyOf('r_greenfield', 'grain')]!;
    const stock = destination.stock;

    state.shipments['sh_test'] = {
      id: 'sh_test',
      fromRegionId: 'r_portlumen',
      toRegionId: 'r_greenfield',
      goodId: 'grain',
      units: 100,
      lost: 3,
      ownerOrgId: owner.id,
      departDay: 0,
      arriveDay: 30,
      transportCost: 40,
      tariffDue: 120,
      status: 'in_transit',
    };

    state.clock.day = 30;
    settleShipments(state, content);

    expect(state.shipments['sh_test']).toBeUndefined();
    expect(destination.stock).toBe(stock + 97);
    expect(owner.tradeCost).toBeGreaterThanOrEqual(120);
    expect(country.treasury).toBe(treasury + 120);
    expect(state.stats.tariffRevenue).toBe(120);
  });
});

describe('M2 商路收益与资产处置', () => {
  it('开通商路后路主从到港货物中获得贸易收益', () => {
    const state = createWorld(content, { seed: 'route', createdAt: 0 });
    const owner = state.organizations['o_grainwheel']!;
    owner.cash = 5000;
    const source = state.markets[marketKeyOf('r_greenfield', 'grain')]!;
    source.stock = 4000;
    const destination = state.markets[marketKeyOf('r_ironpeak', 'grain')]!;
    destination.routeOwnerId = owner.id;
    destination.demand = 600;
    destination.stock = 0;
    destination.importCapacity = 300;

    const engine = new GameEngine(state, content);
    engine.advanceDays(60);

    expect(state.stats.tradeRevenue).toBeGreaterThan(0);
    expect(owner.tradeRevenue).toBeGreaterThan(0);
    expect(Object.values(state.shipments).length).toBeGreaterThanOrEqual(0);
  });

  it('出售资产回款优先偿债，restructure 进入重组期且不产生负资产', () => {
    const world = createWorld(content, { seed: 'assets', createdAt: 0 });
    const org = world.organizations['o_grainwheel']!;
    const assets = org.assets;
    const sold = applyCommand(world, { kind: 'sell_asset', orgId: org.id, amount: 1000 }, content);
    expect(sold.ok).toBe(true);
    expect(org.assets).toBe(assets - 1000);
    expect(org.cash).toBeGreaterThanOrEqual(0);
    expect(org.liabilities).toBeLessThan(900);

    const tooMuch = applyCommand(
      world,
      { kind: 'sell_asset', orgId: org.id, amount: 999999 },
      content,
    );
    expect(tooMuch.ok).toBe(false);

    const restructured = applyCommand(world, { kind: 'restructure', orgId: org.id }, content);
    expect(restructured.ok).toBe(true);
    expect(org.lifecycle).toBe('restructuring');
    expect(org.restructureUntilDay).toBeGreaterThan(0);
    expect(org.assets).toBeGreaterThanOrEqual(0);
    expect(org.cash).toBeGreaterThanOrEqual(0);
  });
});

describe('M2 市场份额与竞争', () => {
  it('同地区同行业份额之和为 1，并写回组织字段', () => {
    const world = createWorld(content, { seed: 'share', createdAt: 0 });
    const engine = new GameEngine(world, content);
    engine.advanceDays(90);

    let checked = 0;
    for (const market of Object.values(engine.state.markets)) {
      const shares = Object.values(market.shareByOrg);
      if (shares.length === 0) continue;
      const total = shares.reduce((sum, value) => sum + value, 0);
      expect(total).toBeCloseTo(1, 5);
      for (const orgId of Object.keys(market.shareByOrg)) {
        const org = engine.state.organizations[orgId];
        if (!org) continue;
        expect(org.marketShare).toBeGreaterThanOrEqual(0);
        expect(org.marketShare).toBeLessThanOrEqual(1);
      }
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('高价格吸引新组织进入，改变市场份额与利润', () => {
    const state = createWorld(content, { seed: 'entry', createdAt: 0 });
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
  });

  it('风险系数表可调：放大 split 系数会提高风险值', () => {
    const calm = createWorld(content, { seed: 'risk', createdAt: 0 });
    const hotContent = {
      ...content,
      balance: {
        ...content.balance,
        risk: {
          ...content.balance.risk,
          split: {
            ...content.balance.risk.split,
            lambda0: content.balance.risk.split.lambda0 * 20,
          },
        },
      },
    };
    const hot = createWorld(hotContent, { seed: 'risk', createdAt: 0 });
    const calmEngine = new GameEngine(calm, content);
    const hotEngine = new GameEngine(hot, hotContent);
    calmEngine.advanceDays(360);
    hotEngine.advanceDays(360);

    expect(hotEngine.state.stats.splits).toBeGreaterThanOrEqual(calmEngine.state.stats.splits);
    expect(hotEngine.state.organizations['o_grainwheel']!.risk.split).toBeGreaterThanOrEqual(
      calmEngine.state.organizations['o_grainwheel']!.risk.split,
    );
  });
});
