import { describe, expect, it } from 'vitest';
import { makeEngine, makeWorld } from './helpers/index';
import { applyCommand, type Command, type CommandResult } from '../src/core/CommandBus';
import { hashWorld, validateWorld } from '../src/core/WorldState';
import { content } from './helpers/index';
import { migrateSave } from '../src/storage/Migration';

const HOSTILE_NUMBERS = [Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 0.5, 1e12];
const HOSTILE_STRINGS = ['__proto__', 'toString', 'constructor', '', 'x'.repeat(200)];

function deepFinite(value: unknown, path = 'root'): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? null : `${path} 不是有限数`;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const bad = deepFinite(item, `${path}[${index}]`);
      if (bad) return bad;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      const bad = deepFinite(item, `${path}.${key}`);
      if (bad) return bad;
    }
  }
  return null;
}

function baseCommands(): Command[] {
  const world = makeWorld();
  const orgId = Object.keys(world.organizations)[0]!;
  const regionId = Object.keys(world.regions)[0]!;
  const countryId = Object.keys(world.countries)[0]!;
  return [
    { kind: 'invest', orgId, amount: 100 },
    { kind: 'recruit', orgId, count: 3 },
    { kind: 'take_loan', orgId, amount: 1000 },
    { kind: 'repay_debt', orgId, amount: 10 },
    { kind: 'buy_asset', orgId, amount: 100 },
    { kind: 'sell_asset', orgId, amount: 10 },
    { kind: 'set_strategy', orgId, strategy: 'expansion' },
    { kind: 'move', regionId },
    { kind: 'inspect_market', regionId },
    { kind: 'train', skill: 'trade' },
    { kind: 'lobby', countryId, policy: 'taxRate', delta: 0.1 },
    { kind: 'levy_army', units: 100 },
    { kind: 'buy_shares', orgId, amount: 10 },
    { kind: 'trade_goods', goodId: 'grain', quantity: 2, targetRegionId: regionId },
  ] as Command[];
}

describe('阶段 3：失败与边界', () => {
  it('5000 条恶意命令不抛异常、不写 NaN、状态仍通过校验', () => {
    const engine = makeEngine();
    let applied = 0;
    for (let index = 0; index < 5000; index += 1) {
      const template = baseCommands()[index % baseCommands().length]!;
      const command = { ...template } as Record<string, unknown>;
      const fields = Object.keys(command).filter((key) => key !== 'kind');
      const field = fields[index % fields.length]!;
      if (index % 3 === 0) command[field] = HOSTILE_NUMBERS[index % HOSTILE_NUMBERS.length];
      if (index % 3 === 1) command[field] = HOSTILE_STRINGS[index % HOSTILE_STRINGS.length];
      if (index % 5 === 0) delete command[field];

      const holder: { result: CommandResult | null } = { result: null };
      expect(() => {
        holder.result = applyCommand(engine.state, command as unknown as Command, content);
      }).not.toThrow();
      if (holder.result?.ok) applied += 1;
    }
    expect(deepFinite(engine.state)).toBeNull();
    expect(validateWorld(engine.state)).toEqual([]);
    expect(hashWorld(engine.state).length).toBeGreaterThan(0);
    // 绝大多数恶意命令应被拒；允许少量"删掉可选字段后仍合法"的命令通过。
    expect(applied).toBeLessThan(5000);
  });

  it('玩家死亡后所有命令都被拒绝', () => {
    const engine = makeEngine();
    engine.state.characters[engine.state.playerId]!.alive = false;
    for (const command of baseCommands()) {
      const result = applyCommand(engine.state, command, content);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('不在人世');
    }
  });

  it('原型链名字不能当 id 用', () => {
    const engine = makeEngine();
    for (const command of [
      { kind: 'move', regionId: '__proto__' },
      { kind: 'inspect_market', regionId: 'toString' },
      { kind: 'train', skill: 'constructor' },
    ] as Command[]) {
      const result = applyCommand(engine.state, command, content);
      expect(result.ok).toBe(false);
    }
    expect(Object.hasOwn(engine.state.regions, 'toString')).toBe(false);
  });

  it('旧档把 contracts 存成数组时，读档后变成以 id 为键的对象', () => {
    const world = makeWorld();
    const legacy = JSON.parse(JSON.stringify(world)) as {
      contracts: unknown;
      meta: { schemaVersion: number };
    };
    legacy.meta.schemaVersion = 1;
    legacy.contracts = [
      { id: 'contract_0', lenderId: 'o_1', borrowerId: 'o_2', value: 100 },
      { lenderId: 'o_3', borrowerId: 'o_4', value: 50 },
    ];
    const envelope = migrateSave({
      format: 'throne-and-gold-save',
      formatVersion: 2,
      state: legacy,
    });
    const contracts = envelope.state.contracts as Record<string, { principal: number }>;
    expect(Array.isArray(contracts)).toBe(false);
    expect(Object.keys(contracts)).toHaveLength(2);
    expect(contracts['contract_0']!.principal).toBe(100);
    expect(contracts['contract_1']!.principal).toBe(50);
  });

  it('同版本存档缺少哈希时拒绝加载', () => {
    const world = makeWorld();
    expect(() =>
      migrateSave({
        format: 'throne-and-gold-save',
        formatVersion: 11,
        state: world,
      }),
    ).toThrowError(/完整性校验/);
  });
});
