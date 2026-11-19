/**
 * 追加式历史：只写不改，是"世界观察"与调试回溯的唯一来源。
 * 记录直接存放在 `WorldState.history` 中，随存档序列化。
 */

import type { Phase } from './GameClock';

export type HistoryKind =
  'event' | 'finance' | 'policy' | 'command' | 'trade' | 'milestone' | 'death';

export interface HistoryRef {
  readonly type: string;
  readonly id: string;
}

export interface HistoryRecord {
  readonly id: number;
  readonly day: number;
  readonly phase: Phase;
  readonly kind: HistoryKind;
  readonly summary: string;
  readonly refs: HistoryRef[];
  /** 由哪个事件引发；命令或系统自发的记录为 null。 */
  readonly causeEventId: string | null;
}

export interface HistoryQuery {
  readonly fromDay?: number;
  readonly toDay?: number;
  readonly kind?: HistoryKind;
  readonly entityId?: string;
  readonly limit?: number;
}

export class History {
  constructor(private readonly records: HistoryRecord[]) {}

  get size(): number {
    return this.records.length;
  }

  all(): readonly HistoryRecord[] {
    return this.records;
  }

  append(record: Omit<HistoryRecord, 'id'>): HistoryRecord {
    const next: HistoryRecord = { ...record, id: this.records.length + 1 };
    this.records.push(next);
    return next;
  }

  query(options: HistoryQuery = {}): HistoryRecord[] {
    const { fromDay, toDay, kind, entityId, limit } = options;
    const matched = this.records.filter((record) => {
      if (fromDay !== undefined && record.day < fromDay) return false;
      if (toDay !== undefined && record.day > toDay) return false;
      if (kind !== undefined && record.kind !== kind) return false;
      if (entityId !== undefined && !record.refs.some((ref) => ref.id === entityId)) return false;
      return true;
    });
    return limit === undefined ? matched : matched.slice(-limit);
  }

  latest(limit = 20): HistoryRecord[] {
    return this.records.slice(-limit);
  }

  /** 月度摘要：按类别计数 + 关键条目，供 UI 与年表使用。 */
  monthlySummary(day: number): {
    total: number;
    byKind: Partial<Record<HistoryKind, number>>;
    highlights: HistoryRecord[];
  } {
    const start = day - 29;
    const monthRecords = this.query({ fromDay: start, toDay: day });
    const byKind: Partial<Record<HistoryKind, number>> = {};
    for (const record of monthRecords) {
      byKind[record.kind] = (byKind[record.kind] ?? 0) + 1;
    }
    const highlights = monthRecords.filter((record) => record.kind !== 'finance').slice(-5);
    return { total: monthRecords.length, byKind, highlights };
  }
}
