/**
 * M4.5 抉择：事件把选择权交给玩家，其余人按效用自动选。
 */

import { describe, expect, it } from 'vitest';
import { makeEngine, makeWorld, content } from './helpers/index';
import { pickChoice, applyEvent } from '../src/core/EventEngine';
import { CHOICE_WINDOW_DAYS } from '../src/core/EventEngine';
import type { EventDef } from '../src/core/WorldState';

const eventById = (id: string): EventDef => {
  const def = content.events.find((event) => event.id === id);
  if (!def) throw new Error(`未知事件 ${id}`);
  return def;
};

describe('抉择', () => {
  it('玩家事件挂起等待，不立即结算效果', () => {
    const engine = makeEngine('test-seed', { stopAtChoices: true });
    const player = engine.state.characters[engine.state.playerId]!;
    const before = player.wealth;

    engine.applyTrigger(
      eventById('ev_adv_opportunity'),
      { scope: 'character', entityId: player.id },
      engine.day,
    );

    expect(engine.pendingChoices).toHaveLength(1);
    expect(player.wealth).toBe(before);
    expect(engine.state.history.at(-1)?.summary).toContain('等待你的决定');
  });

  it('choose 结算所选效果并清掉挂起项', () => {
    const engine = makeEngine('test-seed', { stopAtChoices: true });
    const player = engine.state.characters[engine.state.playerId]!;
    const before = player.wealth;
    engine.applyTrigger(
      eventById('ev_adv_opportunity'),
      { scope: 'character', entityId: player.id },
      engine.day,
    );

    const result = engine.dispatch({ kind: 'choose', choiceId: 'take' });
    expect(result.ok).toBe(true);
    expect(engine.pendingChoices).toHaveLength(0);
    expect(player.wealth).toBeGreaterThan(before);
    expect(engine.state.history.some((record) => record.summary.includes('接下这趟活'))).toBe(true);
  });

  it('未知选项被拒绝且保留挂起项', () => {
    const engine = makeEngine('test-seed', { stopAtChoices: true });
    engine.applyTrigger(
      eventById('ev_adv_opportunity'),
      { scope: 'character', entityId: engine.state.playerId },
      engine.day,
    );

    const result = engine.dispatch({ kind: 'choose', choiceId: 'nope' });
    expect(result.ok).toBe(false);
    expect(engine.pendingChoices).toHaveLength(1);
  });

  it('没有挂起事件时 choose 返回错误', () => {
    const engine = makeEngine('test-seed', { stopAtChoices: true });
    expect(engine.dispatch({ kind: 'choose' }).ok).toBe(false);
  });

  it('NPC 事件按效用自动择优，不产生挂起', () => {
    const engine = makeEngine('test-seed', { stopAtChoices: true });
    const npc = Object.values(engine.state.characters).find(
      (character) => character.id !== engine.state.playerId && character.alive,
    )!;
    engine.applyTrigger(
      eventById('ev_adv_opportunity'),
      { scope: 'character', entityId: npc.id },
      engine.day,
    );
    expect(engine.pendingChoices).toHaveLength(0);
    expect(engine.state.history.at(-1)?.causeEventId).toBe('ev_adv_opportunity');
  });

  it('抉择不会因为时间流逝替你决定（世界继续走）', () => {
    const engine = makeEngine('test-seed', { stopAtChoices: true });
    engine.applyTrigger(
      eventById('ev_adv_opportunity'),
      { scope: 'character', entityId: engine.state.playerId },
      engine.day,
    );
    expect(engine.pendingChoices).toHaveLength(1);

    engine.advanceDays(CHOICE_WINDOW_DAYS + 200);
    expect(engine.pendingChoices.some((item) => item.eventId === 'ev_adv_opportunity')).toBe(true);
    expect(engine.state.history.some((record) => record.summary.includes('超时未决'))).toBe(false);
  });

  it('pickChoice 只看满足条件的选项，同分按 id 稳定', () => {
    const world = makeWorld();
    const target = { scope: 'organization' as const, entityId: 'o_grainwheel' };
    const def = eventById('ev_org_strike');
    const chosen = pickChoice(world, target, def.choices!);
    expect(chosen).not.toBeNull();
    expect(def.choices!.map((choice) => choice.id)).toContain(chosen!.id);

    const strict: EventDef['choices'] = [
      {
        id: 'b',
        label: 'B',
        effects: [{ kind: 'add', path: 'cash', value: -10 }],
        conditions: { path: 'cash', op: '>', value: 10_000 },
      },
      { id: 'a', label: 'A', effects: [{ kind: 'add', path: 'cash', value: -10 }] },
    ];
    expect(pickChoice(world, target, strict!)?.id).toBe('a');
  });

  it('同一世界两次相同抉择产生相同指纹', () => {
    const play = () => {
      const engine = makeEngine('test-seed', { stopAtChoices: true });
      engine.applyTrigger(
        eventById('ev_adv_opportunity'),
        { scope: 'character', entityId: engine.state.playerId },
        engine.day,
      );
      engine.dispatch({ kind: 'choose', choiceId: 'pass' });
      return engine.hash();
    };
    expect(play()).toBe(play());
  });
});

describe('自动结算路径', () => {
  it('applyEvent 对选项事件自动择优（存档外的脚本/模拟用）', () => {
    const world = makeWorld();
    const player = world.characters[world.playerId]!;
    const before = player.wealth;
    const outcome = applyEvent(world, content, {
      def: eventById('ev_adv_opportunity'),
      target: { scope: 'character', entityId: player.id },
    });
    expect(outcome.changes.some((change) => change.includes('抉择'))).toBe(true);
    expect(player.wealth).not.toBe(before);
  });
});
