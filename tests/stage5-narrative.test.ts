import { describe, expect, it } from 'vitest';
import { History } from '../src/core/History';
import type { Phase } from '../src/core/GameClock';
import { content, makeEngine } from './helpers/index';

function record(history: History, day: number, kind: 'trade' | 'finance', summary: string): void {
  history.append({
    day,
    phase: 4 as Phase,
    kind,
    summary,
    refs: [],
    causeEventId: null,
  });
}

describe('阶段 5：叙事', () => {
  it('账本按月折叠：一个月的交易与收支并成一条记录', () => {
    const history = new History([]);
    for (let day = 1; day <= 30; day += 1) {
      record(history, day, 'trade', `第 ${day} 天 卖出粮 12 桶`);
      record(history, day, 'finance', `第 ${day} 天 工资 8 人`);
    }
    expect(history.size).toBe(60);
    const removed = history.compactMonth(30);
    expect(removed).toBe(60);
    expect(history.size).toBe(1);
    const [aggregate] = history.all();
    expect(aggregate!.kind).toBe('finance');
    expect(aggregate!.importance).toBe('minor');
    expect(aggregate!.summary).toContain('本月账本');
    expect(aggregate!.summary).toContain('交易 30 笔');
    expect(aggregate!.body).toContain('卖出粮');
  });

  it('事件正文与结算结果写进历史 body，且不带裸占位符', () => {
    const engine = makeEngine('body');
    const def = content.events.find((event) => event.text.body.length > 10)!;
    engine.applyTrigger(def, { scope: 'character', entityId: engine.state.playerId }, 30);
    const last = engine.state.history.at(-1)!;
    expect(last.kind).toBe('event');
    expect(last.body).toBeTruthy();
    expect(last.body).not.toMatch(/\{(place|country|subject)\}/);
  });

  it('死亡写出两三句话：享年、身份、遗产', () => {
    const engine = makeEngine('death-narrative');
    engine.advanceDays(360 * 20);
    const deaths = engine.state.history.filter((item) => item.kind === 'death');
    expect(deaths.length).toBeGreaterThan(0);
    const withBody = deaths.filter((item) => (item.body ?? '').includes('享年'));
    expect(withBody.length).toBeGreaterThan(0);
    expect(withBody[0]!.body).toContain('铜');
  });

  it('继位写出谁接了谁、凭什么、局面如何', () => {
    const engine = makeEngine('succession-narrative');
    engine.advanceDays(360 * 40);
    const changes = engine.state.history.filter(
      (item) =>
        item.kind === 'milestone' &&
        (item.summary.includes('继位') || item.summary.includes('更替')),
    );
    expect(changes.length).toBeGreaterThan(0);
    const narrated = changes.find((item) => (item.body ?? '').includes('接掌'));
    expect(narrated).toBeTruthy();
    expect(narrated!.body).toMatch(/稳定度 \d+%/);
  });

  it('验收：大事占比 ≥25%、最高同款模版 ≤40%、玩家主动参与时玩家相关 ≥5%', () => {
    const engine = makeEngine('metrics');
    const state = engine.state;
    for (let day = 0; day < 360 * 12; day += 1) {
      engine.advanceDays(1);
      if (day % 30 === 3) engine.dispatch({ kind: 'train', skill: 'trade' });
    }
    const records = state.history;
    const majorKinds = new Set(['event', 'milestone', 'war', 'death']);
    const major = records.filter((item) => majorKinds.has(item.kind)).length;
    expect(major / records.length).toBeGreaterThanOrEqual(0.25);

    const templates = new Map<string, number>();
    for (const item of records) {
      const key = item.summary
        .replace(/^\d+年\d+月\d+日\s*/, '')
        .replace(/[\d,]+/g, '#')
        .replace(/[\u4e00-\u9fa5]{2,4}(?=（|去世|继位|出生|晋升|降为)/g, 'NAME');
      templates.set(key, (templates.get(key) ?? 0) + 1);
    }
    const top = Math.max(...templates.values());
    expect(top / records.length).toBeLessThanOrEqual(0.4);

    const player = state.playerId;
    const mine = new Set([player]);
    const me = state.characters[player]!;
    if (me.organizationId) mine.add(me.organizationId);
    if (me.familyId) mine.add(me.familyId);
    const related = records.filter((item) => item.refs.some((ref) => mine.has(ref.id))).length;
    expect(related / records.length).toBeGreaterThanOrEqual(0.05);
  });
});
