/* 玩家生命周期：第一份财报、死讯与继承。 */

import { formatDate } from '../../core/GameClock';
import type { GameEngine } from '../../core/GameEngine';
import type { CharacterId } from '../../core/WorldState';
import { ambitionOf, chapterOf } from '../../systems/goals/Ambition';
import type { EventDialog } from '../EventDialog';
import type { NoticeTone } from '../context';
import { fmtMoney } from '../dom';

export interface LifecycleDeps {
  engine(): GameEngine;
  dialog(): EventDialog;
  notify(message: string, tone?: NoticeTone): void;
  refresh(forceHash?: boolean): void;
  pause(): void;
  /** 继承后要重置的游标（历史 id 等）。 */
  afterInherit(): void;
}

/** 玩满一个月时给第一份财报：钱从哪来、花到哪去、下一步看什么。 */
export function maybeFirstReport(deps: LifecycleDeps, shown: { value: boolean }): void {
  if (shown.value) return;
  const state = deps.engine().state;
  if (state.clock.day < 30) return;
  shown.value = true;
  const player = state.characters[state.playerId];
  if (!player) return;
  const ambition = ambitionOf(state);
  const chapter = chapterOf(state);
  deps.dialog().pushMany([
    {
      title: '第一份财报',
      body: `一个月过去了，你的现金是 ${player.wealth} 铜币，健康 ${Math.round(player.health)}。${ambition ? `你的野心是「${ambition.name}」——${ambition.goal}，现在走到 ${Math.round(ambition.progress * 100)}%（${ambition.hint}）。` : ''}左下角的三条建议会随局势换，照着做就行；想看事情怎么发生，翻右下角的编年史。`,
      meta: `${formatDate(state.clock.day)} · 第 ${chapter.index} 章「${chapter.title}」`,
      tone: 'digest',
    },
  ]);
}

/** 玩家去世时弹出讣告，让玩家选继承人或就此落幕。 */
export function checkPlayerDeath(deps: LifecycleDeps, shown: { value: boolean }): void {
  if (shown.value || deps.engine().playerAlive) return;
  shown.value = true;
  deps.pause();

  const engine = deps.engine();
  const state = engine.state;
  const player = state.characters[state.playerId];
  const orgNames = Object.values(state.organizations)
    .filter(
      (org) =>
        org.shares.some((share) => share.characterId === state.playerId) ||
        org.leadership.leaderId === state.playerId,
    )
    .map((org) => org.name);
  const heirs = engine.heirs();
  const options = heirs.slice(0, 3).map((id: CharacterId) => ({
    id,
    label: `以 ${state.characters[id]?.name ?? id} 继续`,
  }));
  options.push({ id: '__end__', label: '就此落幕，看着世界继续' });
  const place = state.regions[player?.location.regionId ?? '']?.name ?? '异乡';

  deps.dialog().pushMany([
    {
      title: `${player?.name ?? '你'} 去世了`,
      body: `${formatDate(state.clock.day)}，${player?.name ?? '你'}在${place}去世，享年 ${player?.age ?? '?'} 岁。留下的现金 ${fmtMoney(player?.wealth ?? 0)}，股份涉及 ${orgNames.join('、') || '无'}，由继承人按遗嘱分派。你可以选择以某位继承人的身份继续，也可以让故事停在这里。`,
      meta: '讣告 · 世界不会停下来',
      tone: 'choice',
      options,
      onPick: (choiceId) => inherit(deps, shown, choiceId),
    },
  ]);
}

export function inherit(deps: LifecycleDeps, shown: { value: boolean }, characterId: string): void {
  if (characterId === '__end__') {
    deps.pause();
    deps.notify('故事到此为止；你可以继续翻看这座世界的编年史。', 'info');
    return;
  }
  const result = deps.engine().continueAs(characterId);
  if (!result.ok) {
    deps.notify(result.error ?? '无法继承', 'error');
    shown.value = false;
    return;
  }
  shown.value = false;
  deps.afterInherit();
  deps.refresh(true);
  deps.notify(result.summary ?? '你继承了家业', 'ok');
}
