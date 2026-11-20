import { describe, expect, it } from 'vitest';
import { content } from '../src/content/index';
import { influenceOf, officeSeatsFor, syncOffices } from '../src/systems/country/Offices';
import { applyCommand } from '../src/core/CommandBus';
import { makeEngine, makeWorld } from './helpers/index';

describe('国家公职', () => {
  it('开局为每国任命三个公职，且 holder 在世、双向记录一致', () => {
    const engine = makeEngine('offices-basic');
    const state = engine.state;
    for (const country of Object.values(state.countries)) {
      expect(country.offices).toHaveLength(3);
      for (const office of country.offices) {
        const holder = state.characters[office.holderId];
        expect(holder?.alive).toBe(true);
        expect(holder?.offices.some((o) => o.id === office.id)).toBe(true);
      }
      const holders = country.offices.map((office) => office.holderId);
      expect(new Set(holders).size).toBe(3);
      expect(holders).not.toContain(country.rulerId);
    }
  });

  it('影响力夹在 0–1，且只统计本国的职位', () => {
    const engine = makeEngine('offices-influence');
    const state = engine.state;
    const country = state.countries['c_kingdom']!;
    const holder = country.offices[0]!;
    expect(influenceOf(state, holder.holderId, 'c_kingdom')).toBeGreaterThan(0);
    expect(influenceOf(state, holder.holderId, 'c_league')).toBe(0);
    expect(influenceOf(state, 'c_player', 'c_kingdom')).toBeLessThanOrEqual(1);
  });

  it('占位者死亡后年度维护会补位，并清掉旧记录', () => {
    const engine = makeEngine('offices-sync');
    const state = engine.state;
    const country = state.countries['c_kingdom']!;
    const seat = country.offices[0]!;
    const dead = state.characters[seat.holderId]!;
    dead.alive = false;

    const notes = syncOffices(state);
    const next = country.offices.find((office) => office.id === seat.id)!;
    expect(next.holderId).not.toBe(dead.id);
    expect(state.characters[next.holderId]?.alive).toBe(true);
    expect(notes.some((note) => note.countryId === 'c_kingdom')).toBe(true);
    expect(dead.offices.some((office) => office.id === seat.id)).toBe(false);
  });

  it('公职影响力可以下达国家命令，普通商人不行', () => {
    const engine = makeEngine('offices-command');
    const state = engine.state;
    const country = state.countries['c_kingdom']!;
    const seat = country.offices.find((office) => office.influence >= 0.4)!;
    state.playerId = seat.holderId;

    const ok = applyCommand(state, { kind: 'levy_army', units: 10 }, content);
    expect(ok.ok).toBe(true);

    const outsider = makeWorld('offices-outsider');
    const denied = applyCommand(outsider, { kind: 'levy_army', units: 10 }, content);
    expect(denied.ok).toBe(false);
  });

  it('政体决定官衔：君主国是首相/元帅/财务大臣，共和国是议长/舰队司令/财务官', () => {
    const world = makeWorld('offices-seats');
    expect(officeSeatsFor(world.countries['c_kingdom']!).map((s) => s.title)).toEqual([
      '首相',
      '元帅',
      '财务大臣',
    ]);
    expect(officeSeatsFor(world.countries['c_league']!).map((s) => s.title)).toEqual([
      '议长',
      '舰队司令',
      '财务官',
    ]);
  });
});

describe('谋求公职', () => {
  function setup() {
    const engine = makeEngine('offices-seek');
    const state = engine.state;
    const player = state.characters[state.playerId]!;
    const home = state.regions[player.homeRegionId]!.countryId;
    return { engine, state, player, home };
  }

  it('资历达标且压过现任者时可以出任', () => {
    const { engine, state, player, home } = setup();
    const country = state.countries[home]!;
    player.skills.trade = 20;
    player.wealth = 50000;
    const seat = officeSeatsFor(country).find((item) => item.skill === 'trade')!;

    const result = engine.dispatch({ kind: 'seek_office', countryId: home, officeId: seat.id });

    expect(result.ok).toBe(true);
    const office = country.offices.find((item) => item.id === `${country.id}:${seat.id}`)!;
    expect(office.holderId).toBe(state.playerId);
    expect(player.offices.some((item) => item.id === office.id)).toBe(true);
    expect(state.history.some((record) => record.summary.includes(seat.title))).toBe(true);
  });

  it('资历不足时被拒，且不改变席位', () => {
    const { engine, state, player, home } = setup();
    const country = state.countries[home]!;
    player.skills.trade = 0;
    player.wealth = 0;
    const seat = officeSeatsFor(country).find((item) => item.skill === 'trade')!;
    const before = country.offices.find((item) => item.id === `${country.id}:${seat.id}`)?.holderId;

    const result = engine.dispatch({ kind: 'seek_office', countryId: home, officeId: seat.id });

    expect(result.ok).toBe(false);
    expect(result.error ?? '').toContain('资历');
    expect(country.offices.find((item) => item.id === `${country.id}:${seat.id}`)?.holderId).toBe(
      before,
    );
  });

  it('现任者更强时拒绝', () => {
    const { engine, state, player, home } = setup();
    const country = state.countries[home]!;
    const seat = officeSeatsFor(country).find((item) => item.skill === 'trade')!;
    const office = country.offices.find((item) => item.id === `${country.id}:${seat.id}`)!;
    const incumbent = state.characters[office.holderId]!;
    incumbent.skills[seat.skill] = 20;
    incumbent.wealth = 60000;
    player.skills.trade = 18;
    player.wealth = 30000;

    const result = engine.dispatch({ kind: 'seek_office', countryId: home, officeId: seat.id });

    expect(result.ok).toBe(false);
    expect(result.error ?? '').toContain('根基');
    expect(office.holderId).toBe(incumbent.id);
  });

  it('不在该国居住时拒绝', () => {
    const { engine, state, player, home } = setup();
    const other = Object.values(state.countries).find((item) => item.id !== home)!;
    player.location.regionId = other.regionIds[0]!;
    player.homeRegionId = other.regionIds[0]!;
    player.skills.trade = 20;
    player.wealth = 50000;
    const seat = officeSeatsFor(state.countries[home]!).find((item) => item.skill === 'trade')!;

    const result = engine.dispatch({ kind: 'seek_office', countryId: home, officeId: seat.id });

    expect(result.ok).toBe(false);
    expect((result.error ?? '').length).toBeGreaterThan(0);
  });
});
