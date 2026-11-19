/**
 * 可复现随机数（PCG32 + 命名流）。
 *
 * 设计要点：
 * - 每一次抽样都是 `(seed, stream, entityId, periodKey, counter)` 的纯函数，
 *   与调用顺序、对象遍历顺序无关 —— 这是"逐月快进 == 一次快进"的根本保证。
 * - 计数器落在 `WorldState.rngCounters`，随存档一起序列化。
 * - 禁止 `Math.random()`（ESLint 强制）。
 */

const MASK64 = (1n << 64n) - 1n;
const PCG_MULTIPLIER = 6364136223846793005n;

/** FNV-1a 64 位哈希：字符串 → 64 位无符号整数。 */
export function fnv1a64(input: string): bigint {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & MASK64;
  }
  return hash;
}

export interface RngSnapshot {
  readonly seed: string;
  readonly counters: Record<string, number>;
}

export interface DrawKey {
  readonly stream: string;
  readonly entityId: string;
  readonly periodKey: string;
}

/** 命名流键：`stream:entityId:periodKey`。 */
export function keyOf(key: DrawKey): string {
  return `${key.stream}:${key.entityId}:${key.periodKey}`;
}

/** 单步 PCG32：返回 32 位输出与新状态。 */
function pcg32Step(state: bigint, increment: bigint): { value: number; state: bigint } {
  const old = state;
  const next = (old * PCG_MULTIPLIER + increment) & MASK64;
  const xorshifted = Number((((old >> 18n) ^ old) >> 27n) & 0xffffffffn);
  const rot = Number((old >> 59n) & 31n);
  const value = ((xorshifted >>> rot) | (xorshifted << ((32 - rot) & 31))) >>> 0;
  return { value, state: next };
}

/** 由一个 64 位派生值构造 PCG32 状态并预热两轮。 */
function seedStream(derived: bigint): { state: bigint; increment: bigint } {
  const increment = ((derived >> 1n) << 1n) | 1n;
  let state = 0n;
  state = pcg32Step(state, increment).state;
  state = (state + derived) & MASK64;
  state = pcg32Step(state, increment).state;
  return { state, increment };
}

export class Random {
  private readonly seed: string;
  private readonly counters: Record<string, number>;

  constructor(seed: string, counters: Record<string, number> = {}) {
    this.seed = seed;
    this.counters = { ...counters };
  }

  static fromSnapshot(snapshot: RngSnapshot): Random {
    return new Random(snapshot.seed, snapshot.counters);
  }

  snapshot(): RngSnapshot {
    return { seed: this.seed, counters: { ...this.counters } };
  }

  /** 当前计数器快照（引擎把它写回 WorldState.rngCounters）。 */
  countersOf(): Record<string, number> {
    return { ...this.counters };
  }

  /** 该键已被抽样的次数，用于调试与一致性断言。 */
  counterFor(key: DrawKey): number {
    return this.counters[keyOf(key)] ?? 0;
  }

  /** 32 位无符号整数。 */
  nextUint32(key: DrawKey): number {
    const id = keyOf(key);
    const counter = this.counters[id] ?? 0;
    this.counters[id] = counter + 1;
    const derived = fnv1a64(`${this.seed}|${id}|${counter}`);
    const { state, increment } = seedStream(derived);
    return pcg32Step(state, increment).value;
  }

  /** [0, 1) 均匀分布。 */
  nextFloat(key: DrawKey): number {
    return this.nextUint32(key) / 4294967296;
  }

  /** [min, max] 闭区间整数。 */
  int(key: DrawKey, min: number, max: number): number {
    if (max <= min) return min;
    return min + (this.nextUint32(key) % (max - min + 1));
  }

  /** 以概率 p 命中。 */
  chance(key: DrawKey, p: number): boolean {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return this.nextFloat(key) < p;
  }

  /** 指数分布抽样（事件竞速用）。u ∈ (0,1]，返回 -ln(u)/lambda。 */
  exponential(key: DrawKey, lambda: number): number {
    if (lambda <= 0) return Number.POSITIVE_INFINITY;
    const u = 1 - this.nextFloat(key); // (0, 1]
    return -Math.log(u) / lambda;
  }

  /** 按权重挑选一项；权重非正时退化为等概率。 */
  weightedIndex(key: DrawKey, weights: readonly number[]): number {
    const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
    if (total <= 0) return this.int(key, 0, Math.max(0, weights.length - 1));
    let roll = this.nextFloat(key) * total;
    for (let i = 0; i < weights.length; i += 1) {
      roll -= Math.max(0, weights[i] ?? 0);
      if (roll <= 0) return i;
    }
    return Math.max(0, weights.length - 1);
  }
}
