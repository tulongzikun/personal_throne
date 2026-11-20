/* 抉择的效用打分与自动选择。 */

import { Random } from '../Random';
import type { ChoiceDef, WorldState } from '../WorldState';
import { evaluate } from './eventConditions';
import { readFeature } from './eventFeatures';
import type { EventTarget } from './eventTypes';

/** 选项效用：把效果折算成同一量纲，供 NPC 自动择优。 */
export function choiceUtility(choice: ChoiceDef): number {
  let score = 0;
  for (const effect of choice.effects) {
    if (effect.kind === 'schedule' || effect.kind === 'merge') {
      score += 20;
      continue;
    }
    if (effect.kind === 'stat') {
      score += Math.abs(effect.value) * 10;
      continue;
    }
    const magnitude = Math.abs(effect.value);
    if (effect.path === 'legitimacy' || effect.path === 'stability') score += magnitude * 500;
    else if (effect.path === 'conflict') score -= magnitude * 400;
    else if (effect.path === 'wealth' || effect.path === 'cash') score += effect.value;
    else if (effect.path === 'treasury') score += effect.value * 0.5;
    else score += effect.value;
  }
  return score;
}

/** 可用选项（满足条件）里选效用最高者；同分按 id 稳定排序。 */
export function pickChoice(
  state: WorldState,
  target: EventTarget,
  choices: readonly ChoiceDef[],
): ChoiceDef | null {
  const resolver = (path: string): number => readFeature(state, target, path);
  const available = choices
    .filter((choice) => !choice.conditions || evaluate(choice.conditions, resolver))
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let best: ChoiceDef | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const choice of available) {
    const score = choiceUtility(choice);
    if (score > bestScore) {
      best = choice;
      bestScore = score;
    }
  }
  return best;
}

/** 应用某个选项并返回变化说明；调用方负责把 pending 从状态里移除。 */
/** 没有显式 rng（直接调用 applyEvent）时，用种子派生一个可复现的掷骰源。 */
export function fallbackRng(state: WorldState): Random {
  return new Random(`${state.meta.seed}:check`);
}
