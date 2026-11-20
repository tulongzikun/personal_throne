/**
 * `政治`域的命令实现，由 `CommandBus.applyCommand` 分发。
 * 只做纯状态变更与校验，不推进时间；失败返回 `{ ok: false }`，不抛异常。
 */

import type { WorldState } from '../WorldState';
import type { CommandOf, CommandResult } from '../commandTypes';
import { lobbyBonus } from '../../systems/character/SkillEffects';
import { applyForOffice, capitalOf, influenceOf } from '../../systems/country/Offices';
import { POLICY_MAX, POLICY_MIN, canControl, fail } from '../commandHelpers';

export function lobby(state: WorldState, command: CommandOf<'lobby'>): CommandResult {
  const country = state.countries[command.countryId];
  if (!country) return fail(`国家 ${command.countryId} 不存在`);
  if (!Number.isFinite(command.delta) || command.delta === 0) {
    return fail('游说强度必须是非零有限数');
  }
  if (Math.abs(command.delta) > 0.2) return fail('单次游说幅度不得超过 0.2');
  const player = state.characters[state.playerId]!;
  const capital = capitalOf(state, country.id);
  const seated = influenceOf(state, player.id, country.id) >= 0.4;
  if (!seated && capital && player.regionId !== capital) {
    return fail(
      `游说要在${country.name}首都${state.regions[capital]?.name ?? ''}当面谈（远程游说需要至少 0.4 影响力）`,
    );
  }
  const effectiveDelta = command.delta + Math.sign(command.delta) * lobbyBonus(player);
  const current = country.policies[command.policy];
  if (typeof current !== 'number') return fail(`未知政策 ${command.policy}`);
  const cost = Math.max(100, Math.round(Math.abs(effectiveDelta) * 5_000));
  const org = Object.values(state.organizations).find(
    (candidate) => canControl(state, candidate.id) && candidate.cash >= cost,
  );
  if (!org) return fail(`没有可用于游说支出的组织（需要 ${cost} 铜币）`);
  org.cash -= cost;
  const next = Math.min(
    POLICY_MAX,
    Math.max(POLICY_MIN, Number((current + effectiveDelta).toFixed(4))),
  );
  country.policies[command.policy] = next;
  return {
    ok: true,
    summary: `${org.name} 游说 ${country.name}：${command.policy} ${current} → ${next}（说服加成 +${lobbyBonus(player).toFixed(2)}），花费 ${cost}`,
    refs: [
      { kind: 'country', id: country.id },
      { kind: 'organization', id: org.id },
    ],
  };
}

export function seekOffice(state: WorldState, command: CommandOf<'seek_office'>): CommandResult {
  const application = applyForOffice(state, state.playerId, command.countryId, command.officeId);
  if (!application.ok) return fail(application.reason);
  return {
    ok: true,
    summary: application.reason,
    refs: [{ kind: 'country', id: command.countryId }],
  };
}
