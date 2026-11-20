/* ID 别名、属性键、站点、阵营与家族等最底层词汇。 */

export type CharacterId = string;

export type OrgId = string;

export type CountryId = string;

export type RegionId = string;

export type GoodId = string;

export type MarketKey = string;

export type ContractId = string;

export type ArmyId = string;

export type EntityId = string;

export const SCHEMA_VERSION = 9;

/* ------------------------------------------------------------------ */
/* 人物档案（schema，M4）                                               */
/* ------------------------------------------------------------------ */

/** 六维属性：1–20 整数，人类均值 10。 */
export const ATTRIBUTE_KEYS = [
  'physique',
  'agility',
  'intellect',
  'willpower',
  'perception',
  'charisma',
] as const;

export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];

export type Attributes = Record<AttributeKey, number>;

/** 人物所在地点的粒度（M5 再细化到城区）。 */
export const SITE_KINDS = ['city', 'town', 'village', 'road', 'court', 'camp', 'sea'] as const;

export type SiteKind = (typeof SITE_KINDS)[number];

/** 阵营双轴：`law` 守序(+)↔混乱(−)，`good` 善良(+)↔邪恶(−)，各 −100..100。 */
export interface Alignment {
  law: number;
  good: number;
}

export type FamilyId = string;

/** 家族：只承载姓氏与文化，继承判定走 `parentIds`/`spouseId`。 */
export interface Family {
  id: FamilyId;
  name: string;
  culture: string;
  memberIds: CharacterId[];
  /** 家族声望：在世成员的公职与领袖位每年折算，满 100 封顶。 */
  prestige?: number;
}
