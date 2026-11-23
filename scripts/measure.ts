/**
 * 阶段测量（P0 测量基建）：四类数字一次跑出来，用于阶段之间的对比。
 *
 *   玩家   bot 三十年的身家曲线、生涯、官职、子女
 *   货币   世界里到底有多少钱、物价偏了多少、国债在谁手上
 *   叙事   编年史有多少条、其中多少与玩家有关、模版重复到什么程度
 *   内容   事件库触发率，哪些事件从来没响过
 *
 * 用法：
 *   node --import tsx scripts/measure.ts --seed demo --years 10
 *   node --import tsx scripts/measure.ts --seed demo --years 10 --out .tmp/measure.json
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { content } from '../src/content/index';
import { GameEngine } from '../src/core/GameEngine';
import { createWorld, type WorldState } from '../src/core/WorldState';
import { officesOf, playEngine } from './playtest-bot';

interface MoneyMeasure {
  readonly moneySupply: number;
  readonly growth: number;
  readonly treasury: number;
  readonly deposits: number;
  readonly debt: number;
  readonly priceDeviation: number;
}

interface NarrativeMeasure {
  readonly records: number;
  readonly events: number;
  readonly playerRelated: number;
  readonly repeatShare: number;
  readonly meanBodyLength: number;
}

interface ContentMeasure {
  readonly defs: number;
  readonly fired: number;
  readonly silent: number;
  readonly silentIds: readonly string[];
}

export interface MeasureReport {
  readonly seed: string;
  readonly years: number;
  readonly days: number;
  readonly playedMonths: number;
  readonly alive: boolean;
  readonly player: {
    readonly wealth: number;
    readonly multiple: number;
    readonly careerRank: number;
    readonly officeTitles: readonly string[];
    readonly children: number;
  };
  readonly money: MoneyMeasure;
  readonly narrative: NarrativeMeasure;
  readonly content: ContentMeasure;
  readonly ms: number;
}

function moneyOf(state: WorldState): MoneyMeasure {
  let characters = 0;
  let deposits = 0;
  for (const character of Object.values(state.characters)) {
    if (!character.alive) continue;
    characters += character.wealth;
    deposits += Object.values(character.deposits).reduce((sum, value) => sum + value, 0);
  }
  let orgs = 0;
  for (const org of Object.values(state.organizations)) orgs += org.cash;
  let treasury = 0;
  let debt = 0;
  for (const country of Object.values(state.countries)) {
    if (country.extinct) continue;
    treasury += country.treasury;
    debt += country.debt;
  }

  let deviation = 0;
  let markets = 0;
  for (const market of Object.values(state.markets)) {
    const mid = (market.floor + market.ceiling) / 2;
    if (mid <= 0) continue;
    deviation += Math.abs(market.price / mid - 1);
    markets += 1;
  }

  return {
    moneySupply: characters + orgs + deposits + treasury,
    treasury,
    deposits,
    debt,
    priceDeviation: markets === 0 ? 0 : deviation / markets,
  };
}

function narrativeOf(state: WorldState): NarrativeMeasure {
  const records = state.history;
  const events = records.filter((record) => record.causeEventId !== null);
  const playerRelated = records.filter((record) =>
    record.refs.some((ref) => ref.id === state.playerId),
  );
  const counts = new Map<string, number>();
  for (const record of records) {
    // 模版 = 摘要里「（主体）」之前的部分；正文不同但骨架相同的算同一句。
    const template = (record.summary.split('（')[0] ?? record.summary).trim();
    counts.set(template, (counts.get(template) ?? 0) + 1);
  }
  const top = Math.max(0, ...counts.values());
  const bodies = events.map((record) => record.body ?? '');
  const meanBodyLength =
    bodies.length === 0 ? 0 : bodies.reduce((sum, body) => sum + body.length, 0) / bodies.length;

  return {
    records: records.length,
    events: events.length,
    playerRelated: playerRelated.length,
    repeatShare: records.length === 0 ? 0 : top / records.length,
    meanBodyLength,
  };
}

function contentOf(state: WorldState): ContentMeasure {
  const fired = new Set<string>();
  for (const record of state.history) {
    if (record.causeEventId !== null) fired.add(record.causeEventId);
  }
  const silentIds = content.events
    .map((def) => def.id)
    .filter((id) => !fired.has(id))
    .sort();
  return {
    defs: content.events.length,
    fired: fired.size,
    silent: silentIds.length,
    silentIds,
  };
}

export function measure(seed: string, years: number): MeasureReport {
  const started = performance.now();
  const world = createWorld(content, { seed, createdAt: 0 });
  const engine = new GameEngine(world, content);
  const state = engine.state;
  const startMoney = moneyOf(state).moneySupply;
  const startWealth = state.characters[state.playerId]?.wealth ?? 1;
  const stats = playEngine(engine, years * 12);
  const finalPlayer = state.characters[state.playerId];
  const money = moneyOf(state);

  return {
    seed,
    years,
    days: state.clock.day,
    playedMonths: stats.months,
    alive: engine.playerAlive,
    player: {
      wealth: finalPlayer?.wealth ?? 0,
      multiple: (finalPlayer?.wealth ?? 0) / Math.max(1, startWealth),
      careerRank: finalPlayer?.careerRank ?? 0,
      officeTitles: officesOf(state),
      children: Object.values(state.characters).filter(
        (character) =>
          character.parentIds[0] === state.playerId || character.parentIds[1] === state.playerId,
      ).length,
    },
    money: {
      ...money,
      moneySupply: money.moneySupply,
      growth: money.moneySupply / Math.max(1, startMoney),
    },
    narrative: narrativeOf(state),
    content: contentOf(state),
    ms: Math.round(performance.now() - started),
  };
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function print(report: MeasureReport): void {
  console.log(`王座与黄金 · 测量（种子 ${report.seed}，${report.years} 年，${report.days} 天）`);
  console.log('──────────────────────────────────────────────');
  console.log('玩家（盲玩 bot）');
  console.log(`  现金        ${report.player.wealth} 铜（×${report.player.multiple.toFixed(2)}）`);
  console.log(`  生涯        ${report.player.careerRank}/3 阶`);
  console.log(`  官职        ${report.player.officeTitles.join('、') || '无'}`);
  console.log(`  子女        ${report.player.children} 人`);
  console.log('货币');
  console.log(`  流通量      ${report.money.moneySupply} 铜（×${report.money.growth.toFixed(2)}）`);
  console.log(`  国库        ${report.money.treasury} 铜`);
  console.log(`  存款        ${report.money.deposits} 铜`);
  console.log(`  国债        ${report.money.debt} 铜`);
  console.log(`  物价偏离    ${pct(report.money.priceDeviation)}`);
  console.log('叙事');
  console.log(`  编年史      ${report.narrative.records} 条`);
  console.log(
    `  事件条目    ${report.narrative.events} 条（正文均长 ${report.narrative.meanBodyLength.toFixed(1)} 字）`,
  );
  console.log(
    `  与玩家有关  ${pct(report.narrative.playerRelated / Math.max(1, report.narrative.records))}`,
  );
  console.log(`  最高模版    ${pct(report.narrative.repeatShare)}`);
  console.log('内容');
  console.log(`  事件库      ${report.content.defs} 条，触发 ${report.content.fired} 条`);
  console.log(`  从未触发    ${report.content.silent} 条`);
  console.log(`  耗时        ${report.ms} ms`);
}

function main(): void {
  const argv = process.argv.slice(2);
  let seed = 'demo';
  let years = 10;
  let out = '';
  let all = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--seed' && argv[index + 1]) seed = argv[index + 1]!;
    if (argv[index] === '--years' && argv[index + 1]) years = Number(argv[index + 1]);
    if (argv[index] === '--out' && argv[index + 1]) out = argv[index + 1]!;
    if (argv[index] === '--all') all = true;
  }

  if (all) {
    // 三个种子各跑一遍，只打关键行：任何一项明显跑偏都能一眼看出来。
    const rows = ['demo', 'alpha', 'beta'].map((item) => measure(item, years));
    console.log('种子     现金倍数 货币倍数 物价偏离 玩家相关 模版重复 事件触发 耗时');
    for (const row of rows) {
      console.log(
        [
          row.seed.padEnd(8),
          `×${row.player.multiple.toFixed(2)}`.padEnd(8),
          `×${row.money.growth.toFixed(2)}`.padEnd(8),
          pct(row.money.priceDeviation).padEnd(8),
          pct(row.narrative.playerRelated / Math.max(1, row.narrative.records)).padEnd(8),
          pct(row.narrative.repeatShare).padEnd(8),
          `${row.content.fired}/${row.content.defs}`.padEnd(8),
          `${row.ms} ms`,
        ].join(' '),
      );
    }
    if (out !== '') {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
      console.log(`快照已写入 ${out}`);
    }
    return;
  }

  const report = measure(seed, years);
  print(report);
  if (out !== '') {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`快照已写入 ${out}`);
  }
}

if (process.argv[1]?.endsWith('measure.ts') === true) main();
