/**
 * d20 检定：属性不再是摆设，而是掷骰的加值来源。
 *
 * 规则对玩家可见：`力量检定 d20+2 ≥ 12`——先看属性，再看难度，掷出 1–20。
 * 检定结果写进历史与弹窗，失败时走 `failureEffects`，不会静默吞掉。
 */

import type { AttributeKey, Character } from '../../core/WorldState';
import type { Random } from '../../core/Random';

export const DIE_SIDES = 20;

export const ATTRIBUTE_NAMES: Record<AttributeKey, string> = {
  physique: '力量',
  agility: '敏捷',
  intellect: '智力',
  willpower: '意志',
  perception: '感知',
  charisma: '魅力',
};

export interface CheckSpec {
  readonly attribute: AttributeKey;
  readonly difficulty: number;
}

export interface CheckResult {
  readonly attribute: AttributeKey;
  readonly attributeName: string;
  readonly difficulty: number;
  readonly roll: number;
  readonly bonus: number;
  readonly total: number;
  readonly success: boolean;
  /** 给玩家看的一句话：`智力检定 d20+2 = 14 ≥ 12，成功`。 */
  readonly text: string;
}

/** d20 惯例：属性 10 为 0，每高 2 点 +1。 */
export function checkBonus(attributeValue: number): number {
  return Math.floor((attributeValue - 10) / 2);
}

export function bonusText(bonus: number): string {
  return bonus >= 0 ? `+${bonus}` : `${bonus}`;
}

/** 给按钮/提示用的规则说明：看哪个属性、加值多少、门槛多少。 */
export function describeCheck(character: Character, spec: CheckSpec): string {
  const bonus = checkBonus(character.attributes[spec.attribute]);
  return `${ATTRIBUTE_NAMES[spec.attribute]}检定 d20${bonusText(bonus)} ≥ ${spec.difficulty}`;
}

export function rollCheck(
  rng: Random,
  character: Character,
  spec: CheckSpec,
  key: string,
): CheckResult {
  const roll = rng.int({ stream: 'check', entityId: character.id, periodKey: key }, 1, DIE_SIDES);
  const bonus = checkBonus(character.attributes[spec.attribute]);
  const total = roll + bonus;
  const success = total >= spec.difficulty;
  const attributeName = ATTRIBUTE_NAMES[spec.attribute];
  return {
    attribute: spec.attribute,
    attributeName,
    difficulty: spec.difficulty,
    roll,
    bonus,
    total,
    success,
    text: `${attributeName}检定 d20(${roll})${bonusText(bonus)} = ${total} ${success ? '≥' : '<'} ${spec.difficulty}，${success ? '成功' : '失败'}`,
  };
}
