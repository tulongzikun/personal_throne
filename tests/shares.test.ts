/**
 * M6.2 第 3 阶段：股份交易与领袖更替。
 *
 * 只测命令语义：份额搬移、现金结算、接管门槛与失败路径。
 */

import { describe, expect, it } from 'vitest';
import { content } from '../src/content/index';
import { applyCommand } from '../src/core/CommandBus';
import { shareOf } from '../src/systems/organization/Organization';
import { LEADERSHIP_MIN_SHARE, unassignedShare } from '../src/systems/organization/Shares';
import { makeEngine, makeWorld } from './helpers';

const ORG = 'o_grainwheel';

describe('股份交易', () => {
  it('买入把份额从最大股东搬给玩家，并按估值付款', () => {
    const state = makeWorld('shares');
    const player = state.playerId;
    state.characters[player]!.wealth = 50000;
    const org = state.organizations[ORG]!;
    const beforePlayer = shareOf(org, player);
    const beforeHob = shareOf(org, 'c_grainwheel_hob');
    const beforeCash = state.characters[player]!.wealth;

    const result = applyCommand(state, { kind: 'buy_shares', orgId: ORG, share: 0.05 }, content);

    expect(result.ok).toBe(true);
    expect(shareOf(org, player)).toBeCloseTo(beforePlayer + 0.05, 6);
    expect(shareOf(org, 'c_grainwheel_hob')).toBeCloseTo(beforeHob - 0.05, 6);
    expect(state.characters[player]!.wealth).toBeLessThan(beforeCash);
    expect(state.characters['c_grainwheel_hob']!.wealth).toBeGreaterThan(0);
  });

  it('买得比可售份额多时拒绝，且不改动任何股份', () => {
    const state = makeWorld('shares');
    const player = state.playerId;
    const org = state.organizations[ORG]!;
    const before = shareOf(org, player);

    const result = applyCommand(state, { kind: 'buy_shares', orgId: ORG, share: 0.9 }, content);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('份额不足');
    expect(shareOf(org, player)).toBeCloseTo(before, 6);
  });

  it('现金不足时拒绝', () => {
    const state = makeWorld('shares');
    state.characters[state.playerId]!.wealth = 1;

    const result = applyCommand(state, { kind: 'buy_shares', orgId: ORG, share: 0.05 }, content);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('现金不足');
  });

  it('卖出降低份额并换回现金', () => {
    const state = makeWorld('shares');
    const player = state.playerId;
    const org = state.organizations[ORG]!;
    const beforeShare = shareOf(org, player);
    const beforeCash = state.characters[player]!.wealth;
    const beforeFree = unassignedShare(org);

    const result = applyCommand(state, { kind: 'sell_shares', orgId: ORG, share: 0.05 }, content);

    expect(result.ok).toBe(true);
    expect(shareOf(org, player)).toBeCloseTo(beforeShare - 0.05, 6);
    expect(state.characters[player]!.wealth).toBeGreaterThan(beforeCash);
    expect(unassignedShare(org)).toBeCloseTo(beforeFree, 6);
  });

  it('份额不足 34% 时不能接管字号', () => {
    const state = makeWorld('shares');
    const org = state.organizations[ORG]!;
    expect(shareOf(org, state.playerId)).toBeLessThan(LEADERSHIP_MIN_SHARE);

    const result = applyCommand(state, { kind: 'claim_leadership', orgId: ORG }, content);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('34%');
    expect(org.leadership.leaderId).toBe('c_grainwheel_hob');
  });

  it('买到超过现任领袖后可以接管字号，并由引擎写入历史', () => {
    const engine = makeEngine('shares-claim');
    const state = engine.state;
    const player = state.playerId;
    state.characters[player]!.wealth = 200000;
    const org = state.organizations[ORG]!;

    expect(engine.dispatch({ kind: 'buy_shares', orgId: ORG, share: 0.2 }).ok).toBe(true);
    expect(shareOf(org, player)).toBeGreaterThan(shareOf(org, 'c_grainwheel_hob'));

    const claim = engine.dispatch({ kind: 'claim_leadership', orgId: ORG });
    expect(claim.ok).toBe(true);
    expect(org.leadership.leaderId).toBe(player);
    expect(state.history.some((record) => record.summary.includes('接管'))).toBe(true);
  });
});
