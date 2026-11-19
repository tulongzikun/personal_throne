/**
 * 生涯路径（M4.3）。
 *
 * 三类职业各有一条 4 级阶梯，晋升看"财富 + 技能 + 职位"三项，
 * 不引入新的隐藏属性；等级存进 `Character.careerRank`（0–3）。
 *
 * 转行（例如商人 → 政治人物）要求已经站稳（等级 ≥1 或身居公职）并且有钱，
 * 转行后从 0 级重新往上爬，技能保留。
 */

import type { Character, CharacterId, WorldState } from '../../core/WorldState';
import { formatDate } from '../../core/GameClock';

export interface CareerStep {
  readonly rank: number;
  readonly title: string;
  /** 晋升所需的最低财富（铜币）。 */
  readonly minWealth: number;
  /** 晋升所需的"相关技能"下限（该职业主技能的当前值）。 */
  readonly minSkill: number;
}

/** 每个职业的主技能，用于判定晋升。 */
export const CAREER_PRIMARY_SKILL: Readonly<Record<string, string>> = {
  merchant: 'trade',
  mercenary: 'melee',
  politician: 'persuasion',
};

const LADDERS: Readonly<Record<string, readonly CareerStep[]>> = {
  merchant: [
    { rank: 0, title: '学徒', minWealth: 0, minSkill: 0 },
    { rank: 1, title: '伙计', minWealth: 800, minSkill: 3 },
    { rank: 2, title: '行商', minWealth: 4000, minSkill: 6 },
    { rank: 3, title: '商会主', minWealth: 12000, minSkill: 9 },
  ],
  mercenary: [
    { rank: 0, title: '新兵', minWealth: 0, minSkill: 0 },
    { rank: 1, title: '老兵', minWealth: 600, minSkill: 3 },
    { rank: 2, title: '队长', minWealth: 3000, minSkill: 6 },
    { rank: 3, title: '佣兵团长', minWealth: 9000, minSkill: 9 },
  ],
  politician: [
    { rank: 0, title: '书吏', minWealth: 0, minSkill: 0 },
    { rank: 1, title: '议员', minWealth: 1200, minSkill: 3 },
    { rank: 2, title: '大臣', minWealth: 6000, minSkill: 6 },
    { rank: 3, title: '执政', minWealth: 18000, minSkill: 9 },
  ],
};

export const CAREER_CLASSES: readonly string[] = Object.keys(LADDERS);

export function careerLadder(classId: string): readonly CareerStep[] {
  return LADDERS[classId] ?? LADDERS['merchant']!;
}

export function careerTitle(classId: string, rank: number): string {
  const ladder = careerLadder(classId);
  const step = ladder[Math.max(0, Math.min(ladder.length - 1, rank))] ?? ladder[0]!;
  return step.title;
}

export function careerLabel(character: Character): string {
  return careerTitle(character.classId, character.careerRank);
}

/** 主技能当前值。 */
export function primarySkill(character: Character): number {
  const skill = CAREER_PRIMARY_SKILL[character.classId] ?? 'trade';
  return character.skills[skill] ?? 0;
}

/** 升到下一级还差什么；已到顶返回 null。 */
export function nextCareerStep(character: Character): CareerStep | null {
  const ladder = careerLadder(character.classId);
  return ladder[character.careerRank + 1] ?? null;
}

export interface CareerChange {
  readonly characterId: CharacterId;
  readonly fromRank: number;
  readonly toRank: number;
  readonly title: string;
  readonly direction: 'up' | 'down';
}

/**
 * 年度晋升/降级。
 *
 * 只对**在世且等级未到顶**的人判定；公职持有者按职位数给一点加成（`officeBonus`），
 * 让"从政"路线靠头衔而不是纯财富也能往上走。
 */
export function settleYearlyCareer(state: WorldState, day: number): CareerChange[] {
  const changes: CareerChange[] = [];
  for (const character of Object.values(state.characters)) {
    if (!character.alive) continue;
    const ladder = careerLadder(character.classId);
    const target = ladder[character.careerRank + 1];
    const skill = primarySkill(character);
    const officeBonus = character.offices.length > 0 ? 1 : 0;
    if (target && character.wealth >= target.minWealth && skill + officeBonus >= target.minSkill) {
      character.careerRank = target.rank;
      character.careerSinceDay = day;
      changes.push({
        characterId: character.id,
        fromRank: target.rank - 1,
        toRank: target.rank,
        title: careerTitle(character.classId, target.rank),
        direction: 'up',
      });
      continue;
    }
    // 破产降级：等级 ≥1 且财富跌破本级门槛的 30%。
    const current = ladder[character.careerRank];
    if (character.careerRank > 0 && current && character.wealth < current.minWealth * 0.3) {
      character.careerRank -= 1;
      character.careerSinceDay = day;
      changes.push({
        characterId: character.id,
        fromRank: character.careerRank + 1,
        toRank: character.careerRank,
        title: careerTitle(character.classId, character.careerRank),
        direction: 'down',
      });
    }
  }
  return changes;
}

/** 转行门槛：等级 ≥1 或身居公职，且现金 ≥3000。 */
export const CAREER_SWITCH_WEALTH = 3000;

export interface CareerSwitchResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly message?: string;
}

export function canSwitchCareer(
  state: WorldState,
  characterId: CharacterId,
  classId: string,
): string | null {
  const character = state.characters[characterId];
  if (!character) return '找不到该人物';
  if (!character.alive) return '人物已故';
  if (!CAREER_CLASSES.includes(classId)) return `未知职业：${classId}`;
  if (character.classId === classId) return '这已经是当前职业';
  const established = character.careerRank >= 1 || character.offices.length > 0;
  if (!established) return '先在原职业站稳（升到 1 级或取得公职）再转行';
  if (character.wealth < CAREER_SWITCH_WEALTH) {
    return `转行需要至少 ${CAREER_SWITCH_WEALTH} 铜币的积蓄`;
  }
  return null;
}

export function switchCareer(
  state: WorldState,
  characterId: CharacterId,
  classId: string,
  day: number,
): CareerSwitchResult {
  const problem = canSwitchCareer(state, characterId, classId);
  if (problem) return { ok: false, error: problem };
  const character = state.characters[characterId]!;
  const from = `${character.classId}/${careerTitle(character.classId, character.careerRank)}`;
  character.classId = classId;
  character.careerRank = 0;
  character.careerSinceDay = day;
  const message = `${formatDate(day)} ${character.name} 从「${from}」转行做了 ${careerTitle(
    classId,
    0,
  )}（${classId}）`;
  return { ok: true, message };
}
