/**
 * 模拟命令行：`pnpm sim --years 100 --seed demo [--check]`
 *
 * 这是 M1 的验收入口（开发计划 §8 里程碑 M1）：
 * - 输出 100 年后的摘要与状态哈希；
 * - `--check` 再跑一遍，确认两次哈希一致（R1）；
 * - 同时打印耗时，对齐 §9.3 的性能预算。
 */

import { content } from '../src/content/index';
import { GameEngine } from '../src/core/GameEngine';
import { DAYS_PER_YEAR } from '../src/core/GameClock';
import { createWorld, validateWorld } from '../src/core/WorldState';

interface Options {
  readonly years: number;
  readonly seed: string;
  readonly check: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  let years = 100;
  let seed = 'demo-seed';
  let check = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--years') {
      const value = Number(argv[index + 1]);
      if (Number.isFinite(value) && value > 0) years = Math.floor(value);
      index += 1;
    } else if (arg === '--seed') {
      const value = argv[index + 1];
      if (value) seed = value;
      index += 1;
    } else if (arg === '--check') {
      check = true;
    }
  }
  return { years, seed, check };
}

function run(years: number, seed: string): { hash: string; elapsed: number; engine: GameEngine } {
  const world = createWorld(content, { seed, createdAt: 0 });
  const engine = new GameEngine(world, content);
  const started = performance.now();
  engine.advanceDays(years * DAYS_PER_YEAR);
  const elapsed = performance.now() - started;
  return { hash: engine.hash(), elapsed, engine };
}

function main(): void {
  const { years, seed, check } = parseArgs(process.argv.slice(2));
  const first = run(years, seed);
  const state = first.engine.state;

  const problems = validateWorld(state);
  const orgs = Object.keys(state.organizations).length;
  const alive = Object.values(state.characters).filter((character) => character.alive).length;
  const events = state.history.filter((record) => record.kind === 'event').length;
  const deaths = state.history.filter((record) => record.kind === 'death').length;
  const dissolved = state.history.filter(
    (record) => record.kind === 'milestone' && record.summary.includes('解散'),
  ).length;

  console.log('王座与黄金 · 模拟摘要');
  console.log('──────────────────────────────');
  console.log(`种子        ${seed}`);
  console.log(`时长        ${years} 年（${years * DAYS_PER_YEAR} 天）`);
  console.log(`结束日期    第 ${state.clock.day} 天`);
  console.log(`状态哈希    ${first.hash}`);
  console.log(`耗时        ${first.elapsed.toFixed(0)} ms`);
  console.log(`组织        ${orgs} 家（解散 ${dissolved}）`);
  console.log(`存活人物    ${alive}`);
  console.log(`事件记录    ${events} 条 / 死亡 ${deaths} 人`);
  console.log(`历史总条数  ${state.history.length}`);
  console.log(
    `校验        ${problems.length === 0 ? '通过' : `失败：${problems.slice(0, 5).join('；')}`}`,
  );

  if (check) {
    const second = run(years, seed);
    const same = second.hash === first.hash;
    console.log(`复跑校验    ${same ? '一致 ✅' : '不一致 ❌'}`);
    if (!same) {
      console.log(`  第一次 ${first.hash}`);
      console.log(`  第二次 ${second.hash}`);
      process.exitCode = 1;
    }
  }

  if (problems.length > 0) process.exitCode = 1;
}

main();
