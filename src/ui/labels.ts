/** 界面展示用的中文标签表（内容 JSON 未收录的枚举在这里集中翻译）。 */

import type { HistoryKind } from '../core/History';
import type {
  AttributeKey,
  OrgLifecycle,
  OrgStrategy,
  OrgType,
  PolicyVector,
  Polity,
  Sex,
  SiteKind,
  Terrain,
} from '../core/WorldState';

export const TERRAIN_LABELS: Record<Terrain, string> = {
  city: '城市',
  plains: '平原',
  mountains: '山地',
  coast: '海岸',
  forest: '森林',
};

export const ORG_TYPE_LABELS: Record<OrgType, string> = {
  guild: '行会',
  company: '商会',
  mercenary: '佣兵团',
  noble_house: '贵族家族',
  smugglers: '走私帮',
  bank: '钱庄',
};

export const ORG_STRATEGY_LABELS: Record<OrgStrategy, string> = {
  expand: '扩张',
  steady: '稳健',
  contract: '收缩',
  pivot: '转型',
};

export const ORG_LIFECYCLE_LABELS: Record<OrgLifecycle, string> = {
  founded: '初创',
  growing: '成长',
  stable: '稳定',
  expanding: '扩张',
  crisis: '危机',
  restructuring: '重组',
  shrinking: '萎缩',
  dissolved: '解散',
};

export const POLITY_LABELS: Record<Polity, string> = {
  monarchy: '君主制',
  republic: '共和制',
};

export const POLICY_LABELS: Record<keyof PolicyVector, string> = {
  taxRate: '税率',
  tariffRate: '关税',
  militaryShare: '军费占比',
  tradeFreedom: '贸易自由',
  regulation: '管制强度',
};

export const HISTORY_KIND_LABELS: Record<HistoryKind, string> = {
  event: '事件',
  finance: '财政',
  policy: '政策',
  command: '命令',
  trade: '贸易',
  milestone: '里程碑',
  death: '死亡',
};

export const SKILL_LABELS: Record<string, string> = {
  trade: '贸易',
  negotiation: '谈判',
  persuasion: '说服',
  intimidation: '威吓',
  insight: '洞察',
  law: '律法',
  melee: '格斗',
  tactics: '战术',
  stealth: '潜行',
  appraisal: '估值',
  craft: '工艺',
};

export const TRAIT_LABELS: Record<string, string> = {
  ambition: '野心',
  authority: '威严',
  caution: '谨慎',
  charisma: '魅力',
  loyalty: '忠诚',
};

export const RACE_LABELS: Record<string, string> = {
  human: '人类',
  dwarf: '矮人',
  elf: '精灵',
};

export const ATTRIBUTE_LABELS: Record<AttributeKey, string> = {
  physique: '体魄',
  agility: '灵敏',
  intellect: '智识',
  willpower: '意志',
  perception: '感知',
  charisma: '魅力',
};

export const SITE_LABELS: Record<SiteKind, string> = {
  city: '城中',
  town: '镇上',
  village: '村落',
  road: '旅途',
  court: '宫廷',
  camp: '营地',
  sea: '海上',
};

export const SEX_LABELS: Record<Sex, string> = {
  male: '男',
  female: '女',
};

export const CLASS_LABELS: Record<string, string> = {
  merchant: '商人',
  mercenary: '佣兵',
  politician: '政治人物',
};

export function labelOf<T extends string>(
  table: Readonly<Record<T, string>>,
  key: string,
  fallback = '未知',
): string {
  return (table as Readonly<Record<string, string>>)[key] ?? fallback;
}
