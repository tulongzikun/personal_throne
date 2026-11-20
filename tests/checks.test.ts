/**
 * d20 检定：属性要真的参与判定，且规则对玩家可见。
 *
 * 验收：按钮提示写明「看哪个属性、加值多少、门槛多少」；成功与失败走不同后果；
 * 掷骰可复现（同种子同关键帧同结果）。
 */

import { describe, expect, it } from 'vitest';

import { content } from '../src/content/index';
import { Random } from '../src/core/Random';
import type { EventDef } from '../src/core/WorldState';
import { applyEvent } from '../src/core/EventEngine';
import { checkBonus, describeCheck, rollCheck } from '../src/systems/character/Check';
import { makeWorld } from './helpers';

function choiceEvent(difficulty: number): EventDef {
  return {
    id: 'ev_test_check',
    domain: 'adventure',
    scope: 'character',
    risk: { lambda0: 1, terms: [] },
    cooldownDays: 10,
    effects: [],
    text: { title: '测试', body: '测试' },
    choices: [
      {
        id: 'try',
        label: '试一试',
        check: { attribute: 'physique', difficulty },
        effects: [{ kind: 'add', path: 'wealth', value: 100 }],
        failureEffects: [{ kind: 'add', path: 'wealth', value: -50 }],
      },
    ],
  };
}

describe('d20 检定', () => {
  it('属性 10 为 0，每 2 点 +1', () => {
    expect(checkBonus(10)).toBe(0);
    expect(checkBonus(8)).toBe(-1);
    expect(checkBonus(14)).toBe(2);
    expect(checkBonus(15)).toBe(2);
  });

  it('规则说明写明属性、加值与门槛', () => {
    const world = makeWorld('check');
    const player = world.characters[world.playerId]!;
    player.attributes.physique = 14;
    const text = describeCheck(player, { attribute: 'physique', difficulty: 12 });
    expect(text).toBe('力量检定 d20+2 ≥ 12');
  });

  it('同种子同关键帧掷骰结果一致，且落在 1–20', () => {
    const world = makeWorld('check');
    const player = world.characters[world.playerId]!;
    const a = rollCheck(new Random('seed'), player, { attribute: 'physique', difficulty: 12 }, 'k');
    const b = rollCheck(new Random('seed'), player, { attribute: 'physique', difficulty: 12 }, 'k');
    expect(a).toEqual(b);
    expect(a.roll).toBeGreaterThanOrEqual(1);
    expect(a.roll).toBeLessThanOrEqual(20);
    expect(a.text).toContain('力量检定');
    expect(a.text).toContain(`d20(${a.roll})`);
  });

  it('必过与必败分别走 effects 与 failureEffects', () => {
    const world = makeWorld('check');
    const target = { scope: 'character' as const, entityId: world.playerId };
    const player = world.characters[world.playerId]!;
    const before = player.wealth;

    applyEvent(world, content, { def: choiceEvent(0), target } as never);
    expect(player.wealth).toBeGreaterThan(before);

    const beforeFail = player.wealth;
    applyEvent(world, content, { def: choiceEvent(99), target } as never);
    expect(player.wealth).toBe(beforeFail - 50);
  });

  it('内容里的抉择事件都带可执行的检定（属性合法、门槛 5–20）', () => {
    const withCheck = content.events.flatMap((event) =>
      (event.choices ?? []).filter((choice) => choice.check).map((choice) => ({ event, choice })),
    );
    expect(withCheck.length).toBeGreaterThanOrEqual(6);
    for (const entry of withCheck) {
      expect(['physique', 'agility', 'intellect', 'willpower', 'perception', 'charisma']).toContain(
        entry.choice.check!.attribute,
      );
      expect(entry.choice.check!.difficulty).toBeGreaterThanOrEqual(5);
      expect(entry.choice.check!.difficulty).toBeLessThanOrEqual(20);
    }
  });
});
