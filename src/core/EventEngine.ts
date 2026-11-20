/**
 * 概率事件引擎：条件编译 → 风险强度 → 互斥竞速 → 效果结算。
 *
 * 模型（GDD §11 / 计划 §7.2）：
 *   λ(entity, event) = λ₀ · exp(Σ βᵢ·Xᵢ)
 *   P(Δt)            = 1 − e^(−λ·Δt)
 * 同一实体的同一互斥组（`exclusivity`）内用**指数竞速**只选一个赢家：
 *   tᵢ ~ Exp(λᵢ)，min(tᵢ) 对应的事件发生。
 * 这样两组事件不会在同一次抽样里同时发生，同时每个事件边际概率仍等于 1−e^(−λᵢΔt)。
 *
 * 随机数全部走命名流：`event:<entityId>:<periodKey>:<eventId>`，与遍历顺序无关。
 */

export { EVENT_WINDOW_DAYS, HISTORY_WINDOW_DAYS, CHOICE_WINDOW_DAYS } from './event/eventTypes';
export type {
  EventScope,
  EventTarget,
  Candidate,
  Triggered,
  Outcome,
  FeatureCache,
} from './event/eventTypes';
export { readNumber, writeNumber } from './event/eventPaths';
export { createFeatureCache, readFeature } from './event/eventFeatures';
export {
  evaluate,
  entitiesOfScope,
  targetRegionOf,
  targetCountryOf,
  matchesWhen,
  collectCandidates,
  selectTriggered,
} from './event/eventConditions';
export {
  eventText,
  eventTextForRefs,
  labelOf,
  applyBaseEffects,
  scheduleFollowUps,
  applyEvent,
  resolveChoice,
} from './event/eventEffects';
export { choiceUtility, pickChoice } from './event/eventChoices';
