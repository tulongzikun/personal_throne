/**
 * 可复现随机数（命名流）。
 *
 * 设计要点：
 * - 每一次抽样都是 `(seed, stream, entityId, periodKey, counter)` 的纯函数，
 *   与调用顺序、对象遍历顺序无关 —— 这是"逐月快进 == 一次快进"的根本保证。
 * - 计数器落在 `WorldState.rngCounters`，随存档一起序列化。
 * - 禁止 `Math.random()`（ESLint 强制）。
 * - 抽样热路径使用 32 位整数混合（splitmix32），避免每次抽样构造 BigInt；
 *   存档哈希仍用 64 位 FNV，二者互不影响。
 */

/**
 * FNV-1a 64 位。
 *
 * 逐字符 BigInt 太贵（100 年模拟里它曾占 21% 的自耗时），这里用两个 32 位半字
 * 手算 64 位乘法：
 *   prime = 0x100000001b3 = 0x100·2³² + 0x1b3
 * 每一步只做 double 精度内的整数运算，最后拼回 BigInt——结果与教科书实现逐位相同。
 */
export function fnv1a64(input: string): bigint {
  const PRIME_LO = 0x1b3;
  const PRIME_HI = 0x100;
  const BASE32 = 0x100000000;
  let lo = 0x84222325;
  let hi = 0xcbf29ce4;
  for (let i = 0; i < input.length; i += 1) {
    lo = (lo ^ input.charCodeAt(i)) >>> 0;
    const loBefore = lo;
    const loProduct = loBefore * PRIME_LO;
    const carry = Math.floor(loProduct / BASE32);
    hi = (hi * PRIME_LO + loBefore * PRIME_HI + carry) % BASE32;
    lo = loProduct % BASE32;
  }
  return (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0);
}

/** FNV-1a 32 位哈希：抽样派生用，比 BigInt 版本快一个数量级。 */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** splitmix32 终结混合：把派生值与计数器打散成 32 位输出。 */
function mix32(value: number): number {
  let x = value >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return (x ^ (x >>> 15)) >>> 0;
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

export class Random {
  private readonly seed: string;
  private readonly counters: Record<string, number>;

  /**
   * @param counters 计数器表。引擎会传入  本身，
   * 让抽样直接写入存档，省掉每次推进后的整表复制（100 年约 20 万键）。
   */
  constructor(seed: string, counters: Record<string, number> = {}) {
    this.seed = seed;
    this.counters = counters;
  }

  static fromSnapshot(snapshot: RngSnapshot): Random {
    return new Random(snapshot.seed, snapshot.counters);
  }

  snapshot(): RngSnapshot {
    return { seed: this.seed, counters: { ...this.counters } };
  }

  /** 当前计数器快照（拷贝，供存档与测试使用）。 */
  countersOf(): Record<string, number> {
    return { ...this.counters };
  }

  /** 计数器表的活引用：引擎直接持有它，抽样即刻生效。 */
  counterStore(): Record<string, number> {
    return this.counters;
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
    const base = fnv1a32(`${this.seed}|${id}`);
    return mix32(base ^ Math.imul(counter + 1, 0x9e3779b9));
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
