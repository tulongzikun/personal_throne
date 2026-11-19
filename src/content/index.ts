/**
 * 内容装配：把散落的 JSON 拼成一个完整的 `WorldContent`。
 *
 * 这里是唯一允许 import JSON 的地方；core 只接收装配好的对象，
 * 从而保持"引擎不认识文件系统"的边界。
 */

import type {
  BalanceConfig,
  CountryDef,
  EventDef,
  GoodDef,
  OrganizationDef,
  WorldContent,
  WorldDef,
} from '../core/WorldState';

import balanceJson from './balance.json';
import countriesJson from './countries.json';
import goodsJson from './goods.json';
import organizationsJson from './organizations.json';
import worldJson from './world.json';
import adventureEvents from './events/adventure.json';
import countryEvents from './events/country.json';
import economyEvents from './events/economy.json';
import organizationEvents from './events/organization.json';

export const CONTENT_VERSION = '0.3.0';

function byId<T extends { id: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const events: EventDef[] = byId([
  ...organizationEvents,
  ...countryEvents,
  ...economyEvents,
  ...adventureEvents,
] as unknown as EventDef[]);

export const content: WorldContent = {
  version: CONTENT_VERSION,
  world: worldJson as unknown as WorldDef,
  countries: countriesJson as unknown as CountryDef[],
  organizations: organizationsJson as unknown as OrganizationDef[],
  goods: goodsJson as unknown as GoodDef[],
  events,
  balance: balanceJson as unknown as BalanceConfig,
};

/** 按 id 取事件定义，供 UI 与测试使用。 */
export const eventsById: ReadonlyMap<string, EventDef> = new Map(
  events.map((event) => [event.id, event]),
);
