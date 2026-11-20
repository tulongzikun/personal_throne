/* 信号收集：把历史记录与已排定事件翻译成要弹给玩家的「世界信号」。 */

import { formatDate } from '../../core/GameClock';
import { eventText, eventTextForRefs } from '../../core/EventEngine';
import type { WorldContent, WorldState } from '../../core/WorldState';
import { regionNews } from '../../systems/region/RegionNews';
import type { WorldSignal } from '../EventDialog';
import { isRelated, relationOf, RELATION_LABELS, subjectOf } from '../signals';
import { signalKey } from './appTypes';

/** 记住上一轮已经播报到哪儿，避免同一件事重复弹。 */
export interface SignalTracker {
  lastHistoryId: number;
  seenPending: Set<string>;
}

export function newSignalTracker(state: WorldState): SignalTracker {
  return {
    lastHistoryId: state.history.at(-1)?.id ?? 0,
    seenPending: new Set(state.pendingEvents.map(signalKey)),
  };
}

/** 把 scope + id 换成展示名（地区/人物/组织/国家）。 */
export function entityLabel(
  state: WorldState,
  scope: string | null,
  entityId: string | null,
): string {
  if (!entityId) return '未知对象';
  switch (scope) {
    case 'character':
      return state.characters[entityId]?.name ?? entityId;
    case 'organization':
      return state.organizations[entityId]?.name ?? entityId;
    case 'country':
      return state.countries[entityId]?.name ?? entityId;
    case 'region':
      return state.regions[entityId]?.name ?? entityId;
    default:
      return entityId;
  }
}

export interface SignalContext {
  readonly state: WorldState;
  readonly content: WorldContent;
  readonly tracker: SignalTracker;
}

/**
 * 收集本轮新出现的信号：与玩家有关的历史事件、已排定的「预兆」，
 * 以及汇总成一条的远方见闻。会推进 `tracker`。
 */
export function collectSignals(context: SignalContext): WorldSignal[] {
  const { state, content, tracker } = context;
  const related: WorldSignal[] = [];

  for (const record of state.history) {
    if (record.id <= tracker.lastHistoryId || record.kind !== 'event') continue;
    const def = record.causeEventId
      ? content.events.find((event) => event.id === record.causeEventId)
      : undefined;
    const subject = subjectOf(state, record);
    const relation = relationOf(state, record);
    const filled = def ? eventTextForRefs(state, def, record.refs) : undefined;
    const title = filled?.title ?? '世界事件';
    const text = filled?.body ?? record.summary;

    if (!isRelated(relation)) continue;
    related.push({
      title,
      body: text,
      meta: formatDate(record.day),
      tone: 'event',
      relation: RELATION_LABELS[relation],
      ...(subject ? { subject: subject.label } : {}),
    });
  }
  const latest = state.history.at(-1);
  if (latest) tracker.lastHistoryId = Math.max(tracker.lastHistoryId, latest.id);

  for (const scheduled of state.pendingEvents) {
    if (scheduled.kind !== 'event') continue;
    const key = signalKey(scheduled);
    if (tracker.seenPending.has(key)) continue;
    tracker.seenPending.add(key);
    if (scheduled.day <= state.clock.day) continue;
    const def = content.events.find((event) => event.id === scheduled.refId);
    const omenTitle =
      def && scheduled.targetScope && scheduled.targetEntityId
        ? eventText(state, def, {
            scope: scheduled.targetScope,
            entityId: scheduled.targetEntityId,
          }).title
        : (def?.text.title ?? '未明之事');
    related.push({
      title: `预兆 · ${omenTitle}`,
      body: `风声正在流传：这件事预计在 ${formatDate(scheduled.day)} 前后见分晓，没有人知道它会以何种面目到来。`,
      meta: `待办 ${formatDate(scheduled.day)} · ${entityLabel(state, scheduled.targetScope, scheduled.targetEntityId)}`,
      tone: 'omen',
      relation: '与你或你身边的人有关',
    });
  }

  // 远方见闻只挑要紧的地区局势说，不再逐条转述陌生人的遭遇。
  const news = regionNews(state, 3);
  if (news.length > 0) {
    related.push({
      title: `${news.length} 条远方见闻`,
      body: '只挑要紧的说；传闻会变，亲自去一趟看到的情况才算数。',
      meta: `${formatDate(state.clock.day)} · 世界在别处继续`,
      tone: 'digest',
      items: news.map((item) => ({
        title: item.title,
        subject: entityLabel(state, 'region', item.regionId),
        body: item.body,
      })),
    });
  }
  return related;
}
