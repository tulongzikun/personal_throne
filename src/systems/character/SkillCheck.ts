/**
 * 技能检定：2d6 + 技能 vs 难度（GDD §8.1）。
 *
 * 契约：
 * - 所有骰子来自命名流，键 = `${checkId}:<n>`，与调用顺序无关；
 * - 返回结构化结果，成功与否之外还给出"差多少"，便于叙事与失败推进；
 * - 大成功/大失败（双 6 / 双 1）单独标记，供事件文本使用。
 */

import type { Random } from '../../core/Random';

export interface CheckResult {
  readonly checkId: string;
  readonly skill: string;
  readonly dice: readonly [number, number];
  readonly skillValue: number;
  readonly total: number;
  readonly difficulty: number;
  readonly success: boolean;
  readonly margin: number;
  readonly critical: 'success' | 'failure' | null;
}

export interface CheckOptions {
  readonly checkId: string;
  readonly skill: string;
  readonly skillValue: number;
  readonly difficulty: number;
  /** 环境/装备修正，可为负。 */
  readonly modifier?: number;
}

export function skillCheck(rng: Random, options: CheckOptions): CheckResult {
  const first = rng.int({ stream: 'check', entityId: options.checkId, periodKey: 'd1' }, 1, 6);
  const second = rng.int({ stream: 'check', entityId: options.checkId, periodKey: 'd2' }, 1, 6);
  const dice: [number, number] = [first, second];

  const total = first + second + options.skillValue + (options.modifier ?? 0);
  const margin = total - options.difficulty;
  const critical =
    first === 6 && second === 6 ? 'success' : first === 1 && second === 1 ? 'failure' : null;

  return {
    checkId: options.checkId,
    skill: options.skill,
    dice,
    skillValue: options.skillValue,
    total,
    difficulty: options.difficulty,
    success: critical === 'success' ? true : critical === 'failure' ? false : margin >= 0,
    margin,
    critical,
  };
}

/** 对抗检定：双方各掷 2d6 + 技能，差值决定胜负，平局按稳定 ID 排序判胜。 */
export function opposedCheck(
  rng: Random,
  checkId: string,
  skill: string,
  left: { readonly id: string; readonly value: number },
  right: { readonly id: string; readonly value: number },
): { readonly winner: string; readonly leftTotal: number; readonly rightTotal: number } {
  const leftResult = skillCheck(rng, {
    checkId: `${checkId}:${left.id}`,
    skill,
    skillValue: left.value,
    difficulty: 10,
  });
  const rightResult = skillCheck(rng, {
    checkId: `${checkId}:${right.id}`,
    skill,
    skillValue: right.value,
    difficulty: 10,
  });

  const leftTotal = leftResult.dice[0] + leftResult.dice[1] + left.value;
  const rightTotal = rightResult.dice[0] + rightResult.dice[1] + right.value;
  const winner =
    leftTotal === rightTotal
      ? left.id < right.id
        ? left.id
        : right.id
      : leftTotal > rightTotal
        ? left.id
        : right.id;

  return { winner, leftTotal, rightTotal };
}
