/**
 * `军事`域的命令实现，由 `CommandBus.applyCommand` 分发。
 * 只做纯状态变更与校验，不推进时间；失败返回 `{ ok: false }`，不抛异常。
 */

import type { WorldState, WorldContent } from '../WorldState';
import type { CommandOf, CommandResult } from '../commandTypes';
import { declareWar, isAtWar, makePeace } from '../../systems/military/WarSystem';
import { canCommandCountry, fail, isAmount, ownCountryOf } from '../commandHelpers';

export function declareWarCmd(
  state: WorldState,
  command: CommandOf<'declare_war'>,
  content: WorldContent,
): CommandResult {
  const target = state.countries[command.targetCountryId];
  if (!target) return fail(`国家 ${command.targetCountryId} 不存在`);
  const own = ownCountryOf(state);
  if (!own) return fail('你还没有效忠的国家');
  if (own.id === target.id) return fail('不能对自己宣战');
  if (!canCommandCountry(state, own.id)) return fail('宣战需要统治权或高级公职');
  const result = declareWar(state, content, own.id, target.id);
  if (!result.ok) return fail(result.error ?? '宣战失败');
  return {
    ok: true,
    summary: result.summary ?? '已宣战',
    refs: [
      { kind: 'country', id: own.id },
      { kind: 'country', id: target.id },
    ],
  };
}

export function offerPeace(state: WorldState, command: CommandOf<'offer_peace'>): CommandResult {
  const target = state.countries[command.targetCountryId];
  if (!target) return fail(`国家 ${command.targetCountryId} 不存在`);
  const own = ownCountryOf(state);
  if (!own) return fail('你还没有效忠的国家');
  if (!canCommandCountry(state, own.id)) return fail('议和需要统治权或高级公职');
  if (!isAtWar(state, own.id, target.id)) return fail('你们并不在交战');
  const outcome = makePeace(state, own.id, target.id, {
    day: state.clock.day,
    periodKey: 'manual',
    phase: 2,
    rng: { nextFloat: () => 0.5 } as never,
  });
  return {
    ok: true,
    summary: outcome.summary,
    refs: [
      { kind: 'country', id: own.id },
      { kind: 'country', id: target.id },
    ],
  };
}

export function levyArmy(
  state: WorldState,
  command: CommandOf<'levy_army'>,
  content: WorldContent,
): CommandResult {
  const own = ownCountryOf(state);
  if (!own) return fail('你还没有效忠的国家');
  if (!canCommandCountry(state, own.id)) return fail('征兵需要统治权或高级公职');
  if (!isAmount(command.units)) return fail('征兵人数必须是正整数');
  const cost = command.units * content.balance.war.levyCostPerSoldier;
  if (own.treasury < cost) return fail(`国库不足（需要 ${cost} 铜币）`);
  const army = state.armies[`army:${own.id}`];
  if (!army) return fail('没有可用的军队建制');
  if (command.units > own.population * 0.02) return fail('单次征兵超过人口 2%，国力承受不住');
  own.treasury -= cost;
  army.size += command.units;
  return {
    ok: true,
    summary: `征召 ${command.units} 人，耗银 ${cost}`,
    refs: [{ kind: 'country', id: own.id }],
  };
}

export function marchArmy(state: WorldState, command: CommandOf<'march_army'>): CommandResult {
  const own = ownCountryOf(state);
  if (!own) return fail('你还没有效忠的国家');
  if (!canCommandCountry(state, own.id)) return fail('调兵需要统治权或高级公职');
  const army = state.armies[`army:${own.id}`];
  if (!army) return fail('没有可用的军队建制');
  const region = state.regions[command.regionId];
  if (!region) return fail(`地区 ${command.regionId} 不存在`);
  army.targetRegionId = region.id;
  army.stance = 'march';
  return {
    ok: true,
    summary: `军队开往 ${region.name}`,
    refs: [
      { kind: 'country', id: own.id },
      { kind: 'region', id: region.id },
    ],
  };
}
