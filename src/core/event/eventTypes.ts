/* 事件窗口常量与事件流程的公共类型。 */

import type { EntityId, EventDef } from '../WorldState';

/** 默认抽样窗口（天）：月度抽样点，与 `balance.events.samplingDays` 对应。 */
export const EVENT_WINDOW_DAYS = 30;

/** 历史特征的回溯窗口（一年）。 */
export const HISTORY_WINDOW_DAYS = 360;

/** 玩家抉择的等待窗口（天），超时自动按效用择优。 */
export const CHOICE_WINDOW_DAYS = 180;

export type EventScope = EventDef['scope'];

export interface EventTarget {
  readonly scope: EventScope;
  readonly entityId: EntityId;
}

export interface Candidate {
  readonly def: EventDef;
  readonly target: EventTarget;
  readonly lambda: number;
  /** 竞速分组键；无 exclusivity 时为 null，单独判定。 */
  readonly group: string | null;
}

export interface Triggered {
  readonly def: EventDef;
  readonly target: EventTarget;
}

export interface Outcome {
  readonly def: EventDef;
  readonly target: EventTarget;
  readonly summary: string;
  readonly changes: readonly string[];
}

/* ------------------------------------------------------------------ */
/* 路径解析                                                             */
/* ------------------------------------------------------------------ */

/** 单轮抽样共享的特征缓存：价格比与历史计数都很贵，逐实体重算会变成 O(实体×事件×市场)。 */
export interface FeatureCache {
  readonly day: number;
  /** regionId → 该地区最差价格比（0–1）。 */
  readonly price: Map<string, number>;
  /** eventId → (entityId → 近一年次数)。 */
  readonly history: Map<string, Map<string, number>>;
}
