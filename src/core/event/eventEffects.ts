/* 效果结算、事件摘要文本与后续事件排定。 */

import { rollCheck } from '../../systems/character/Check';
import type { HistoryRef } from '../History';
import { Random } from '../Random';
import type { ChoiceDef, Effect, EventDef, WorldContent, WorldState } from '../WorldState';
import { sortedIds } from '../WorldState';
import { fallbackRng, pickChoice } from './eventChoices';
import { evaluate, targetCountryOf, targetRegionOf } from './eventConditions';
import { readFeature } from './eventFeatures';
import { readNumber, round, writeNumber } from './eventPaths';
import type { EventTarget, Outcome, Triggered } from './eventTypes';

/** 应用一个已触发事件的全部效果，并设置冷却。 */
/** 把 {place}/{country}/{subject} 占位符换成专名（阶段 4）。 */
export function eventText(
  state: WorldState,
  def: EventDef,
  target: EventTarget,
): { title: string; body: string } {
  const regionId = targetRegionOf(state, target);
  const countryId = targetCountryOf(state, target);
  const vars: Record<string, string> = {
    place: (regionId ? state.regions[regionId]?.name : undefined) ?? labelOf(state, target),
    country: (countryId ? state.countries[countryId]?.name : undefined) ?? labelOf(state, target),
    subject: labelOf(state, target),
  };
  const fill = (text: string): string =>
    text.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);
  return { title: fill(def.text.title), body: fill(def.text.body) };
}

/** 按历史记录里的 refs 找到主体，套用同一套占位符替换。 */
export function eventTextForRefs(
  state: WorldState,
  def: EventDef,
  refs: readonly HistoryRef[] | undefined,
): { title: string; body: string } {
  const scopes = new Set(['character', 'organization', 'country', 'region']);
  const first = refs?.find((ref) => scopes.has(ref.type));
  if (!first) return { title: def.text.title, body: def.text.body };
  return eventText(state, def, {
    scope: first.type as EventTarget['scope'],
    entityId: first.id,
  });
}

export function labelOf(state: WorldState, target: EventTarget): string {
  switch (target.scope) {
    case 'organization':
      return state.organizations[target.entityId]?.name ?? target.entityId;
    case 'country':
      return state.countries[target.entityId]?.name ?? target.entityId;
    case 'region':
      return state.regions[target.entityId]?.name ?? target.entityId;
    case 'character':
      return state.characters[target.entityId]?.name ?? target.entityId;
  }
}

/* ------------------------------------------------------------------ */
/* 抉择                                                                 */
/* ------------------------------------------------------------------ */

export function applyEffect(
  state: WorldState,
  content: WorldContent,
  target: EventTarget,
  effect: Effect,
  parentEventId: string,
): string[] {
  if (effect.kind === 'schedule') {
    state.scheduleSeq += 1;
    state.pendingEvents.push({
      day: state.clock.day + Math.max(1, Math.round(effect.inDays)),
      phase: 4,
      seq: state.scheduleSeq,
      kind: 'event',
      refId: effect.eventId,
      parentEventId,
      targetScope: target.scope,
      targetEntityId: target.entityId,
    });
    return [`排定后续事件 ${effect.eventId}（+${effect.inDays} 天）`];
  }

  if (effect.kind === 'merge') {
    return mergeIntoCompetitor(state, target);
  }

  if (effect.kind === 'stat') {
    state.stats[effect.key] += Math.round(effect.value);
    return [`统计 ${effect.key} +${Math.round(effect.value)}`];
  }

  const current = readNumber(state, target, effect.path);
  if (current === null) return [`忽略未知路径 ${effect.path}`];

  let next: number;
  switch (effect.kind) {
    case 'add':
      next = current + effect.value;
      break;
    case 'mul':
      next = current * effect.value;
      break;
    case 'set':
      next = effect.value;
      break;
  }

  if (!writeNumber(state, target, effect.path, next)) {
    return [`无法写入 ${effect.path}`];
  }
  void content;
  return [
    `${effect.path}: ${round(current)} → ${round(readNumber(state, target, effect.path) ?? next)}`,
  ];
}

/** 应用事件自身的效果（有 choices 时，基础效果在"做出抉择"时一并结算）。 */
export function applyBaseEffects(
  state: WorldState,
  content: WorldContent,
  def: EventDef,
  target: EventTarget,
): string[] {
  const changes: string[] = [];
  for (const effect of def.effects) {
    changes.push(...applyEffect(state, content, target, effect, def.id));
  }
  return changes;
}

/**
 * 并购：被作用组织并入同地区同行业资产最大的竞争者。
 * 资产、负债、成员、工资随之归并；被并方注销并留下清算快照，
 * 其成员与领袖改挂到收购方，避免出现悬空引用。
 */
export function mergeIntoCompetitor(state: WorldState, target: EventTarget): string[] {
  if (target.scope !== 'organization') return ['并购仅适用于组织'];
  const victim = state.organizations[target.entityId];
  if (!victim || victim.lifecycle === 'dissolved') return ['目标组织已不存在'];

  let acquirer: WorldState['organizations'][string] | undefined;
  for (const id of sortedIds(state.organizations)) {
    const org = state.organizations[id];
    if (!org || org.id === victim.id || org.lifecycle === 'dissolved') continue;
    if (org.homeRegionId !== victim.homeRegionId || org.industry !== victim.industry) continue;
    if (!acquirer || org.assets > acquirer.assets) acquirer = org;
  }
  if (!acquirer) return [`${victim.name} 没有可并购的同业竞争者`];

  const shortfall = Math.max(0, victim.liabilities - victim.cash - victim.assets);
  acquirer.cash += victim.cash;
  acquirer.assets += victim.assets;
  acquirer.liabilities += victim.liabilities;
  acquirer.members += victim.members;
  acquirer.payrollMonthly += victim.payrollMonthly;
  acquirer.scale = Math.max(acquirer.scale, victim.scale);

  const day = state.clock.day;
  victim.cash = 0;
  victim.assets = 0;
  victim.liabilities = 0;
  victim.unpaidWages = 0;
  victim.members = 0;
  victim.payrollMonthly = 0;
  victim.lifecycle = 'dissolved';
  victim.liquidation = {
    day,
    proceeds: 0,
    creditorPaid: 0,
    wagePaid: 0,
    shareholderPaid: 0,
    shortfall,
  };
  state.stats.mergers += 1;
  state.stats.dissolved += 1;

  for (const characterId of sortedIds(state.characters)) {
    const character = state.characters[characterId];
    if (character?.organizationId === victim.id) character.organizationId = acquirer.id;
  }
  for (const contractId of sortedIds(state.contracts)) {
    const contract = state.contracts[contractId];
    if (!contract || contract.status !== 'open') continue;
    if (contract.fromOrgId === victim.id) contract.fromOrgId = acquirer.id;
    if (contract.toOrgId === victim.id) contract.toOrgId = acquirer.id;
  }
  for (const marketId of sortedIds(state.markets)) {
    const market = state.markets[marketId];
    if (market) delete market.shareByOrg[victim.id];
  }

  return [
    `${victim.name} 被 ${acquirer.name} 并购（承接负债 ${victim.liabilities}，差额 ${shortfall}）`,
  ];
}

/**
 * 事件链：父事件结算后按 followUps 排定后续事件。
 * 条件用与候选相同的一套特征函数，因此可以写 `history.<eventId>`。
 */
export function scheduleFollowUps(
  state: WorldState,
  def: EventDef,
  target: EventTarget,
  rng: Random,
): string[] {
  const followUps = def.followUps;
  if (!followUps || followUps.length === 0) return [];

  const step = (def.chain?.step ?? 1) + 1;
  const notes: string[] = [];
  const resolver = (path: string): number => readFeature(state, target, path);

  for (const followUp of followUps) {
    if (followUp.conditions && !evaluate(followUp.conditions, resolver)) continue;
    const chance = followUp.chance ?? 1;
    if (
      chance < 1 &&
      !rng.chance({ stream: 'followup', entityId: target.entityId, periodKey: def.id }, chance)
    )
      continue;

    const dueDay = state.clock.day + Math.max(1, Math.round(followUp.delayDays));
    // 同一目标同一天的同一条后续只排一次：否则同一批伏击会排出四条一模一样的「战利品」。
    const duplicate = state.pendingEvents.some(
      (item) =>
        item.kind === 'event' &&
        item.refId === followUp.eventId &&
        item.day === dueDay &&
        item.targetScope === target.scope &&
        item.targetEntityId === target.entityId,
    );
    if (duplicate) continue;

    state.scheduleSeq += 1;
    state.pendingEvents.push({
      day: dueDay,
      phase: 4,
      seq: state.scheduleSeq,
      kind: 'event',
      refId: followUp.eventId,
      parentEventId: def.id,
      targetScope: target.scope,
      targetEntityId: target.entityId,
      chainStep: step,
    });
    notes.push(`排定后续 ${followUp.eventId}（+${followUp.delayDays} 天）`);
  }

  return notes;
}

export function applyEvent(
  state: WorldState,
  content: WorldContent,
  trigger: Triggered,
  rng: Random | null = null,
): Outcome {
  const { def, target } = trigger;
  const changes: string[] = [];

  for (const effect of def.effects) {
    changes.push(...applyEffect(state, content, target, effect, def.id));
  }

  // 有选项的事件：不拦玩家时按效用自动择优（确定性，无 rng 也稳定）。
  if (def.choices && def.choices.length > 0) {
    const choice = pickChoice(state, target, def.choices);
    if (choice) {
      changes.push(...resolveChoice(state, content, def, target, choice, rng));
      changes.push(`抉择：${choice.label}`);
    }
  }

  if (rng) {
    changes.push(...scheduleFollowUps(state, def, target, rng));
  }

  const cooldown =
    def.cooldownDays > 0 ? def.cooldownDays : content.balance.events.defaultCooldownDays;
  state.cooldowns[`${def.id}@${target.entityId}`] = state.clock.day + cooldown;

  const notes = changes.filter((line) => line.includes('检定') || line.startsWith('抉择：'));
  const suffix = notes.length > 0 ? `：${notes.join('；')}` : '';
  return {
    def,
    target,
    summary: `${eventText(state, def, target).title}（${labelOf(state, target)}）${suffix}`,
    changes,
  };
}

export function resolveChoice(
  state: WorldState,
  content: WorldContent,
  def: EventDef,
  target: EventTarget,
  choice: ChoiceDef,
  rng: Random | null = null,
): string[] {
  const changes: string[] = [];
  let effects = choice.effects;
  const character = target.scope === 'character' ? state.characters[target.entityId] : undefined;
  if (choice.check && character) {
    const key = `${def.id}:${choice.id}`;
    const check = rollCheck(rng ?? fallbackRng(state), character, choice.check, key);
    changes.push(check.text);
    if (!check.success) effects = choice.failureEffects ?? [];
  }
  for (const effect of effects) {
    changes.push(...applyEffect(state, content, target, effect, def.id));
  }
  if (rng) changes.push(...scheduleFollowUps(state, def, target, rng));
  return changes;
}
