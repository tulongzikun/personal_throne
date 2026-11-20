/**
 * 世界状态：**逻辑层**（工厂、校验、规范哈希），配合 `WorldTypes.ts` 的类型层。
 *
 * 拆成两个文件的原因：类型层有 76 个导出、860 行，被 66 个文件 import；
 * 而真正需要在运行时执行的只有 `createWorld` / `validateWorld` / `hashWorld`
 * 等少数函数。分开之后，`import type { WorldState }` 不再把工厂代码拖进
 * 依赖图，也更容易看出哪些模块只依赖 schema。
 *
 * 对外接口不变：本文件 re-export 全部类型与常量，调用方继续写
 * `import { createWorld, type WorldState } from '../core/WorldState'`。
 */

import { DAYS_PER_MONTH } from './GameClock';
import { fnv1a64 } from './Random';
import {
  ATTRIBUTE_KEYS,
  SCHEMA_VERSION,
  SITE_KINDS,
  type Army,
  type ArmyId,
  type Attributes,
  type Character,
  type CharacterDef,
  type CharacterId,
  type Country,
  type CountryId,
  type EntityId,
  type Family,
  type FamilyId,
  type GoodId,
  type Market,
  type MarketKey,
  type OrgId,
  type Organization,
  type Region,
  type RegionId,
  type Terrain,
  type WorldContent,
  type WorldState,
} from './WorldTypes';

export * from './WorldTypes';

/* ------------------------------------------------------------------ */
/* 工厂                                                                 */
/* ------------------------------------------------------------------ */

export interface CreateWorldOptions {
  readonly seed: string;
  /** 真实时间戳，仅写入 meta，不参与模拟。 */
  readonly createdAt?: number;
}

export function marketKeyOf(regionId: RegionId, goodId: GoodId): MarketKey {
  return `${regionId}:${goodId}`;
}

/** 六维缺省值：人类均值 10。 */
export function neutralAttributes(): Attributes {
  return { physique: 10, agility: 10, intellect: 10, willpower: 10, perception: 10, charisma: 10 };
}

function clampToRange(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * 由人物定义补齐档案字段。
 * 内容作者只写关心的字段，其余取缺省：属性 10、阵营 (0,0)、无信仰、地点 = 所属地区。
 */
export function buildCharacter(def: CharacterDef): Character {
  const regionId = def.location?.regionId ?? def.regionId;
  const attributes = neutralAttributes();
  if (def.attributes) {
    for (const key of ATTRIBUTE_KEYS) {
      const value = def.attributes[key];
      if (value !== undefined) attributes[key] = clampToRange(value, 1, 20);
    }
  }
  const alignment = def.alignment ?? { law: 0, good: 0 };
  const age = Math.max(0, Math.round(def.age));
  return {
    id: def.id,
    name: def.name,
    ...(def.culture ? { culture: def.culture } : {}),
    raceId: def.raceId,
    classId: def.classId,
    age,
    alive: true,
    regionId,
    organizationId: def.organizationId,
    wealth: Math.max(0, Math.round(def.wealth)),
    skills: { ...def.skills },
    traits: { ...def.traits },
    sex: def.sex ?? (fnv1a64(def.id) % 2n === 0n ? 'male' : 'female'),
    birthYear: -age,
    generation: def.generation ?? 1,
    familyId: def.familyId ?? null,
    parentIds: [def.parentIds?.[0] ?? null, def.parentIds?.[1] ?? null],
    spouseId: def.spouseId ?? null,
    attributes,
    alignment: {
      law: clampToRange(alignment.law, -100, 100),
      good: clampToRange(alignment.good, -100, 100),
    },
    faith: def.faithId ?? null,
    homeRegionId: regionId,
    location: {
      regionId,
      site: def.location?.site ?? 'city',
      sinceDay: def.location?.sinceDay ?? 0,
    },
    offices: def.offices ? def.offices.map((office) => ({ ...office })) : [],
    careerRank: clampToRange(Math.round(def.careerRank ?? 0), 0, 3),
    careerSinceDay: Math.max(0, Math.round(def.careerSinceDay ?? 0)),
    lastActionDay: Math.max(0, Math.round(def.lastActionDay ?? 0)),
    health: clampToRange(Math.round(def.health ?? 100), 0, 100),
    actionPoints: clampToRange(Math.round(def.actionPoints ?? 3), 0, 6),
    deposits: { ...(def.deposits ?? {}) },
  };
}

/** 地形对行市的初始扰动（±10%），只影响开局价格，之后由供需决定。 */
function terrainPriceFactor(terrain: Terrain): number {
  switch (terrain) {
    case 'mountains':
      return 1.15;
    case 'plains':
      return 0.9;
    case 'city':
      return 1.06;
    case 'coast':
      return 1.0;
    case 'forest':
      return 0.97;
  }
}

/** 由静态内容生成初始世界。纯函数：同内容 + 同种子 → 同状态。 */
export function createWorld(content: WorldContent, options: CreateWorldOptions): WorldState {
  const characters: Record<CharacterId, Character> = {};
  for (const def of content.world.characters) {
    characters[def.id] = buildCharacter(def);
  }
  const families: Record<FamilyId, Family> = {};

  const organizations: Record<OrgId, Organization> = {};
  for (const def of content.organizations) {
    organizations[def.id] = {
      id: def.id,
      name: def.name,
      type: def.type,
      industry: def.industry,
      foundedDay: def.foundedDay,
      homeRegionId: def.homeRegionId,
      origin: 'content',
      scale: def.scale,
      cash: def.cash,
      assets: def.assets,
      liabilities: def.liabilities,
      members: def.members,
      payrollMonthly: def.payrollMonthly,
      leadership: { leaderId: def.leaderId, legitimacy: def.legitimacy },
      conflict: def.conflict,
      governance: def.governance,
      efficiency: def.efficiency,
      strategy: def.strategy,
      lifecycle: def.lifecycle,
      shares: def.shares.map((share) => ({ ...share })),
      lastMonthRevenue: 0,
      lastMonthCost: 0,
      lastMonthProfit: 0,
      lastMonthTax: 0,
      lastMonthTransport: 0,
      lastMonthTariff: 0,
      lastMonthTradeRevenue: 0,
      unpaidWages: 0,
      distressMonths: 0,
      graceUntilDay: 0,
      restructureUntilDay: 0,
      marketShare: 0,
      priceIndex: 1,
      risk: { split: 0, bankruptcy: 0, corruption: 0, unrest: 0 },
      tradeInvestment: 0,
      tradeRevenue: 0,
      tradeCost: 0,
      liquidation: null,
    };
  }

  const regions: Record<RegionId, Region> = {};
  for (const def of content.world.regions) {
    regions[def.id] = {
      id: def.id,
      name: def.name,
      countryId: def.countryId,
      population: def.population,
      terrain: def.terrain,
      x: def.x,
      y: def.y,
      links: def.links.map((link) => ({ ...link })),
      occupiedBy: null,
      siegeProgress: 0,
    };
  }

  const countries: Record<CountryId, Country> = {};
  for (const def of content.countries) {
    const regionIds = content.world.regions
      .filter((region) => region.countryId === def.id)
      .map((region) => region.id);
    countries[def.id] = {
      id: def.id,
      name: def.name,
      polity: def.polity,
      regionIds,
      population: def.population,
      treasury: def.treasury,
      monthlyRevenue: def.monthlyRevenue,
      monthlyExpense: def.monthlyExpense,
      debt: def.debt,
      military: def.military,
      legitimacy: def.legitimacy,
      stability: def.stability,
      rulerId: def.rulerId,
      policies: { ...def.policies },
      diplomacy: {},
      policyCooldowns: {},
      polityPressureMonths: 0,
      lastPolityChangeDay: 0,
      cabinetAction: null,
      cabinetUtility: 0,
      succession: def.polity === 'monarchy' ? 'primogeniture' : 'elective',
      offices: [],
      atWarWith: [],
      warStartDay: 0,
      warExhaustion: 0,
      creditors: {},
    };
  }
  // 外交初始值：同政体 20，异政体 -10，自国除外。
  for (const from of Object.values(countries)) {
    for (const to of Object.values(countries)) {
      if (from.id === to.id) continue;
      from.diplomacy[to.id] = from.polity === to.polity ? 20 : -10;
    }
  }

  const markets: Record<MarketKey, Market> = {};
  const { stockMonthsTarget } = content.balance.economy;
  for (const region of Object.values(regions)) {
    for (const good of content.goods) {
      const monthlyDemand = Math.max(1, Math.round(region.population * good.consumptionPerCapita));
      markets[marketKeyOf(region.id, good.id)] = {
        regionId: region.id,
        goodId: good.id,
        stock: Math.round(monthlyDemand * stockMonthsTarget),
        production: 0,
        demand: monthlyDemand,
        // 初始行市按地形略有差异：山地缺粮贵、平原产粮便宜，给个人贩运留出第一笔价差。
        price: Math.max(1, Math.round(good.basePrice * terrainPriceFactor(region.terrain))),
        floor: Math.max(1, Math.round(good.basePrice * good.floorRatio)),
        ceiling: Math.round(good.basePrice * good.ceilingRatio),
        importCapacity: 0,
        exportCapacity: 0,
        shareByOrg: {},
        routeOwnerId: null,
        importedUnits: 0,
      };
    }
  }

  const tiers: Record<EntityId, 1 | 2 | 3> = {};
  for (const org of Object.values(organizations)) {
    tiers[org.id] = 2;
  }
  for (const country of Object.values(countries)) {
    tiers[country.id] = 2;
  }
  for (const region of Object.values(regions)) {
    tiers[region.id] = 3;
  }

  // 开局就有一支常备军：army:<countryId> 驻扎在人口最多的地区（首都）。
  const armies: Record<ArmyId, Army> = {};
  for (const country of Object.values(countries)) {
    const capital = country.regionIds
      .map((id) => regions[id])
      .filter((region): region is Region => Boolean(region))
      .sort((a, b) => b.population - a.population)[0];
    if (!capital) continue;
    armies[`army:${country.id}`] = {
      id: `army:${country.id}`,
      countryId: country.id,
      size: Math.max(
        50,
        Math.round(country.population * 0.008 * (0.5 + country.policies.militaryShare * 2)),
      ),
      locationRegionId: capital.id,
      morale: 0.6,
      training: 0.35,
      commanderId: null,
      stance: 'defend',
      targetRegionId: null,
    };
  }

  return {
    meta: {
      schemaVersion: SCHEMA_VERSION,
      contentVersion: content.version,
      seed: options.seed,
      createdAt: options.createdAt ?? 0,
      worldId: content.world.id,
    },
    clock: { day: content.world.startDay },
    playerId: content.world.playerId,
    characters,
    families,
    organizations,
    countries,
    regions,
    markets,
    contracts: {},
    shipments: {},
    relations: [],
    armies,
    tiers,
    pendingEvents: [],
    pendingChoices: [],
    inspections: {},
    rngCounters: {},
    cooldowns: {},
    history: [],
    scheduleSeq: 0,
    contractSeq: 0,
    orgSeq: 0,
    characterSeq: 0,
    stats: {
      bankruptcies: 0,
      restructurings: 0,
      splits: 0,
      mergers: 0,
      founded: 0,
      dissolved: 0,
      contractDefaults: 0,
      priceDeviationSum: 0,
      priceSamples: 0,
      tariffRevenue: 0,
      tradeRevenue: 0,
      tradeCost: 0,
      profitTotal: 0,
      dividendsPaid: 0,
      orgCountSum: 0,
      orgCountSamples: 0,
      policyProposals: 0,
      policyChanges: 0,
      policyCost: 0,
      minPolicyIntervalDays: 0,
      polityChanges: 0,
    },
  };
}

/* ------------------------------------------------------------------ */
/* 校验                                                                 */
/* ------------------------------------------------------------------ */

const MONEY_FIELDS = ['cash', 'assets', 'liabilities'] as const;

/** 返回问题清单；空数组表示通过。 */
export function validateWorld(state: WorldState): string[] {
  const problems: string[] = [];

  if (!Number.isInteger(state.meta.schemaVersion) || state.meta.schemaVersion < 1) {
    problems.push('meta.schemaVersion 非法');
  }
  if (state.meta.seed.length === 0) problems.push('meta.seed 为空');
  if (!Number.isInteger(state.clock.day) || state.clock.day < 1) {
    problems.push('clock.day 必须为 >=1 的整数');
  }
  if (!state.characters[state.playerId]) {
    problems.push(`playerId 指向不存在的人物 ${state.playerId}`);
  }

  for (const [key, character] of Object.entries(state.characters)) {
    if (key !== character.id) problems.push(`人物键 ${key} 与 id ${character.id} 不一致`);
    if (!state.regions[character.regionId]) {
      problems.push(`人物 ${character.id} 的地区 ${character.regionId} 不存在`);
    }
    if (character.organizationId !== null && !state.organizations[character.organizationId]) {
      problems.push(`人物 ${character.id} 的组织 ${character.organizationId} 不存在`);
    }
    if (character.wealth < 0) problems.push(`人物 ${character.id} 财富为负`);
    if (
      !Number.isInteger(character.careerRank) ||
      character.careerRank < 0 ||
      character.careerRank > 3
    ) {
      problems.push(`人物 ${character.id} 的生涯等级越界`);
    }
    if (!Number.isFinite(character.health) || character.health < 0 || character.health > 100) {
      problems.push(`人物 ${character.id} 的健康值越界`);
    }
    if (
      !Number.isInteger(character.actionPoints) ||
      character.actionPoints < 0 ||
      character.actionPoints > 6
    ) {
      problems.push(`人物 ${character.id} 的行动力越界`);
    }
    if (!Number.isFinite(character.lastActionDay) || character.lastActionDay < 0) {
      problems.push(`人物 ${character.id} 的最近行动日越界`);
    }
    for (const key of ATTRIBUTE_KEYS) {
      const value = character.attributes?.[key];
      if (!Number.isInteger(value) || value < 1 || value > 20) {
        problems.push(`人物 ${character.id} 的属性 ${key} 越界`);
      }
    }
    if (!SITE_KINDS.includes(character.location.site)) {
      problems.push(`人物 ${character.id} 的地点类型 ${String(character.location.site)} 非法`);
    }
    if (!state.regions[character.location.regionId]) {
      problems.push(`人物 ${character.id} 的地点地区 ${character.location.regionId} 不存在`);
    }
    if (!state.regions[character.homeRegionId]) {
      problems.push(`人物 ${character.id} 的故乡 ${character.homeRegionId} 不存在`);
    }
    if (Math.abs(character.alignment.law) > 100 || Math.abs(character.alignment.good) > 100) {
      problems.push(`人物 ${character.id} 的阵营越界`);
    }
    if (character.faith !== null && typeof character.faith !== 'string') {
      problems.push(`人物 ${character.id} 的信仰不是字符串或 null`);
    }
    if (character.spouseId !== null && !state.characters[character.spouseId]) {
      problems.push(`人物 ${character.id} 的配偶 ${character.spouseId} 不存在`);
    }
    for (const parentId of character.parentIds) {
      if (parentId !== null && !state.characters[parentId]) {
        problems.push(`人物 ${character.id} 的亲属 ${parentId} 不存在`);
      }
    }
    if (character.familyId !== null && !state.families?.[character.familyId]) {
      problems.push(`人物 ${character.id} 的家族 ${character.familyId} 不存在`);
    }
  }

  for (const [key, family] of Object.entries(state.families ?? {})) {
    if (key !== family.id) problems.push(`家族键 ${key} 与 id ${family.id} 不一致`);
    for (const memberId of family.memberIds) {
      if (!state.characters[memberId]) problems.push(`家族 ${family.id} 的成员 ${memberId} 不存在`);
    }
  }

  for (const [key, org] of Object.entries(state.organizations)) {
    if (key !== org.id) problems.push(`组织键 ${key} 与 id ${org.id} 不一致`);
    if (!state.regions[org.homeRegionId]) {
      problems.push(`组织 ${org.id} 的母地区 ${org.homeRegionId} 不存在`);
    }
    if (!state.characters[org.leadership.leaderId]) {
      problems.push(`组织 ${org.id} 的领袖 ${org.leadership.leaderId} 不存在`);
    }
    for (const field of MONEY_FIELDS) {
      if (org[field] < 0) problems.push(`组织 ${org.id} 的 ${field} 为负`);
    }
    for (const share of org.shares) {
      if (!state.characters[share.characterId]) {
        problems.push(`组织 ${org.id} 的股东 ${share.characterId} 不存在`);
      }
    }
  }

  for (const [key, country] of Object.entries(state.countries)) {
    if (key !== country.id) problems.push(`国家键 ${key} 与 id ${country.id} 不一致`);
    if (!state.characters[country.rulerId]) {
      problems.push(`国家 ${country.id} 的统治者在人物表中不存在`);
    } else if (!state.characters[country.rulerId]?.alive) {
      problems.push(`国家 ${country.id} 的统治者已死亡（不允许无主国家）`);
    }
    for (const regionId of country.regionIds) {
      if (!state.regions[regionId]) problems.push(`国家 ${country.id} 的地区 ${regionId} 不存在`);
    }
    if (country.treasury < 0) problems.push(`国家 ${country.id} 国库为负`);
    if (country.debt < 0) problems.push(`国家 ${country.id} 债务为负`);
  }

  for (const [key, market] of Object.entries(state.markets)) {
    if (key !== marketKeyOf(market.regionId, market.goodId)) {
      problems.push(`市场键 ${key} 与 ${market.regionId}:${market.goodId} 不一致`);
    }
    if (!state.regions[market.regionId]) {
      problems.push(`市场 ${key} 的地区不存在`);
    }
    if (market.price < 0 || market.stock < 0) problems.push(`市场 ${key} 价格或库存为负`);
    if (market.importedUnits < 0) problems.push(`市场 ${key} 进口量为负`);
  }

  for (const [key, region] of Object.entries(state.regions)) {
    if (key !== region.id) problems.push(`地区键 ${key} 与 id ${region.id} 不一致`);
    if (!state.countries[region.countryId]) {
      problems.push(`地区 ${region.id} 的国家 ${region.countryId} 不存在`);
    }
    for (const link of region.links) {
      if (!state.regions[link.to]) problems.push(`地区 ${region.id} 的商路指向 ${link.to} 不存在`);
    }
  }

  for (const scheduled of state.pendingEvents) {
    if (!Number.isInteger(scheduled.day) || scheduled.day < 1) {
      problems.push(`待办事件 ${scheduled.refId} 的日期非法`);
    }
  }

  for (const [key, contract] of Object.entries(state.contracts)) {
    if (key !== contract.id) problems.push(`契约键 ${key} 与 id ${contract.id} 不一致`);
    if (!state.organizations[contract.fromOrgId]) {
      problems.push(`契约 ${key} 的义务方 ${contract.fromOrgId} 不存在`);
    }
    if (contract.kind === 'employment') {
      if (!state.characters[contract.toOrgId]) {
        problems.push(`雇佣契约 ${key} 的雇员 ${contract.toOrgId} 不存在`);
      }
    } else if (!state.organizations[contract.toOrgId]) {
      problems.push(`契约 ${key} 的权利方 ${contract.toOrgId} 不存在`);
    }
    if (contract.endDay < contract.startDay) problems.push(`契约 ${key} 的到期日早于起始日`);
    if (contract.value < 0 || contract.principal < 0 || contract.collateral < 0) {
      problems.push(`契约 ${key} 的金额为负`);
    }
  }

  for (const [key, shipment] of Object.entries(state.shipments)) {
    if (key !== shipment.id) problems.push(`货运键 ${key} 与 id ${shipment.id} 不一致`);
    if (!state.regions[shipment.fromRegionId] || !state.regions[shipment.toRegionId]) {
      problems.push(`货运 ${key} 的地区不存在`);
    }
    if (!state.markets[marketKeyOf(shipment.toRegionId, shipment.goodId)]) {
      problems.push(`货运 ${key} 的目的地没有该商品市场`);
    }
    if (shipment.units < 0 || shipment.lost < 0) problems.push(`货运 ${key} 的数量为负`);
    if (shipment.arriveDay < shipment.departDay) problems.push(`货运 ${key} 的抵达日早于离港日`);
    if (shipment.ownerOrgId !== null && !state.organizations[shipment.ownerOrgId]) {
      problems.push(`货运 ${key} 的所有者 ${shipment.ownerOrgId} 不存在`);
    }
  }

  const scheduleKeys = new Set<string>();
  for (const scheduled of state.pendingEvents) {
    const id = `${scheduled.day}:${scheduled.phase}:${scheduled.seq}`;
    if (scheduleKeys.has(id)) problems.push(`待办队列存在重复排序键 ${id}`);
    scheduleKeys.add(id);
  }

  return problems;
}

/* ------------------------------------------------------------------ */
/* 规范化哈希                                                           */
/* ------------------------------------------------------------------ */

/** 稳定序列化：对象键排序，数组保持顺序。 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const body = entries
    .filter(([, item]) => item !== undefined)
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(',');
  return `{${body}}`;
}

/** 状态哈希：确定性回归（R1、R2）与回放校验的基础。 */
export function hashWorld(state: WorldState): string {
  return fnv1a64(stableStringify(state)).toString(16).padStart(16, '0');
}

/** 稳定 ID 顺序：禁止依赖对象插入顺序（铁律 4）。 */
export function sortedIds<T>(record: Record<string, T>): string[] {
  return Object.keys(record).sort();
}

/** 深拷贝，用于事务回滚。 */
export function cloneWorld(state: WorldState): WorldState {
  return structuredClone(state);
}

/** 月度键，如 `m0042`（第 42 个月）。 */
export function monthKeyOf(day: number): string {
  const month = Math.floor((day - 1) / DAYS_PER_MONTH) + 1;
  return `m${String(month).padStart(4, '0')}`;
}
