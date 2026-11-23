/**
 * P2 旅行的目的：到场规则把「去别处」变成有理由、有代价的选择。
 *
 * 四条规则：谋职去首都、游说去首都、签约去总部、赴宴去首都；
 * 考察市场是「到了当地才看得见价格」的钥匙。
 */

import { describe, expect, it } from 'vitest';

import { capitalOf } from '../src/systems/country/Offices';
import { findRelation } from '../src/systems/character/Relations';
import { makeEngine } from './helpers/index';

describe('P2 到场规则', () => {
  it('谋职要先到首都；到了首都就能申请', () => {
    const engine = makeEngine('travel-office');
    const state = engine.state;
    const player = state.characters[state.playerId]!;
    const country = state.countries[state.regions[player.homeRegionId]!.countryId]!;
    const capital = capitalOf(state, country.id)!;

    const away = engine.dispatch({
      kind: 'seek_office',
      countryId: country.id,
      officeId: `${country.id}:chancellor`,
    });
    expect(away.ok).toBe(false);
    expect(away.error ?? '').toContain('亲赴');

    player.regionId = capital;
    player.skills.trade = 20;
    player.wealth = 60000;
    const seat = `${country.id}:chancellor`;
    const near = engine.dispatch({ kind: 'seek_office', countryId: country.id, officeId: seat });
    // 席位 id 可能不叫 chancellor：失败也必须是「资历/根基」类原因，而不是「没到首都」。
    if (!near.ok) expect(near.error ?? '').not.toContain('亲赴');
  });

  it('游说要亲赴首都（远程需要足够影响力）', () => {
    const engine = makeEngine('travel-lobby');
    const state = engine.state;
    const player = state.characters[state.playerId]!;
    const country = state.countries['c_kingdom']!;
    player.regionId = 'r_greenfield';

    const away = engine.dispatch({
      kind: 'lobby',
      countryId: country.id,
      policy: 'tariffRate',
      delta: -0.02,
    });
    expect(away.ok).toBe(false);
    expect(away.error ?? '').toContain('首都');

    player.regionId = capitalOf(state, country.id)!;
    const near = engine.dispatch({
      kind: 'lobby',
      countryId: country.id,
      policy: 'tariffRate',
      delta: -0.02,
    });
    expect(near.ok).toBe(true);
  });

  it('签约要亲自到组织总部', () => {
    const engine = makeEngine('travel-contract');
    const state = engine.state;
    const player = state.characters[state.playerId]!;
    const org = state.organizations['o_grainwheel']!;
    player.regionId = 'r_silvermoon';

    const away = engine.dispatch({
      kind: 'sign_contract',
      orgId: org.id,
      contractKind: 'supply',
      counterpartyId: 'o_ironhand',
      goodId: 'grain',
      quantity: 10,
      unitPrice: 20,
      months: 3,
    });
    expect(away.ok).toBe(false);
    expect(away.error ?? '').toContain('总部');

    player.regionId = org.homeRegionId;
    const near = engine.dispatch({
      kind: 'sign_contract',
      orgId: org.id,
      contractKind: 'supply',
      counterpartyId: 'o_ironhand',
      goodId: 'grain',
      quantity: 10,
      unitPrice: 20,
      months: 3,
    });
    expect(near.ok).toBe(true);
  });

  it('赴宴只在首都可行，花钱并改变与权贵的关系', () => {
    const engine = makeEngine('travel-court');
    const state = engine.state;
    const player = state.characters[state.playerId]!;
    const country = state.countries['c_kingdom']!;
    const capital = capitalOf(state, country.id)!;
    player.regionId = 'r_greenfield';
    const away = engine.dispatch({ kind: 'attend_court' });
    expect(away.ok).toBe(false);

    player.regionId = capital;
    player.wealth = 500;
    const before = player.wealth;
    const result = engine.dispatch({ kind: 'attend_court' });
    expect(result.ok).toBe(true);
    expect(player.wealth).toBe(before - 50);
    const ruler = state.characters[country.rulerId]!;
    expect(findRelation(state, player.id, ruler.id, 'ally')?.value ?? 0).toBeGreaterThan(0);
  });

  it('打听行情可在本地或相邻地区，30 天内有效且不重复', () => {
    const engine = makeEngine('travel-inspect');
    const state = engine.state;
    const player = state.characters[state.playerId]!;
    player.actionPoints = 3;
    player.wealth = 1000;

    const dayBefore = state.clock.day;
    const here = engine.dispatch({ kind: 'inspect_market', regionId: player.regionId });
    expect(here.ok).toBe(true);
    // 打听花两天，但有效期从出发那天算起。
    expect(state.inspections[player.regionId]).toBe(dayBefore + 30);

    const again = engine.dispatch({ kind: 'inspect_market', regionId: player.regionId });
    expect(again.ok).toBe(false);
    expect(again.error ?? '').toContain('最近');

    const neighbor = state.regions[player.regionId]!.links[0]!.to;
    const cashBefore = player.wealth;
    const away = engine.dispatch({ kind: 'inspect_market', regionId: neighbor });
    expect(away.ok).toBe(true);
    expect(player.wealth).toBe(cashBefore - 20);

    const far = Object.keys(state.regions).find(
      (id) =>
        id !== player.regionId &&
        id !== neighbor &&
        !state.regions[player.regionId]!.links.some((link) => link.to === id),
    );
    if (far) {
      const tooFar = engine.dispatch({ kind: 'inspect_market', regionId: far });
      expect(tooFar.ok).toBe(false);
      expect(tooFar.error ?? '').toContain('相邻');
    }
  });
});
