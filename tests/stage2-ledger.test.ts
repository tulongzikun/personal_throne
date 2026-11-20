import { describe, expect, it } from 'vitest';
import { content, makeEngine, makeWorld } from './helpers/index';
import { Random } from '../src/core/Random';
import { settleMonthlyCountry } from '../src/systems/country/CountrySystem';
import { settleMonthlyFinance } from '../src/systems/organization/Finance';

describe('阶段 2：账本闭合', () => {
  it('生涯月俸 ≥90% 真正进了个人钱袋', () => {
    const engine = makeEngine();
    engine.advanceDays(3600);
    const stats = engine.state.stats;
    const booked = stats.wagesBooked ?? 0;
    const credited = stats.wagesCredited ?? 0;
    expect(booked).toBeGreaterThan(0);
    expect(credited / booked).toBeGreaterThanOrEqual(0.9);
  });

  it('组织欠薪被补发时，钱进在岗成员的口袋而不是凭空消失', () => {
    const world = makeWorld();
    const org = world.organizations['o_grainwheel']!;
    const player = world.characters[world.playerId]!;
    player.organizationId = org.id;
    player.careerRank = 3;
    org.unpaidWages = 500;
    org.liabilities = 500;
    org.payrollMonthly = 10;
    org.cash = 5000;
    const before = player.wealth;
    settleMonthlyFinance(world, content);
    expect(org.unpaidWages).toBeLessThan(500);
    expect(player.wealth).toBeGreaterThan(before);
  });

  it('国债有债权人：赤字借债记到组织名下，还本时钱回流组织', () => {
    const world = makeWorld();
    const country = world.countries['c_kingdom']!;
    country.treasury = 0;
    country.debt = 0;
    country.creditors = {};
    country.policies.taxRate = 0.02;
    country.policies.militaryShare = 0.9;
    const ctx = {
      day: 30,
      periodKey: 'm1',
      phase: 4 as never,
      rng: new Random('stage2'),
    };
    settleMonthlyCountry(world, content, ctx);
    expect(country.debt).toBeGreaterThan(0);
    const held = Object.values(country.creditors).reduce((sum, value) => sum + value, 0);
    expect(held).toBeGreaterThan(0);
    expect(held).toBeLessThanOrEqual(country.debt);

    // 盈余月：国库有钱后按持仓还本，债权人现金增加。
    const creditorId = Object.keys(country.creditors)[0]!;
    const creditor = world.organizations[creditorId]!;
    const before = creditor.cash;
    country.treasury = country.debt + 10_000;
    country.policies.taxRate = 0.3;
    country.policies.militaryShare = 0.05;
    settleMonthlyCountry(world, content, { ...ctx, day: 60, periodKey: 'm2' });
    expect(creditor.cash).toBeGreaterThan(before);
  });

  it('国家俸禄只扣一次：国库变化等于 balance 减还本与公共工程', () => {
    const world = makeWorld();
    const country = world.countries['c_league']!;
    country.treasury = 20_000;
    country.debt = 0;
    const ctx = { day: 30, periodKey: 'm1', phase: 4 as never, rng: new Random('stage2') };
    const before = country.treasury;
    const budgets = settleMonthlyCountry(world, content, ctx);
    const budget = budgets.find((item) => item.countryId === country.id)!;
    const repaid = country.debt === 0 ? 0 : 0;
    expect(budget.balance).toBe(budget.revenue - budget.expense);
    expect(country.treasury).toBe(before + budget.balance - budget.publicWorks - repaid);
    expect(country.treasury).toBeGreaterThanOrEqual(0);
  });
});
