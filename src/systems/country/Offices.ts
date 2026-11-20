/**
 * 国家公职：开局按"技能最高者"任命，之后随统治者更替保持有效。
 *
 * 设计要点：
 * - 一个职位只坐一个人，`holderId` 必须活着且在本国（含占领地）居住；
 * - `influence` 是该职位对政策支持度的权重（0–1），也是玩家能否下达国家命令的凭据；
 * - 公职会同时写进 `Country.offices` 与 `Character.offices` 两侧，读哪边都一致。
 */

import type {
  Character,
  CharacterId,
  CharacterOffice,
  Country,
  CountryOffice,
  WorldState,
} from '../../core/WorldState';
import { sortedIds } from '../../core/WorldState';

export interface OfficeSeat {
  readonly id: string;
  readonly title: string;
  /** 任命时优先比较的技能键。 */
  readonly skill: string;
  /** 0–1，影响政策支持度与命令权限。 */
  readonly influence: number;
  readonly salaryMonthly: number;
}

/** 政体不同，官衔不同，但权重与席位一一对应。 */
const OFFICE_SEATS: Record<'monarchy' | 'republic', readonly OfficeSeat[]> = {
  monarchy: [
    { id: 'chancellor', title: '首相', skill: 'persuasion', influence: 0.5, salaryMonthly: 140 },
    { id: 'marshal', title: '元帅', skill: 'tactics', influence: 0.45, salaryMonthly: 130 },
    { id: 'steward', title: '财务大臣', skill: 'trade', influence: 0.35, salaryMonthly: 110 },
  ],
  republic: [
    { id: 'chancellor', title: '议长', skill: 'persuasion', influence: 0.5, salaryMonthly: 140 },
    { id: 'marshal', title: '舰队司令', skill: 'tactics', influence: 0.45, salaryMonthly: 130 },
    { id: 'steward', title: '财务官', skill: 'trade', influence: 0.35, salaryMonthly: 110 },
  ],
};

export function officeSeatsFor(country: Country): readonly OfficeSeat[] {
  return OFFICE_SEATS[country.polity === 'republic' ? 'republic' : 'monarchy'];
}

/** 玩家（或任意人物）在某国的公职影响力之和，夹在 0–1。 */
export function influenceOf(
  state: WorldState,
  characterId: CharacterId,
  countryId: string,
): number {
  const country = state.countries[countryId];
  if (!country) return 0;
  let total = 0;
  for (const office of country.offices) {
    if (office.holderId === characterId) total += office.influence;
  }
  return Math.min(1, Math.max(0, total));
}

/** 拥有最高公职影响力的人物（统治者之外），用于 UI 与事件。 */
export function mostInfluential(state: WorldState, countryId: string): Character | null {
  const country = state.countries[countryId];
  if (!country) return null;
  const ranked = [...country.offices].sort(
    (a, b) => b.influence - a.influence || a.id.localeCompare(b.id),
  );
  for (const office of ranked) {
    const holder = state.characters[office.holderId];
    if (holder?.alive) return holder;
  }
  return null;
}

function residents(state: WorldState, country: Country): Character[] {
  const regionIds = new Set(country.regionIds);
  return sortedIds(state.characters)
    .map((id) => state.characters[id])
    .filter((character): character is Character => {
      if (!character || !character.alive) return false;
      return regionIds.has(character.location.regionId) || regionIds.has(character.homeRegionId);
    });
}

/**
 * 任命：技能最高者优先，平手按 id 稳定排序；统治者不兼任大臣。
 * 幂等：重复调用会先清空两侧记录再重排。
 */
export function assignOffices(state: WorldState): void {
  for (const character of Object.values(state.characters)) {
    if (character) character.offices = [];
  }

  for (const countryId of sortedIds(state.countries)) {
    const country = state.countries[countryId];
    if (!country) continue;

    country.offices = [];
    const seats = officeSeatsFor(country);
    const pool = residents(state, country).filter((character) => character.id !== country.rulerId);

    for (const seat of seats) {
      const candidates = pool
        .filter((character) => !country.offices.some((office) => office.holderId === character.id))
        .sort((a, b) => {
          const diff = (b.skills[seat.skill] ?? 0) - (a.skills[seat.skill] ?? 0);
          return diff !== 0 ? diff : a.id.localeCompare(b.id);
        });
      const holder = candidates[0];
      if (!holder) continue;

      const office: CountryOffice = {
        id: `${country.id}:${seat.id}`,
        title: seat.title,
        holderId: holder.id,
        influence: seat.influence,
        salaryMonthly: seat.salaryMonthly,
      };
      country.offices.push(office);

      const mirrored: CharacterOffice = {
        id: office.id,
        countryId: country.id,
        orgId: null,
        title: seat.title,
        rank: 1,
        salaryMonthly: seat.salaryMonthly,
        sinceDay: state.clock.day,
      };
      holder.offices.push(mirrored);
    }
  }
}

/**
 * 年度维护：只补空缺（占位者死亡/迁出），不打扰在任者。
 * 返回本次补位的说明，供历史记录使用。
 */
export function syncOffices(state: WorldState): { countryId: string; text: string }[] {
  const notes: { countryId: string; text: string }[] = [];
  for (const countryId of sortedIds(state.countries)) {
    const country = state.countries[countryId];
    if (!country) continue;
    const seats = officeSeatsFor(country);
    const pool = residents(state, country).filter((character) => character.id !== country.rulerId);

    for (const seat of seats) {
      const existing = country.offices.find((office) => office.id === `${country.id}:${seat.id}`);
      const holder = existing ? state.characters[existing.holderId] : null;
      if (existing && holder?.alive) continue;

      const candidates = pool
        .filter((character) => !country.offices.some((office) => office.holderId === character.id))
        .sort((a, b) => {
          const diff = (b.skills[seat.skill] ?? 0) - (a.skills[seat.skill] ?? 0);
          return diff !== 0 ? diff : a.id.localeCompare(b.id);
        });
      const next = candidates[0];
      if (!next) {
        if (existing) {
          country.offices = country.offices.filter((office) => office.id !== existing.id);
          notes.push({ countryId: country.id, text: `${country.name} 的${seat.title}一职空缺` });
        }
        continue;
      }

      if (existing) {
        const previous = state.characters[existing.holderId];
        if (previous) previous.offices = previous.offices.filter((o) => o.id !== existing.id);
        existing.holderId = next.id;
      } else {
        country.offices.push({
          id: `${country.id}:${seat.id}`,
          title: seat.title,
          holderId: next.id,
          influence: seat.influence,
          salaryMonthly: seat.salaryMonthly,
        });
      }
      next.offices.push({
        id: `${country.id}:${seat.id}`,
        countryId: country.id,
        orgId: null,
        title: seat.title,
        rank: 1,
        salaryMonthly: seat.salaryMonthly,
        sinceDay: state.clock.day,
      });
      notes.push({ countryId: country.id, text: `${next.name} 出任${country.name}${seat.title}` });
    }
  }
  return notes;
}

/** 某国某个职位的规范 id。 */
export function officeIdOf(countryId: string, seatId: string): string {
  return `${countryId}:${seatId}`;
}

/** 谋求公职的最低评分：低于此值连门都进不去。 */
export const OFFICE_MIN_SCORE = 0.45;

/**
 * 谋求公职的评分：专业能力为主，财力与既有影响力为辅。
 * 全部落在 0–1，便于和门槛、现任者直接比较。
 */
export function officeScore(
  state: WorldState,
  characterId: CharacterId,
  countryId: string,
  seat: OfficeSeat,
): number {
  const character = state.characters[characterId];
  if (!character) return 0;
  const skill = Math.min(20, Math.max(0, character.skills[seat.skill] ?? 0)) / 20;
  const wealth = Math.min(1, Math.max(0, character.wealth) / 20000);
  const influence = influenceOf(state, characterId, countryId);
  return Math.min(1, skill * 0.55 + wealth * 0.2 + influence * 0.25);
}

export interface OfficeApplication {
  readonly ok: boolean;
  readonly reason: string;
}

/**
 * 谋职：活着、住在本国、评分过线且不被现任者压过，才能坐上席位。
 * 成功时同时改写 `Country.offices` 与当事人 `Character.offices`。
 */
export function applyForOffice(
  state: WorldState,
  characterId: CharacterId,
  countryId: string,
  seatId: string,
): OfficeApplication {
  const country = state.countries[countryId];
  if (!country) return { ok: false, reason: '这个国家不存在' };
  const character = state.characters[characterId];
  if (!character || !character.alive) return { ok: false, reason: '你不在人世' };
  if (!residents(state, country).some((resident) => resident.id === characterId)) {
    return { ok: false, reason: `你不在${country.name}居住，谋求不了这里的官职` };
  }
  const seat = officeSeatsFor(country).find((item) => item.id === seatId);
  if (!seat) return { ok: false, reason: '这个国家没有这个职位' };

  const id = officeIdOf(country.id, seat.id);
  const office = country.offices.find((item) => item.id === id);
  if (office?.holderId === characterId) {
    return { ok: false, reason: `你已经是${seat.title}` };
  }

  const score = officeScore(state, characterId, countryId, seat);
  if (score < OFFICE_MIN_SCORE) {
    return {
      ok: false,
      reason: `你的资历还不足以出任${seat.title}（评分 ${(score * 100).toFixed(0)}，门槛 ${(OFFICE_MIN_SCORE * 100).toFixed(0)}）`,
    };
  }

  const incumbent = office ? state.characters[office.holderId] : null;
  if (office && incumbent?.alive) {
    const theirs = officeScore(state, incumbent.id, countryId, seat);
    if (theirs + 0.05 >= score) {
      return { ok: false, reason: `现任${seat.title}${incumbent.name}根基更深，暂时动不了` };
    }
    incumbent.offices = incumbent.offices.filter((item) => item.id !== id);
  }

  if (office) {
    office.holderId = characterId;
  } else {
    country.offices.push({
      id,
      title: seat.title,
      holderId: characterId,
      influence: seat.influence,
      salaryMonthly: seat.salaryMonthly,
    });
  }
  character.offices.push({
    id,
    countryId: country.id,
    orgId: null,
    title: seat.title,
    rank: 1,
    salaryMonthly: seat.salaryMonthly,
    sinceDay: state.clock.day,
  });

  return { ok: true, reason: `${character.name} 出任${country.name}${seat.title}` };
}
