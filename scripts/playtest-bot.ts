/**
 * 盲玩 bot（P0 测量基建）：只用玩家能看见的信息做决策，每月一个动作。
 *
 * 它的作用不是"证明游戏好玩"，而是给每个阶段一个可比的玩家曲线：
 * 同样的种子与规则下，主动的 bot 挣到多少、多久能升一阶、有没有子女。
 * 决策顺序写死、不含随机，所以同样的种子跑出同样的结果。
 *
 * 用法：`node --import tsx scripts/playtest-bot.ts --seed demo --years 30`
 */

import { content } from '../src/content/index';
import { GameEngine } from '../src/core/GameEngine';
import { DAYS_PER_YEAR } from '../src/core/GameClock';
import type { Command } from '../src/core/CommandBus';
import { createWorld, type WorldState } from '../src/core/WorldState';
import { tradeCarryCapacity } from '../src/systems/character/SkillEffects';
import { bestTradeRoute } from '../src/systems/goals/Goals';

export interface BotReport {
  readonly seed: string;
  readonly years: number;
  readonly alive: boolean;
  readonly months: number;
  readonly wealth: number;
  readonly startWealth: number;
  readonly careerRank: number;
  readonly officeTitles: readonly string[];
  readonly children: number;
  readonly actionPointsSpent: number;
  readonly daysSpent: number;
  readonly dyingDay: number | null;
}

/** 官位：玩家名下所有国家的公职。 */
export function officesOf(state: WorldState): string[] {
  const titles: string[] = [];
  for (const country of Object.values(state.countries)) {
    for (const office of country.offices) {
      if (office.holderId === state.playerId) titles.push(office.title);
    }
  }
  return titles.sort();
}

/**
 * 本月做什么。优先级就是"先别死、再挣钱、最后练本事"：
 * 健康低先休息；有划得来的商路就贩货；钱多了存钱庄；剩下的练最便宜的技能。
 */
export function chooseAction(state: WorldState): Command | null {
  const player = state.characters[state.playerId];
  if (!player || !player.alive) return null;
  if (player.actionPoints <= 0) return null;
  if (player.health < 55) return { kind: 'rest' };

  const capacity = Math.max(1, tradeCarryCapacity(player));
  const route = bestTradeRoute(state, content, capacity);
  if (route && route.profit >= 25) {
    return {
      kind: 'trade_goods',
      goodId: route.goodId,
      units: route.units,
      targetRegionId: route.target,
    };
  }

  const depositTotal = Object.values(player.deposits).reduce((sum, value) => sum + value, 0);
  if (player.wealth > 400 && depositTotal < 2000) return { kind: 'deposit', amount: 100 };

  const skill = Object.entries(player.skills)
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .find(([name, level]) => name !== '' && level < 5);
  if (skill && player.wealth > 500) return { kind: 'train', skill: skill[0] };

  const office = officesOf(state)[0];
  if (office === undefined) {
    const country = Object.values(state.countries)
      .filter((item) => !item.extinct && item.regionIds.includes(player.regionId))
      .sort((a, b) => a.id.localeCompare(b.id))[0];
    const seat = country?.offices[0];
    if (country && seat) return { kind: 'seek_office', countryId: country.id, officeId: seat.id };
  }

  return { kind: 'rest' };
}

export interface PlayStats {
  readonly months: number;
  readonly spent: number;
  readonly spentDays: number;
  readonly dyingDay: number | null;
}

/** 在一局已有的世界上替玩家做决定，逐月推进。 */
export function playEngine(engine: GameEngine, months: number): PlayStats {
  const state = engine.state;
  let spent = 0;
  let spentDays = 0;
  let dyingDay: number | null = null;
  let played = 0;
  for (let month = 0; month < months; month += 1) {
    if (!engine.playerAlive) {
      dyingDay = state.clock.day;
      break;
    }
    const before = state.characters[state.playerId]?.actionPoints ?? 0;
    const dayBefore = state.clock.day;
    const command = chooseAction(state);
    if (command) {
      engine.dispatch(command);
      const after = state.characters[state.playerId]?.actionPoints ?? 0;
      spent += Math.max(0, before - after);
      spentDays += state.clock.day - dayBefore;
    }
    played += 1;
    // 推到下个月的月初：AP 在这里回满。
    const target = month * 30 + 30;
    if (target > state.clock.day) engine.advanceTo(target);
  }
  return { months: played, spent, spentDays, dyingDay };
}

export function runBot(seed: string, years: number): BotReport {
  const world = createWorld(content, { seed, createdAt: 0 });
  const engine = new GameEngine(world, content);
  const state = engine.state;
  const player = state.characters[state.playerId];
  const startWealth = player?.wealth ?? 0;
  const stats = playEngine(engine, years * 12);
  const finalPlayer = state.characters[state.playerId];
  const children = Object.values(state.characters).filter(
    (character) =>
      character.parentIds[0] === state.playerId || character.parentIds[1] === state.playerId,
  ).length;

  return {
    seed,
    years,
    alive: engine.playerAlive,
    months: stats.months,
    wealth: finalPlayer?.wealth ?? 0,
    startWealth,
    careerRank: finalPlayer?.careerRank ?? 0,
    officeTitles: officesOf(state),
    children,
    actionPointsSpent: stats.spent,
    daysSpent: stats.spentDays,
    dyingDay: stats.dyingDay,
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  let seed = 'demo';
  let years = 30;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--seed' && argv[index + 1]) seed = argv[index + 1]!;
    if (argv[index] === '--years' && argv[index + 1]) years = Number(argv[index + 1]);
  }

  const report = runBot(seed, years);
  console.log('王座与黄金 · 盲玩 bot');
  console.log('──────────────────────────────');
  console.log(`种子        ${report.seed}`);
  console.log(`时长        ${report.years} 年（实际 ${report.months} 个月）`);
  console.log(`结局        ${report.alive ? '活着' : `第 ${report.dyingDay ?? '?'} 天去世`}`);
  console.log(`现金        ${report.startWealth} → ${report.wealth} 铜`);
  console.log(`生涯        ${report.careerRank}/3 阶`);
  console.log(`官职        ${report.officeTitles.join('、') || '无'}`);
  console.log(`子女        ${report.children} 人`);
  console.log(`花掉的时间 ${report.daysSpent} 天（行动力 ${report.actionPointsSpent} 点）`);
  const perYear = report.years * DAYS_PER_YEAR;
  console.log(`日均为      ${(report.wealth / Math.max(1, perYear)).toFixed(2)} 铜/天`);
}

if (process.argv[1]?.endsWith('playtest-bot.ts') === true) main();
