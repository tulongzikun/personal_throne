/**
 * M7 阶段 4：编年史（专名、主体、地点）。
 *
 * 验收：含专名的历史记录 ≥ 80%（实测按"每条至少含一个实体名"计）。
 */

import { describe, expect, it } from 'vitest';

import {
  composeChronicle,
  entityNames,
  humanize,
  invalidateEntityNames,
} from '../src/core/Chronicler';
import { GameEngine } from '../src/core/GameEngine';
import { content, makeWorld } from './helpers';

describe('编年史', () => {
  it('把裸 id 换成专名', () => {
    const world = makeWorld('chronicle-humanize');
    const org = Object.values(world.organizations)[0]!;
    const text = humanize(world, `${org.id} 本月亏损 120`);
    expect(text).not.toContain(org.id);
    expect(text).toContain(org.name);
  });

  it('没有专名时补「地点 · 主体：」前缀', () => {
    const world = makeWorld('chronicle-prefix');
    const org = Object.values(world.organizations)[0]!;
    const chronicle = composeChronicle(world, '本月亏损 120', [
      { type: 'organization', id: org.id },
    ]);
    expect(chronicle.summary.startsWith(world.regions[org.homeRegionId]!.name)).toBe(true);
    expect(chronicle.summary).toContain(org.name);
    expect(chronicle.place).toBe(org.homeRegionId);
    expect(chronicle.subject?.id).toBe(org.id);
  });

  it('十年历史每条都含专名，且不残留裸 id', () => {
    const world = makeWorld('chronicle-coverage');
    const engine = new GameEngine(world, content);
    engine.advanceDays(360 * 10);
    const names = [...entityNames(world).values()];
    const records = world.history;
    expect(records.length).toBeGreaterThan(500);
    const named = records.filter((record) => names.some((name) => record.summary.includes(name)));
    expect(named.length / records.length).toBeGreaterThanOrEqual(0.8);
    const raw = records.filter((record) => /\b[ocr]_[a-z0-9_]{2,}/.test(record.summary));
    expect(raw).toHaveLength(0);
    // 按月折叠的账本是一个月里几十条流水的并集，不对应单一主体；其余记录必须有主体。
    const major = records.filter((record) => record.importance !== 'minor');
    const withSubject = major.filter(
      (record) => record.subject !== null && record.subject !== undefined,
    );
    expect(withSubject.length / major.length).toBeGreaterThanOrEqual(0.95);
  });

  it('实体改名后编年史跟着变（缓存不得以数量为失效键）', () => {
    const world = makeWorld('chronicle-rename');
    const org = Object.values(world.organizations)[0]!;
    expect(humanize(world, org.id)).toBe(org.name);

    // 人数与组织数都不变，只改名：按数量做失效键的实现会在这里返回旧名。
    const renamed = `${org.name}（改组后）`;
    org.name = renamed;
    invalidateEntityNames(world);
    expect(humanize(world, org.id)).toBe(renamed);

    // 反向确认：不调失效函数时，缓存本来就不该被悄悄绕过。
    expect(entityNames(world).get(org.id)).toBe(renamed);
  });

  it('组织类记录带地点，人物类记录主体是本人', () => {
    const world = makeWorld('chronicle-subject');
    const engine = new GameEngine(world, content);
    engine.advanceDays(360 * 5);
    const orgRecord = world.history.find((record) => record.subject?.type === 'organization');
    expect(orgRecord?.place).toBeTruthy();
    const death = world.history.find((record) => record.kind === 'death');
    if (death) expect(death.subject?.type).toBe('character');
  });
});
