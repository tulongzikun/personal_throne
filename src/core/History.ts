/**
 * 追加式历史：只写不改，是"世界观察"与调试回溯的唯一来源。
 * 记录直接存放在 `WorldState.history` 中，随存档序列化。
 */

import type { Phase } from './GameClock';

export type HistoryKind =
  'event' | 'finance' | 'policy' | 'command' | 'trade' | 'milestone' | 'death' | 'war';

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
  /** 叙事主体（v2）：人物/组织/国家/地区。 */
  readonly subject?: HistoryRef | null;
  /** 事发地点（v2）。 */
  readonly place?: string | null;
  /** 叙事正文（v2）：事件正文与结算结果、死亡与继位的两三句话。 */
  readonly body?: string | null;
  /** 重要度：账本类记录按月折叠成 minor，界面默认只显示 major。 */
  readonly importance?: 'major' | 'minor';
}

export interface HistoryQuery {
  readonly fromDay?: number;
  readonly toDay?: number;
  readonly kind?: HistoryKind;
  readonly entityId?: string;
  readonly limit?: number;
}

export class History {
  /** 记录 id 单调递增：折叠会删掉整段流水，若仍用 length+1 会与旧记录撞号。 */
  private nextId: number;

  constructor(private readonly records: HistoryRecord[]) {
    this.nextId = records.reduce((max, record) => Math.max(max, record.id), 0) + 1;
  }

  get size(): number {
    return this.records.length;
  }

  all(): readonly HistoryRecord[] {
    return this.records;
  }

  append(record: Omit<HistoryRecord, 'id'>): HistoryRecord {
    const next: HistoryRecord = { ...record, id: this.nextId };
    this.nextId += 1;
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

  /**
   * 账本按月折叠：把 `trade`/`finance` 流水并成一条月度记录。
   *
   * 贸易与工资是"世界的背景噪声"，一天几十条会把编年史淹掉；
   * 折叠之后编年史里剩下的才是事件、战争、更替与死亡。
   */
  compactMonth(day: number): number {
    const start = day - 29;
    // 记录按天递增：本月的流水一定在数组尾部，倒着找窗口起点即可，
    // 不用每次扫全表（100 年 × 1200 个月会扫掉上千万条）。
    let cut = this.records.length;
    while (cut > 0 && this.records[cut - 1]!.day >= start) cut -= 1;
    const window = this.records.slice(cut);
    const minor = window.filter((record) => record.kind === 'trade' || record.kind === 'finance');
    if (minor.length < 3) return 0;
    const trades = minor.filter((record) => record.kind === 'trade').length;
    const flows = minor.length - trades;
    const body = minor
      .slice(-3)
      .map((record) => record.summary.replace(/^\d+年\d+月\d+日\s*/, ''))
      .join('\n');
    const refs: HistoryRef[] = [];
    for (const record of minor) {
      for (const ref of record.refs) {
        if (!refs.some((item) => item.id === ref.id)) refs.push(ref);
      }
    }
    const removed = new Set(minor);
    const kept = window.filter((record) => !removed.has(record));
    const aggregate: HistoryRecord = {
      id: this.nextId,
      day,
      phase: minor[minor.length - 1]!.phase,
      kind: 'finance',
      summary: `本月账本：交易 ${trades} 笔、收支 ${flows} 笔`,
      refs: refs.slice(0, 12),
      causeEventId: null,
      subject: null,
      place: null,
      body,
      importance: 'minor',
    };
    this.nextId += 1;
    this.records.length = cut;
    this.records.push(...kept, aggregate);
    return minor.length;
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
