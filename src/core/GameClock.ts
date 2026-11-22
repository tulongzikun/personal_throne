/**
 * 游戏时钟与结算点。
 *
 * 历法：1 年 = 12 月 × 30 天 = 360 天，`day` 从 1 开始。
 * 相位号见 `Phase`：0 行动、1 市场、2 组织、3 国家、4 事件、5 收尾。
 * 相位是排序约束，只有到期的结算点才真正执行（见 `settlementPoints`）。
 */

export const DAYS_PER_MONTH = 30;
export const MONTHS_PER_YEAR = 12;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR;

export type Phase = 0 | 1 | 2 | 3 | 4 | 5;

export const Phase = {
  Action: 0,
  Market: 1,
  Organization: 2,
  Country: 3,
  Event: 4,
  WrapUp: 5,
} as const satisfies Record<string, Phase>;

export const PHASE_NAMES: Record<Phase, string> = {
  0: '行动',
  1: '市场',
  2: '组织',
  3: '国家',
  4: '事件',
  5: '收尾',
};

export interface DateParts {
  readonly year: number;
  readonly month: number;
  readonly dayOfMonth: number;
}

export interface ClockState {
  day: number;
}

/** 结算点：某一天要执行的某个相位。 */
export interface SettlementPoint {
  readonly day: number;
  readonly phase: Phase;
}

/** day（1 起）→ 年月日。 */
export function toDateParts(day: number): DateParts {
  const zeroBased = Math.max(0, day - 1);
  const year = Math.floor(zeroBased / DAYS_PER_YEAR) + 1;
  const dayOfYear = zeroBased % DAYS_PER_YEAR;
  const month = Math.floor(dayOfYear / DAYS_PER_MONTH) + 1;
  const dayOfMonth = (dayOfYear % DAYS_PER_MONTH) + 1;
  return { year, month, dayOfMonth };
}

/** 年月日 → day（1 起）。 */
export function fromDateParts(year: number, month: number, dayOfMonth: number): number {
  return (year - 1) * DAYS_PER_YEAR + (month - 1) * DAYS_PER_MONTH + dayOfMonth;
}

/** 第几个月（0 起），用于「每月一次」这类按月汇总的判断。 */
export function monthIndex(day: number): number {
  return Math.floor(Math.max(0, day - 1) / DAYS_PER_MONTH);
}

export function isMonthEnd(day: number): boolean {
  return toDateParts(day).dayOfMonth === DAYS_PER_MONTH;
}

export function isQuarterEnd(day: number): boolean {
  const { month, dayOfMonth } = toDateParts(day);
  return dayOfMonth === DAYS_PER_MONTH && month % 3 === 0;
}

export function isYearEnd(day: number): boolean {
  const { month, dayOfMonth } = toDateParts(day);
  return month === MONTHS_PER_YEAR && dayOfMonth === DAYS_PER_MONTH;
}

/** 周结算落在每 7 天（第 7、14、21…天）。 */
export function isWeekEnd(day: number): boolean {
  return day % 7 === 0;
}

/** 某一天需要的全部结算点，按相位升序。 */
export function settlementPoints(day: number): SettlementPoint[] {
  const points: SettlementPoint[] = [{ day, phase: Phase.Action }];

  if (isWeekEnd(day) || isMonthEnd(day)) {
    points.push({ day, phase: Phase.Market });
  }
  if (isMonthEnd(day)) {
    points.push({ day, phase: Phase.Organization });
    points.push({ day, phase: Phase.Country });
    points.push({ day, phase: Phase.Event });
    points.push({ day, phase: Phase.WrapUp });
  }
  // 事件相位每月抽样一次；季末在收尾前额外跑一次政策压力（M3 接入）。
  return points;
}

/** 从 `day` 起（含）向后找下一个含指定相位的日子。 */
export function nextBoundary(day: number, phase: Phase): number {
  for (let probe = day; probe < day + DAYS_PER_YEAR * 2; probe += 1) {
    if (settlementPoints(probe).some((p) => p.phase === phase)) return probe;
  }
  return day;
}

/** 日历字符串，仅用于历史与 UI 展示。 */
export function formatDate(day: number): string {
  const { year, month, dayOfMonth } = toDateParts(day);
  return `${year}年${month}月${dayOfMonth}日`;
}

/**
 * 时钟：唯一的日期推进入口（铁律 5）。
 * 引擎逐日推进；外部只能通过 GameEngine.advanceTo 间接推进。
 */
export class GameClock {
  private currentDay: number;

  constructor(state: ClockState) {
    this.currentDay = Math.max(1, Math.trunc(state.day));
  }

  get day(): number {
    return this.currentDay;
  }

  get date(): DateParts {
    return toDateParts(this.currentDay);
  }

  /** 只允许引擎推进；每次 +1 天。 */
  advanceOneDay(): number {
    this.currentDay += 1;
    return this.currentDay;
  }
}
