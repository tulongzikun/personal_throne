/**
 * 事件引擎：互斥竞速、冷却、效果夹取与确定性（R6）。
 */

import { describe, expect, it } from 'vitest';
import { content, makeWorld } from './helpers/index';
import {
  applyEvent,
  collectCandidates,
  readNumber,
  selectTriggered,
  type Candidate,
} from '../src/core/EventEngine';
import { Random } from '../src/core/Random';
import { applyTiers, computeTiers } from '../src/core/SimulationTier';
import type { EventDef } from '../src/core/WorldState';

function makeDef(id: string, exclusivity?: string): EventDef {
  const base: EventDef = {
    id,
    domain: 'organization',
    scope: 'organization',
    risk: { lambda0: 8, terms: [] },
    cooldownDays: 30,
    effects: [{ kind: 'add', path: 'conflict', value: 0.05 }],
    text: { title: id, body: id },
  };
  return exclusivity ? { ...base, exclusivity } : base;
}

function candidate(def: EventDef, entityId = 'o_grainwheel'): Candidate {
  return {
    def,
    target: { scope: 'organization', entityId },
    lambda: def.risk.lambda0,
    group: def.exclusivity ? `${entityId}|${def.exclusivity}` : null,
  };
}

describe('互斥竞速', () => {
  it('同一互斥组每次抽样最多触发一个事件', () => {
    const world = makeWorld('excl');
    const defs = [makeDef('ev_a', 'power'), makeDef('ev_b', 'power'), makeDef('ev_c', 'power')];

    let fired = 0;
    for (let index = 0; index < 200; index += 1) {
      const rng = new Random(`excl-${index}`);
      const triggered = selectTriggered(
        world,
        defs.map((def) => candidate(def)),
        rng,
        `p${index}`,
      );
      expect(triggered.length).toBeLessThanOrEqual(1);
      fired += triggered.length;
    }
    expect(fired).toBeGreaterThan(0);
  });

  it('不同互斥组可以各触发一个', () => {
    const world = makeWorld('excl-groups');
    const candidates = [candidate(makeDef('ev_a', 'power')), candidate(makeDef('ev_b', 'trade'))];
    const triggered = selectTriggered(world, candidates, new Random('groups'), 'p1');
    expect(triggered.length).toBeLessThanOrEqual(2);
    const groups = new Set(triggered.map((item) => item.def.exclusivity));
    expect(groups.size).toBe(triggered.length);
  });

  it('独立事件互不影响，可能同时触发', () => {
    const world = makeWorld('singles');
    const candidates = [candidate(makeDef('ev_a')), candidate(makeDef('ev_b'))];
    let both = 0;
    for (let index = 0; index < 50; index += 1) {
      const triggered = selectTriggered(world, candidates, new Random(`s-${index}`), `p${index}`);
      if (triggered.length === 2) both += 1;
    }
    expect(both).toBeGreaterThan(0);
  });

  it('同种子同周期结果完全一致', () => {
    const world = makeWorld('determinism');
    const candidates = [candidate(makeDef('ev_a', 'power')), candidate(makeDef('ev_b', 'power'))];
    const first = selectTriggered(world, candidates, new Random('seed'), 'p42');
    const second = selectTriggered(world, candidates, new Random('seed'), 'p42');
    expect(first.map((item) => item.def.id)).toEqual(second.map((item) => item.def.id));
  });
});

describe('分层与事件可达性', () => {
  it('重新分层后人物进入 L2，角色事件才会成为候选', () => {
    const world = makeWorld('tiers');
    const before = collectCandidates(world, content, world.clock.day, 2).filter(
      (item) => item.def.scope === 'character',
    );
    expect(before.length).toBe(0);

    applyTiers(world, computeTiers(world, content));
    const after = collectCandidates(world, content, world.clock.day, 2).filter(
      (item) => item.def.scope === 'character',
    );
    expect(after.length).toBeGreaterThan(0);
  });
});

describe('事件效果与冷却', () => {
  it('效果写入后进入冷却，冷却期内不再成为候选', () => {
    const world = makeWorld('cooldown');
    const def = content.events.find((event) => event.id === 'ev_org_boom');
    expect(def).toBeDefined();
    if (!def) return;

    const target = { scope: 'organization' as const, entityId: 'o_grainwheel' };
    const cashBefore = readNumber(world, target, 'cash') ?? 0;

    applyEvent(world, content, { def, target });
    const cashAfter = readNumber(world, target, 'cash') ?? 0;
    expect(cashAfter).toBe(cashBefore + 240);
    expect(world.cooldowns['ev_org_boom@o_grainwheel']).toBeGreaterThan(world.clock.day);

    const candidates = collectCandidates(world, content, world.clock.day, 2);
    // 其它组织仍可能是候选，这里只断言冷却中的那个目标被剔除。
    expect(
      candidates.some(
        (item) => item.def.id === 'ev_org_boom' && item.target.entityId === 'o_grainwheel',
      ),
    ).toBe(false);
  });

  it('比例型数值被夹取在 0–1，金额不为负', () => {
    const world = makeWorld('clamp');
    const def: EventDef = {
      id: 'ev_clamp',
      domain: 'organization',
      scope: 'organization',
      risk: { lambda0: 0.1, terms: [] },
      cooldownDays: 10,
      effects: [
        { kind: 'set', path: 'conflict', value: 5 },
        { kind: 'add', path: 'cash', value: -999999 },
        { kind: 'set', path: 'leadership.legitimacy', value: -3 },
      ],
      text: { title: 'clamp', body: 'clamp' },
    };
    const target = { scope: 'organization' as const, entityId: 'o_ironhand' };
    applyEvent(world, content, { def, target });

    expect(readNumber(world, target, 'conflict')).toBeLessThanOrEqual(1);
    expect(readNumber(world, target, 'cash')).toBe(0);
    expect(readNumber(world, target, 'leadership.legitimacy')).toBe(0);
  });

  it('schedule 效果会按天数推入待办队列', () => {
    const world = makeWorld('schedule');
    const def: EventDef = {
      id: 'ev_schedule',
      domain: 'country',
      scope: 'country',
      risk: { lambda0: 0.1, terms: [] },
      cooldownDays: 10,
      effects: [{ kind: 'schedule', eventId: 'ev_country_aftermath', inDays: 45 }],
      text: { title: 'schedule', body: 'schedule' },
    };
    applyEvent(world, content, { def, target: { scope: 'country', entityId: 'c_kingdom' } });

    expect(world.pendingEvents).toHaveLength(1);
    const scheduled = world.pendingEvents[0];
    expect(scheduled?.refId).toBe('ev_country_aftermath');
    expect(scheduled?.day).toBe(world.clock.day + 45);
    expect(scheduled?.targetScope).toBe('country');
    expect(scheduled?.targetEntityId).toBe('c_kingdom');
  });

  it('夜囊帮这类高冲突组织在 100 次抽样中会被事件触及', () => {
    const world = makeWorld('touched');
    let touched = 0;
    for (let month = 0; month < 100; month += 1) {
      world.clock.day = 30 * (month + 1);
      const candidates = collectCandidates(world, content, world.clock.day, 2);
      const triggered = selectTriggered(world, candidates, new Random(`t-${month}`), `m${month}`);
      for (const trigger of triggered) {
        applyEvent(world, content, trigger);
        if (trigger.target.entityId === 'o_nightpouch') touched += 1;
      }
    }
    expect(touched).toBeGreaterThan(0);
  });
});
