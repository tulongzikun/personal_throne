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
  const dissolved = state.stats.dissolved;
  const everOrgs = 10 + state.stats.founded;
  const bankruptRate = everOrgs > 0 ? state.stats.bankruptcies / everOrgs : 0;
  const splitOrgs = new Set<string>();
  for (const record of state.history) {
    if (record.causeEventId !== 'ev_org_split') continue;
    const ref = record.refs[0];
    if (ref) splitOrgs.add(ref.id);
  }
  const splitRate = everOrgs > 0 ? splitOrgs.size / everOrgs : 0;
  const avgOrgs =
    state.stats.orgCountSamples > 0 ? state.stats.orgCountSum / state.stats.orgCountSamples : 0;
  const priceDeviation =
    state.stats.priceSamples > 0 ? state.stats.priceDeviationSum / state.stats.priceSamples : 0;
  const marketRatios: { key: string; ratio: number }[] = [];
  for (const market of Object.values(state.markets)) {
    const good = content.goods.find((item) => item.id === market.goodId);
    if (!good) continue;
    marketRatios.push({
      key: `${market.regionId}:${market.goodId}`,
      ratio: market.price / good.basePrice,
    });
  }
  marketRatios.sort((a, b) => a.ratio - b.ratio);
  const p95Index = Math.max(0, Math.ceil(marketRatios.length * 0.95) - 1);
  const p95 = marketRatios[p95Index]?.ratio ?? 0;
  const withinBand = marketRatios.filter((item) => item.ratio >= 0.7 && item.ratio <= 1.4).length;
  const widest = marketRatios[marketRatios.length - 1];
  const eventCounts = new Map<string, number>();
  for (const record of state.history) {
    if (!record.causeEventId) continue;
    eventCounts.set(record.causeEventId, (eventCounts.get(record.causeEventId) ?? 0) + 1);
  }

  console.log('王座与黄金 · 模拟摘要');
  console.log('──────────────────────────────');
  console.log(`种子        ${seed}`);
  console.log(`时长        ${years} 年（${years * DAYS_PER_YEAR} 天）`);
  console.log(`结束日期    第 ${state.clock.day} 天`);
  console.log(`状态哈希    ${first.hash}`);
  console.log(`耗时        ${first.elapsed.toFixed(0)} ms`);
  console.log(`组织        ${orgs} 家（平均组织数 ${avgOrgs.toFixed(2)}，解散 ${dissolved}）`);
  console.log(
    `破产/重组    ${state.stats.bankruptcies} / ${state.stats.restructurings}（破产率 ${(bankruptRate * 100).toFixed(1)}%）`,
  );
  console.log(
    `分裂/并购    ${splitOrgs.size} 家分裂 / ${state.stats.mergers} 起并购（分裂率 ${(splitRate * 100).toFixed(1)}%）`,
  );
  console.log(
    `新进入       ${state.stats.founded} 家 / 价格偏离基准 ${(priceDeviation * 100).toFixed(1)}% / 关税 ${state.stats.tariffRevenue}`,
  );
  console.log(
    `市场偏离    均价偏离 ${(priceDeviation * 100).toFixed(1)}% / p95 ${(p95 * 100).toFixed(1)}% / 70–140% 内 ${withinBand}/${marketRatios.length}${
      widest ? `（最高 ${widest.key} ${(widest.ratio * 100).toFixed(0)}%）` : ''
    }`,
  );
  console.log(
    `政策        提案 ${state.stats.policyProposals} / 变更 ${state.stats.policyChanges} / 支出 ${state.stats.policyCost} / 最小间隔 ${state.stats.minPolicyIntervalDays} 天`,
  );
  console.log(`政体        变更 ${state.stats.polityChanges} 次`);

  const warRecords = state.history.filter((record) => record.kind === 'war');
  const declarations = warRecords.filter((record) => record.summary.includes('宣战')).length;
  const battles = warRecords.filter((record) => record.summary.includes('会战')).length;
  const occupations = warRecords.filter((record) => record.summary.includes('占领')).length;
  const peaces = warRecords.filter((record) => record.summary.includes('停战')).length;
  const activeWars =
    Object.values(state.countries).reduce((sum, country) => sum + country.atWarWith.length, 0) / 2;
  console.log(
    `战争        宣战 ${declarations} / 会战 ${battles} / 占领 ${occupations} / 停战 ${peaces} / 当前交战 ${activeWars} 对`,
  );
  console.log(
    `事件分布    ${[...eventCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => `${id}×${count}`)
      .join('，')}`,
  );
  console.log(`存活人物    ${alive}`);
  const born = Object.values(state.characters).filter(
    (character) => character.parentIds[0] !== null && character.parentIds[1] !== null,
  ).length;
  const married = Math.round(
    Object.values(state.characters).filter(
      (character) => character.alive && character.spouseId !== null,
    ).length / 2,
  );
  console.log(
    `人口        ${alive} 位具名人物 / 出生 ${born} 位 / 婚姻 ${married} 对 / 家族 ${Object.keys(state.families).length} 个`,
  );
  console.log(`事件记录    ${events} 条 / 死亡 ${deaths} 人`);
  console.log(`历史总条数  ${state.history.length}`);
  console.log(
    `校验        ${problems.length === 0 ? '通过' : `失败：${problems.slice(0, 5).join('；')}`}`,
  );

  if (check) {
    const second = run(years, seed);
    const same = second.hash === first.hash;
    console.log(`复跑校验    ${same ? '一致 ✅' : '不一致 ❌'}`);
    console.log(`复跑耗时    ${second.elapsed.toFixed(0)} ms`);
    if (!same) {
      console.log(`  第一次 ${first.hash}`);
      console.log(`  第二次 ${second.hash}`);
      process.exitCode = 1;
    }
  }

  if (problems.length > 0) process.exitCode = 1;
}

main();
