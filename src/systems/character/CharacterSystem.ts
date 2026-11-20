/**
 * 人物系统：月度收入、年度衰老与死亡、职位继承。
 *
 * 死亡处理是验收场景 E 的核心：
 * - 死亡立即从组织领袖/国家统治者位置上移除；
 * - 组织按 `successionOrder` 换领袖，无候选则标记 leadership 空缺（由事件链接管）；
 * - 股份不自动复制：股份仍记在死者名下（遗产），M2 起由继承事件分配；
 * - 同一人物不会被两个组织同时选为领袖（先到先得，按组织 ID 稳定顺序）。
 */

import type { SettleContext, WorldContent, WorldState } from '../../core/WorldState';
import { sortedIds } from '../../core/WorldState';
import { transferWealth } from './Character';
import { successionOrder } from '../organization/Organization';
import { installRuler } from '../country/Ruler';

export interface CharacterSettlement {
  readonly deaths: readonly string[];
  readonly successions: readonly {
    readonly orgId: string;
    readonly from: string;
    readonly to: string;
  }[];
}

/** 月度：领袖按组织盈利领取酬金（从组织现金转出，属转移不属利润）。 */
export function settleMonthlyCharacters(
  state: WorldState,
  content: WorldContent,
  ctx: SettleContext,
): { readonly stipends: number } {
  void content;
  void ctx;
  let stipends = 0;

  for (const orgId of sortedIds(state.organizations)) {
    const org = state.organizations[orgId];
    if (!org || org.lifecycle === 'dissolved') continue;
    const leader = state.characters[org.leadership.leaderId];
    if (!leader || !leader.alive) continue;
    const profit = org.lastMonthRevenue - org.lastMonthCost;
    if (profit <= 0) continue;
    const stipend = Math.min(org.cash, Math.round(profit * 0.02));
    if (stipend <= 0) continue;
    org.cash -= stipend;
    leader.wealth += stipend;
    stipends += stipend;
  }

  return { stipends };
}

/** 年度：年龄 +1，按年龄计算死亡概率。 */
export function settleYearlyCharacters(
  state: WorldState,
  content: WorldContent,
  ctx: SettleContext,
): CharacterSettlement {
  void content;
  const deaths: string[] = [];
  const successions: { orgId: string; from: string; to: string }[] = [];

  for (const id of sortedIds(state.characters)) {
    const character = state.characters[id];
    if (!character || !character.alive) continue;
    character.age += 1;

    const risk = mortalityRisk(character.age);
    if (
      risk > 0 &&
      ctx.rng.chance({ stream: 'mortality', entityId: id, periodKey: ctx.periodKey }, risk)
    ) {
      character.alive = false;
      deaths.push(id);
      successions.push(...handleDeath(state, id));
    }
  }

  return { deaths, successions };
}

/** 死亡概率：50 岁前近 0，之后指数上升，90 岁封顶 0.5。 */
export function mortalityRisk(age: number): number {
  if (age < 45) return 0;
  return Math.min(0.5, Number((Math.pow(1.09, age - 45) - 1) / 200));
}

/** 人物死亡后的职位与关系清理，返回继承记录。 */
export function handleDeath(
  state: WorldState,
  characterId: string,
): { orgId: string; from: string; to: string }[] {
  const character = state.characters[characterId];
  if (!character) return [];
  character.alive = false;

  const successions: { orgId: string; from: string; to: string }[] = [];
  const claimed = new Set<string>();

  for (const orgId of sortedIds(state.organizations)) {
    const org = state.organizations[orgId];
    if (!org || org.leadership.leaderId !== characterId) continue;

    const candidates = successionOrder(state, orgId).filter(
      (id) => !claimed.has(id) && id !== characterId,
    );
    const heir = candidates[0];
    if (heir) {
      claimed.add(heir);
      org.leadership = {
        leaderId: heir,
        legitimacy: Math.max(0.2, org.leadership.legitimacy - 0.15),
      };
      const next = state.characters[heir];
      if (next) next.organizationId = orgId;
      successions.push({ orgId, from: characterId, to: heir });
    } else {
      // 无继承人：领袖空缺，组织进入危机，等待事件链（M4 的继承/分裂事件）。
      org.lifecycle = 'crisis';
      org.leadership = { leaderId: characterId, legitimacy: 0.1 };
    }
  }

  // 国家统治者死亡：按政体立刻产生在世继承人（不允许出现无主国家）。
  for (const countryId of sortedIds(state.countries)) {
    const country = state.countries[countryId];
    if (!country || country.rulerId !== characterId) continue;
    installRuler(state, country, country.polity);
    country.legitimacy = Math.min(country.legitimacy, 0.4);
    country.stability = Math.min(country.stability, 0.3);
    // 王位更替必然伴随一轮合法性危机：把事件排进队列，保证 100 年里看得到继承戏。
    state.scheduleSeq += 1;
    state.pendingEvents.push({
      day: state.clock.day + 20,
      phase: 4,
      seq: state.scheduleSeq,
      kind: 'event',
      refId: 'ev_country_succession_crisis',
      parentEventId: null,
      targetScope: 'country',
      targetEntityId: countryId,
    });
  }

  // 遗产：现金留在人物名下（`wealth`），不复制到任何组织。
  if (character.wealth < 0) character.wealth = 0;

  return successions;
}

/** 显式转移财富（供测试与事件使用）。 */
export { transferWealth };
