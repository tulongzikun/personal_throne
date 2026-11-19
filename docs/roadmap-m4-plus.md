# 《王座与黄金》M4 及以后迭代路线

**版本** v1.1 · 2026-11-19（增补 §0.1 决策记录与 §2.0.1 人物档案）
**代码基线** `main` @ `f814d67`（M2 完成、薄 UI 可用）+ M3 进行中
**依据** `design.md`（GDD v1.0，2,106 行）、`development-plan.md`（v0.2，876 行）、`src/` 现状只读核对
**性质** 设计与排期文档；不含代码改动，不构成提交

> **估算口径**：1 人日 = 6 小时有效产出（含自测与文档），1 自然周 = 5 人日。
> 人力 = 1 名开发者 + AI 结对（沿用 `development-plan.md §8` 假设）。所有工期不含评审等待与外部依赖。
> 当前产物实测 `release/index.html` = 146,534 字节，占 1,572,864 字节预算的 9.3%。

## 0. 结论摘要

1. **M4 的真实成本是 36 人日（7 周），不是开发计划里的 15 人日。** 开发计划 §8 的 M4 清单只覆盖"成长 + 死亡 + 6 条冒险事件"，没有覆盖已经确认的三个缺口：世代更替、事件链、抉择。本文件把 M4 拆成 6 个子迭代重新计价。
2. **世代更替的难点不在出生率，而在继承与一致性。** 当前 `handleDeath()` 把股份永久留在死者名下（`src/systems/character/CharacterSystem.ts:7` 注释已承认"股份仍记在死者名下（遗产）"），组织迟早变成"死人控股"。M4.1 必须先补 `treasuryShares` 与遗产分配，再谈出生率，否则 100 年后组织会集体僵死。
3. **抉择不引入剧本引擎。** 用 `EventDef.choices?: ChoiceDef[]` + 一条 `choose` 命令即可，文本用占位符模板，不做变量、不做 goto、不做分支图。这是 M4 里最容易被过度设计的地方，明确写死边界。
4. **M5 的瓶颈不是 1.5 MiB 包体。** 按当前 16 B/行的产物密度外推，M6 结束约 400 KB（25.4%），预算有 3 倍余量。真正的瓶颈是 100 年模拟的月结热路径与"指标不可读"，以及 `file://` 下 IndexedDB 可能不可用导致的存档丢失。
5. **M6 会让 100 年模拟超出 2 s 预算约 2 倍。** 5 区 20 市场扩到 14 区 56 市场，月结市场循环从 200 次内层迭代涨到约 2,500 次。必须先给 L3 国家做聚合结算，或显式修订预算为"5 区 < 2 s、14 区 < 3 s"。这是必须在 M6 立项时拍板的账——**D3 已拍板：先做 L3 聚合，再分档为「5 区 < 2 s、14 区 < 3 s」**。
6. **当前最该先修的三个技术债**：`WorldState.history` 无上限（100 年预估 8k–20k 条）、`GameEngine` 没有事务回滚（系统抛错会留下半更新状态）、`SCHEMA_VERSION` 只有 v1→v2 一条真实迁移且没有旧档夹具。这三项都会在 M4 变成阻塞。

---

### 0.1 决策记录

| # | 决策 | 日期 | 落点 |
|---|---|---|---|
| D1 | M4 重新计价 **15 → 36 人日**（含人物档案增补 +6） | 2026-11-19 | §1.2、§2.1–§2.6 |
| D2 | 抉择默认不中断：`stopAtChoices: false`，批量模拟不受影响 | 2026-11-19 | §2.5 |
| D3 | M6 先做 L3 国家聚合（+4 人日并入 M6.1），预算分档「5 区 < 2 s / 14 区 < 3 s」 | 2026-11-19 | §3.2、§4.1 |
| D4 | 人物档案增补：六维 1–20、阵营九宫格（双轴动态）、`location.site`、`faith` 可为 `null` | 2026-11-19 | §2.0.1、§2.1、§2.2、§3.1、§6.1 |

## 1. 总览与时间轴

### 1.1 版本阶梯

| 版本 | 里程碑 | 含义 | 可对外 |
|---|---|---|---|
| 0.4.0 | M4 完成 | 角色有生涯、世界有世代、事件有因果 | 内部可玩 |
| 0.9.0 | M5 完成 | MVP 内容冻结：完整 UI、校准过的数值、可发布单文件 | 抢先体验 / 公开发布 |
| 1.0.0 | M6 完成 | 战争闭环、七国、魔法经济 | 正式版 |

> **为什么 M6 在 1.0 里、又被称为 post-MVP**：`development-plan.md §2.2` 把 MVP 冻结在 M0–M5（16 周承诺），M6 不属于该承诺；但 GDD 的四根支柱里"持续变化的策略空间"和"个人故事与世界因果"都要求战争与多国，所以 1.0 必须包含 M6。**MVP 是验证，1.0 是产品。**

### 1.2 三个里程碑的目标与退出标准

| 里程碑 | 周期 | 人日 | 目标 | 退出标准（可判定） |
|---|---|---:|---|---|
| **M4 角色与叙事** | W1–W7（7 周） | 36 | 百年之后世界仍有人；玩家有一条可走完的生涯；事件能追到原因；玩家能在事件里做选择 | §2.1–§2.6 的 A1–A6/B1–B5/C1–C4/D1–D5/E1–E6 全绿；100 年 `存活人物 ≥ 40`、`代数 ≥ 3`；一条脚本化路径走完"商人→商会会长→市议员"；`audit:content` 0 错误 |
| **M5 整合与校准** | W8–W13（6 周） | 24 + 3 缓冲 | 完整 UI（城市视图 / 四图层 / 教程 / 无障碍 / 移动端）、100 种子批量校准、发布检查 | 验收 A（含人工审阅）通过；`batch:sim` 指标落入目标带；100 年 < 2 s；p95 帧 < 16 ms；包体 ≤ 1.5 MiB；兼容矩阵全绿 |
| **M6 战争与世界扩展** | W14–W21（8 周） | 36 + 3 缓冲 | 动员→行军→会战→和约的最小闭环；七国；魔法商品与法师组织 | 战争 1/15–25 年；每战 2–6 场会战；14 区 100 年 < 3 s；七国制度差异在政策/外交上可观测 |

### 1.3 甘特式排期（W1 = M4 启动周）

| 阶段 | 子迭代 | 人日 | 周次 |
|---|---|---:|---|
| M4 | M4.1 人口与世代（含档案迁移） | 7 | W1–W1.5 |
| M4 | M4.2 生涯与开局人物创建 | 9 | W2–W3.5 |
| M4 | M4.3 关系与记忆 | 4 | W3.5–W4.5 |
| M4 | M4.4 事件链与因果 | 5 | W4.5–W5.5 |
| M4 | M4.5 对话与抉择 | 7 | W5.5–W6.5 |
| M4 | M4.6 存档 v3 / 内容审计 / 验收 | 4 | W6.5–W7.5 |
| M5 | M5.1 完整 UI（含六维雷达、九宫格） | 8 | W8–W9.5 |
| M5 | M5.2 教程 / 无障碍 / 移动端 | 5 | W9.5–W10.5 |
| M5 | M5.3 批量模拟与校准 | 6 | W10.5–W12 |
| M5 | M5.4 性能 / 兼容 / 发布 | 5 | W12–W13 |
| M6 | M6.1 战争闭环 + L3 国家聚合 | 14 | W14–W17 |
| M6 | M6.2 七国与外交 | 8 | W17–W18.5 |
| M6 | M6.3 魔法经济 | 6 | W18.5–W19.5 |
| M6 | M6.4 平衡与验收 | 8 | W19.5–W21 |
| — | 缓冲 / 1.0 发布 | 6 | W21–W22 |

**合计 96 人日开发 + 6 人日缓冲 = 102 人日 ≈ 21 自然周**（从 M3 收尾后的下一周起算，日历上约 5 个月）。

### 1.4 依赖关系

```text
M3（国家与政策）→ 提供 Country.policies/diplomacy/legitimacy/rulerId（已有）、
  runPolicyRound 增加第 5 参 influence（M3 收尾时加）、ev_country_succession_crisis（新增）、
  同盟 grain/iron 顶价修复（否则"饥荒链"永真）

M4.1 人口与世代 ──┬─→ M4.2 生涯（需要稳定的死活与继承）
                  ├─→ M4.3 关系（需要 family / spouse 关系边）
                  └─→ M5.3 批量校准（需要出生/死亡指标）
M4.4 事件链 ──→ M4.5 抉择（抉择是链上节点的可选分支）
M4.6 迁移 ──→ M5.1（城市视图要再加一张表，v3→v4）
M4.2 ──→ M6.2（官职体系是七国外交的接口）   M4.1 ──→ M6.1（指挥官死亡/继承是战争合法性来源）
M5.3 ──→ M6.4（没有批量模拟就无法校准战争频率）
```

### 1.5 可并行分支

单人 + AI 的"并行"指**同一周内交替推进互不阻塞的两条线**：

| 并行线 | 代码线 | 内容线（AI 主要承担） | 合并点 |
|---|---|---|---|
| A | M4.1 人口/继承代码 | 12 个家族、24 名初始人物、`races.json` 接入 | W2 末 |
| B | M4.2 生涯判定与命令 | `careers.json`、`offices.json`、20 条角色事件 | W3 末 |
| C | M4.4 链调度器 | 6 条链 × 3 步 + 18 个 `followUps` | W5 初 |
| D | M5.1 图层渲染 | 5 城 × 4 城区 JSON、SVG 装饰 | W8 末 |
| E | M6.1 战争结算 | 12 条战争事件 + 7 国背景文本 | W14 末 |

---

## 2. M4 角色与叙事（重点）

### 2.0 设计约束与三个不做

**约束**：1) `core/**` 与 `systems/**` 不得 import `ui/`、`storage/`、DOM（ESLint 现有规则）；2) 新实体 ID 必须是稳定字符串、由确定性序列生成，禁止 `crypto.randomUUID()`；3) 随机走命名流 `{ stream, entityId, periodKey }`，同种子同结果；4) 金额整数铜币，`0–1` 指标浮点；5) 一次 `advanceTo` 与多次 `advanceTo` 结果必须一致（R2），**M4.5 的抉择不能破坏这一条**。

**不做**：1) 不做剧本 DSL / 分支图 / 状态机解释器——抉择 = 结构化效果包，挂在事件上；2) 不做逐人人口模拟——只有"有名有姓的人物"逐个模拟，人口总量仍是地区聚合值；3) 不做跨角色资产指定继承——GDD §3.4 明确新角色不得自动获得旧角色财产与职位。

### 2.0.1 人物档案模型（六维 / 阵营 / 信仰 / 地点）

> 2026-11-19 用户增补要求：人物信息要更丰富——阵营九宫格（随决策动态调整）、六维数据、人物所处地点、信仰（可为无信仰）。同时确认「新建人物」尚未实现：当前世界只有 `world.json` 里 20 个固定人物，没有出生、没有玩家创建流程。

**现状**（`src/core/WorldState.ts`）：`Character` 只有 `{ id, name, raceId, classId, age, alive, regionId, organizationId, wealth, skills, traits }`。没有属性、没有信仰、没有具体场景、没有出生年、没有世代。

**字段增量**

```ts
export type AttributeKey = 'physique' | 'agility' | 'intellect' | 'willpower' | 'perception' | 'charisma';
export type Attributes = Record<AttributeKey, number>;   // 整数 1–20，人类均值 10
export type SiteKind = 'city' | 'town' | 'village' | 'road' | 'court' | 'camp' | 'sea';
export type FaithId = string;                            // 见 content/faiths.json；无信仰用 null

export interface Character {
  // …现有字段保留…
  sex: 'm' | 'f';
  birthYear: number;                                       // 由 day 反推，算年龄与世代
  generation: number;                                      // 玩家 = 1
  familyId: FamilyId | null;
  parentIds: [CharacterId | null, CharacterId | null];
  spouseId: CharacterId | null;
  attributes: Attributes;
  alignment: { law: number; good: number };                // 各 -100..100
  faith: FaithId | null;
  location: { regionId: RegionId; site: SiteKind; sinceDay: number };
  homeRegionId: RegionId;
  offices: Office[];                                       // §2.2
}
```

**六维属性**

| 键 | 名称 | 影响点 |
|---|---|---|
| `physique` | 体魄 | 负重、衰老与死亡基线、佣兵体检定 |
| `agility` | 敏捷 | 战斗先手、潜行、逃脱 |
| `intellect` | 智识 | 估值/议价、学习速度、政策理解 |
| `willpower` | 意志 | 抗压、危机不崩溃、游说抗性 |
| `perception` | 感知 | 洞察/识破、事件预警 |
| `charisma` | 魅力 | 说服、招募、合法性加成 |

- 生成：玩家 27 点购（每维 8–15 起、上限 18）；NPC 用命名流 `attr:<charId>:birth` 掷 3 组 4d6 取三高（均值 12.2）；子女 = `父母均值 ± 2`；最后按种族修正（human +1 任意、dwarf `physique +2 / agility −1`、elf `intellect +1 / perception +1 / physique −1`）并夹 1–20。
- 用途：技能上限 `skillCap = 3 + floor(attr / 3)`（即 12 → 7，18 → 9）；检定加值 `floor((attr − 10) / 4)` 加到 `2d6 + skill`（`SkillCheck.skillCheck` 已支持加值参数）；`mortalityRisk` 用 `physique` 修正基线。
- 年龄曲线：≤16 每年 +1；17–44 稳定；45–64 每 5 年 `physique/agility −1`；65+ 每 5 年 `physique/agility/perception −1`，80+ 每 5 年再减 `intellect/willpower`。

**阵营九宫格（动态）**

两轴 `law`（守序 + / 混乱 −）与 `good`（善良 + / 邪恶 −），各 −100..100，默认 0。标签：轴值 ≥ 30 → 守序/善良，≤ −30 → 混乱/邪恶，之间 → 中立；两轴皆中立即「绝对中立」。

```ts
export type AlignmentLabel =
  | '守序善良' | '中立善良' | '混乱善良'
  | '守序中立' | '绝对中立' | '混乱中立'
  | '守序邪恶' | '中立邪恶' | '混乱邪恶';
export function alignmentLabel(a: { law: number; good: number }): AlignmentLabel;
```

| 变化来源 | 示例 | 幅度 |
|---|---|---|
| 事件效果 | 压榨工人 `good −6`；赈济灾民 `good +8` | 事件里配 `alignment` 效果 |
| 抉择选项 | 「交出逃犯」`law +10 / good −4`；「窝藏」`law −12 / good +6` | `ChoiceDef.alignment` |
| 玩家命令 | `break_contract` `law −8`；本地投资 `good +2`；行贿（新增命令）`law −12` | 命令成功后统一结算 |
| 年度漂移 | 每年向 0 收敛 5%；`abs(law) ≥ 60` 时收敛减半 | 年结 |

约束：夹 −100..100；单次事件总变化 ≤ 20（防一次事件翻转人格）；`abs(Δ) ≥ 10` 写一条 `kind:'milestone'` 历史且 `causeEventId` 必填。阵营影响：初始关系值（同阵营 +10、对立 −15）、事件前置条件（`alignment.law` 走 `readFeature` 点路径）、组织招募倾向（进 `strategyUtility`）、统治者合法性（M4.4）。

**信仰**

`content/faiths.json` 六项：`faith_dawn` 圣光教会、`faith_oldgods` 旧神、`faith_forge` 铸炉、`faith_tide` 海潮、`faith_arcana` 秘仪，加 `null` 无信仰。字段 `{ id, name, domains: string[], moralBias: { law, good }, tolerance: 0–1, orgAffinity: string[] }`。

- 作用：事件条件（`faith == 'faith_tide'`）、关系初值（同信仰 +8）、组织招募（`orgAffinity` 命中 +15% 录用权重）、国家宗教政策（M6）。
- **`null` 是合法值，不是"缺失"**：所有按信仰筛选的地方必须显式处理 `null`（R9 断言之一）。

**地点**

`location: { regionId, site, sinceDay }`，`site` 为粗粒度场景；M5 城市视图再细化为 `settlementId + districtId`。用途：人物事件 scope（"在宫廷"才能触发宫廷事件）、商队/军队移动（`move` 命令改 `location` 并写 `sinceDay`）、UI 显示「绿野 · 城镇（停留 12 天）」。`homeRegionId` 与 `location.regionId` 分开，便于"回乡/流亡"。

**迁移**：`SCHEMA_VERSION` 2→3。`migrateV2toV3` 对 20 个固定人物按 `raceId` 给属性基线、`alignment` 默认 `{ law: 0, good: 0 }`（内容已写者例外：国王 `{ 20, 10 }`、走私女王 `{ −45, −25 }`）、`faith` 取 `world.json` 新增 `faithId` 缺省 `null`、`location` 由 `regionId` + `site:'city'` 推导、`sex/birthYear/generation:1/parentIds:[null,null]/spouseId:null/homeRegionId` 补默认。

**测试**（并入 R9，`tests/character-model.test.ts`，6 例）：属性夹取 1–20；点购 27 点恰好用完；九宫格 9 个边界；单次变化 ≤ 20 且年度漂移收敛；`faith: null` 在条件与招募里被显式处理；非法 `site` 被 `validateWorld` 拒绝。

**新增内容文件**：`content/faiths.json`、`content/backgrounds.json`（6 个背景：商队学徒 / 佣兵 / 书记官 / 走私犯 / 神庙侍从 / 矿工）、`content/names.json`（两种文化各 40 男 + 40 女名池）。

**工期影响**：档案建模 + 迁移 + 创建流程 → M4.1 +1、M4.2 +3、M4.5 +1、M4.6 +1、M5.1 +2 人日。

### 2.1 M4.1 人口与世代更替（7 人日）

**目标**：100 年后世界仍有 40–120 名在世人物、至少 3 代；死亡不再让股份与职位变成僵尸数据。

**改动文件/模块**

| 文件 | 改动 |
|---|---|
| `src/core/WorldState.ts` | `Character` 增 9 字段（`sex`/`birthYear`/`familyId`/`spouseId`/`parentIds`/`generation`，其余 3 个由 M4.2/M4.3 填充）；新增 `Family`、`families`、`characterSeq`、`estateSeq`；`validateWorld` 增 5 条断言 |
| `src/systems/character/Demography.ts`（新） | `settleYearlyBirths`、`settleYearlyMarriages`、`mortalityRiskFor`、`settleEstate` |
| `src/systems/character/CharacterSystem.ts` | `settleYearlyCharacters` 改为编排：死亡 → 遗产 → 继承 → 婚配 → 出生 |
| `src/systems/organization/Organization.ts` | `successionOrder` 增加配偶/子女优先；`treasuryShares` 参与分红与投票 |
| `src/content/races.json` → `content/index.ts` | **当前 `races.json` 没有被装配**（`content/index.ts` 只 import 了 5 个 JSON），M4.1 必须把它接进 `WorldContent.races`，否则 `raceId` 是死字段 |
| `src/content/families.json`（新） | 12 个家族：`{ id, name, seatRegionId, prestige, foundedDay, founderId }` |

**数据模型增量**

```ts
// WorldState.ts
export interface Character {
  // …现有字段…
  sex: 'm' | 'f';
  birthYear: number;            // 游戏年（1 起），age === currentYear - birthYear 为不变量
  familyId: FamilyId | null;
  spouseId: CharacterId | null;
  parentIds: [CharacterId | null, CharacterId | null];
  generation: number;           // 1 = 开局世代
  offices: Office[];            // 见 M4.2
  career: CareerState;          // 见 M4.2
  memory: MemoryEntry[];        // 见 M4.3，上限 8
}

/** 家族：{ id, name, seatRegionId, prestige(0–1), foundedDay, headId } */

export interface Organization {
  // …现有字段…
  treasuryShares: number;       // 0–1，无主股份；shares 之和 + treasuryShares === 1
}

export interface WorldState {
  // …现有字段…
  families: Record<FamilyId, Family>;
  characterSeq: number;         // 新生儿 ID 序号，只增不减
  estateSeq: number;
}
```

**关键规则（写成函数契约）**

```ts
/** 年结：一年只跑一次，顺序固定，全流程确定性。 */
export function settleYearlyDemography(state, content, ctx): {
  births: CharacterId[]; deaths: CharacterId[]; marriages: [CharacterId, CharacterId][];
};

/** 死亡率：按种族寿命归一，50 岁前接近 0，寿命处封顶 0.9。 */
export function mortalityRiskFor(age: number, lifespan: number): number {
  if (age < 45) return age < 5 ? 0.02 : 0;          // 婴幼儿 2%/年
  const ratio = Math.min(1.3, age / Math.max(40, lifespan));
  return Math.min(0.9, Math.pow(ratio, 6));
}
// human lifespan 70 → 60 岁 0.34、70 岁 0.90；elf 220 → 120 岁 0.02，长寿种族自然拉开节奏

/** 出生：只对"双方在世、已婚、16–42 岁、同地区"的夫妇抽样。 */
// p = 0.16 × healthFactor × (1 - livingCount / balance.demography.maxCharacters)^2
// 新生儿 ID：`c_gen_${String(characterSeq).padStart(4,'0')}`，例 c_gen_0042

/** 遗产：先配偶 50%，余额按子女人头等分，余数给最长子女（sortedIds 第一个）。 */
// 无继承人 → 现金按 30% 充公给所在国国库，70% 归家族；股份 → org.treasuryShares
```

**与"ID 跨层一致"和存档兼容的处理**

- 新生儿 ID 用 `c_gen_NNNN`，不复用、不回填；`characterSeq` 单调递增并随存档保存。`validateWorld` 增加断言：`characterSeq` 必须大于所有 `c_gen_` 前缀 ID 的最大序号。
- 死亡不删除 `characters` 条目（`alive = false`），因为历史、`causeEventId`、家族树都引用它；代价是存档变大，用 M4.6 的"死者字段裁剪"控制（保留 id/name/sex/birthYear/familyId/parentIds/spouseId/deathDay，清空 `memory` 与 `offices`）。
- 股份不复制：`settleEstate` 只做 `share` 的**转移**（先减后加），转移前后 `Σ shares` 相等，差额进 `treasuryShares`。这条是 R7 的强化版断言。

**内容量**：`families.json` 12 条（约 2.4 KB）；24 名初始人物补 `sex`/`birthYear`/`familyId`/`parentIds`（约 3 KB）；新增 6 条角色事件（出生、成年礼、联姻、绝嗣、遗产纠纷、私生子）。

**验收标准**

| # | 断言 | 判定方式 |
|---|---|---|
| A1 | 100 年后 `alive` 人数 ∈ [40, 120]，`max(generation) ≥ 3`，累计出生 ≥ 60 | `pnpm sim` 新增指标行；`tests/character-lifecycle.test.ts` |
| A2 | `validateWorld()` 返回 `[]`；`age === currentYear - birthYear` 对全体成立 | 单测 + 100 年回归 |
| A3 | 遗产守恒：`Σ 继承人所得 + 充公 === 死者 wealth`（误差 0） | 6 组固定种子的分配用例 |
| A4 | `Σ org.shares.share + org.treasuryShares === 1`（容差 1e-6），每次死亡后成立 | 月结断言 + 100 年回归 |
| A5 | 人口上限 160 时，100 年模拟 < 2.0 s | 性能用例（现有 `< 5000 ms` 收紧到 `< 2000 ms`） |
| A6 | v2 存档迁移到 v3 后 `validateWorld === []`，再跑 10 年与不中断哈希一致 | `tests/migration.test.ts` 扩展 |

**测试用例（新增 `tests/character-lifecycle.test.ts`，8 例）**：① 强制 `birthRate = 1`、一对 25 岁夫妇 → 一年后恰好 1 名新生儿，`parentIds` 正确；② `mortalityRiskFor(90, 70) === 0.9`、`mortalityRiskFor(30, 70) === 0`；③ 死者 1,000 铜币 2 名子女 → 各 500，有配偶 → 配偶 500 + 子女各 250；④ 无继承人 → `treasuryShares` 增加、`Σ shares` 不变；⑤ 寡妇再婚：`parentIds` 不变、`spouseId` 互换、前任 `spouseId` 置 null；⑥ 跑 200 年 `characterSeq` 严格递增、无重复键；⑦ 死者裁剪后 `memory.length === 0` 且 `id` 仍可被历史引用；⑧ `living = 160` 时新生儿数 = 0。

**风险**：人口爆炸拖垮性能（缓解：上限 + 出生率二次衰减 + 只对 L2 人物做婚配抽样）；继承引发财富集中（缓解：遗产税 10% 入国库，`balance.demography.estateTaxRate`）；`age` 与 `birthYear` 双写不一致（缓解：`age` 只由年结 +1，`validateWorld` 断言）。

### 2.2 M4.2 生涯路径与开局人物创建（9 人日）

**目标**：商人 / 佣兵 / 政治人物三条路径都能从"无名者"走到"有职位者"，且可交叉；职位带来真实的政策与组织影响力。另含**开局人物创建**：新游戏时玩家自选种族 / 职业 / 背景 / 信仰 / 六维点购 27 点 / 姓名与性别，生成 `c_player`；预设「艾伦·格雷」保留为快速开局。

**改动文件/模块**

| 文件 | 改动 |
|---|---|
| `src/systems/character/Career.ts`（新） | `xpGain`、`rankOf`、`promoteIfEligible`、`canCrossTo`、`seekOffice` |
| `src/systems/character/CharacterSystem.ts` | 月结追加 `settleMonthlyCareer`（XP、声望衰减、薪资） |
| `src/core/CommandBus.ts` | 新增 5 条命令：`move`、`work`、`train`、`seek_office`、`retire` |
| `src/systems/country/PolicySystem.ts` | `runPolicyRound(state, ctx, day, influence = 0)`：`influence` 来自玩家官职，参与 `support` 计算 |
| `src/content/careers.json`（新） / `offices.json`（新） | 3 职业 × 5 级；2 国 × 6 官职 |
| `src/ui/CharacterPanel.ts` / `src/ui/PlayerPanel.ts` | 生涯条、官职卡、可执行行动按钮 |
| `src/ui/CharacterCreator.ts`（新） | 开局创建：种族 / 职业 / 背景 / 信仰 / 六维点购 / 姓名 / 性别；纯前端，提交后由 `start_game` 生成状态 |
| `src/content/backgrounds.json` / `faiths.json` / `names.json`（新） | 6 背景（属性与技能加成）、5 信仰 + 无信仰、两种文化名字池 |

**数据模型增量**

```ts
export type CareerTrack = 'merchant' | 'mercenary' | 'politician';

export interface CareerState {
  track: CareerTrack;
  xp: Record<CareerTrack, number>;   // 三轨独立累计，允许交叉
  rank: number;                      // 1–5
  reputation: number;                // 0–1
  retired: boolean;
}

export interface Office {
  id: string;                        // 'off_country_kingdom_treasurer'
  countryId: CountryId | null;
  orgId: OrgId | null;
  title: string;                     // '财政大臣' / '商会会长' / '城防队长'
  rank: 1 | 2 | 3;
  salaryMonthly: number;
  influence: number;                 // 0–1，进 PolicySystem
  sinceDay: number;
}
```

**数值（写进 `careers.json`，可调）**

| 项 | 商人 | 佣兵 | 政治人物 |
|---|---:|---:|---:|
| 等级阈值 XP | 0 / 120 / 400 / 1,000 / 2,200 | 0 / 150 / 450 / 1,100 / 2,400 | 0 / 100 / 350 / 900 / 2,000 |
| 主技能 | trade / negotiation | melee / tactics | persuasion / law |
| XP 来源 | 月利润/200，上限 40/月 | 契约 +15，战斗胜 +40 | 游说成功 +25，政策通过 +40 |
| 交叉条件 | rank ≥ 3 且 reputation ≥ 0.55 且 wealth ≥ 15,000 | rank ≥ 3 且 reputation ≥ 0.5 | rank ≥ 2 且任一组织持股 ≥ 10% |

**交叉规则**：`canCrossTo()` 只做资格判定，真正的转换由 `seek_office` 命令完成——**转换不改 `track`，只增加 `offices`**，`track` 保留最高 XP 的那条，这样"商人兼议员"天然成立，不需要多职业状态机。

**验收标准**

| # | 断言 |
|---|---|
| B1 | 脚本化 5 年路径：`c_player` 连续 3 月盈利 → `rank 2`；`lobby` ×3 → `reputation ≥ 0.5`；`seek_office` 成功 → `offices.length === 1`；随后政策提案通过率较无官职基线高 ≥ 15 个百分点（100 次采样） |
| B2 | 交叉不锁死：佣兵 rank 3 + reputation 0.5 可 `seek_office` 到 `off_city_captain`；`career.xp.merchant` 保留不清零 |
| B3 | 无资格时 `seek_office` 返回 `{ ok: false }` 且 `hash()` 不变 |
| B4 | 官职薪资月结入 `character.wealth`，来源是国库/组织现金，且 `history` 记录 `refs` 指向该官职 |
| B5 | 同一官职不能被两人同时持有（`validateWorld` 断言） |
| B6 | 开局创建：27 点必须恰好用完、属性夹 8–18、`faith: null` 合法、生成的 `c_player` 通过 `validateWorld` |

**测试用例（`tests/career.test.ts`，6 例）**：XP 阈值边界（119/120）、交叉资格、官职唯一性、薪资守恒（国库减少 === 人物增加）、退休后不能再 `seek_office`、政策影响力差异。

**风险**：职业生涯数值与组织利润耦合过紧（利润高 → XP 飞涨）；缓解：XP 上限 40/月 + 声望衰减 0.01/月（向 0.3 回归）。UI 复杂度上升；缓解：人物面板只显示"当前等级 + 下一级还差多少 XP + 一个可执行行动"。

### 2.3 M4.3 关系与记忆（4 人日）

**目标**：NPC 记得玩家做过什么，关系变化能改变行为；关系不再是一次性事件效果的垃圾桶。

**改动文件/模块**

| 文件 | 改动 |
|---|---|
| `src/core/WorldState.ts` | `Relation` 增 `sinceDay`、`lastDay`、`causeEventId`、`trust`；`Character.memory: MemoryEntry[]` |
| `src/systems/character/Relations.ts`（新） | `adjustRelation`、`decayRelations`、`remember`、`attitudeOf` |
| `src/systems/npc/DecisionSystem.ts` | 契约接受/拒绝、结盟、举报的效用里加入 `attitudeOf(actor, player)` |
| `src/systems/organization/ContractSystem.ts` | 违约时对双方关系 -20；履约 +5 |
| `src/ui/CharacterPanel.ts` | 关系列表（最多 8 条）+ 记忆时间线 |

**数据模型增量**

```ts
export interface Relation {
  from: string; to: string;
  type: 'rival' | 'ally' | 'family' | 'debt' | 'feud' | 'mentor' | 'client';
  value: number;                 // -100..100
  trust: number;                 // 0–1，与 value 分开：怕你 ≠ 信你
  sinceDay: number;
  lastDay: number;
  causeEventId: string | null;   // 最近一次改变的原因，可点回历史
}

/** MemoryEntry: { day, kind: gift|betrayal|contract|help|insult|marriage, subjectId, weight(-1..1) } */
```

**规则**：关系值年衰减 15%（向 0 收敛，不向正值漂移）；`memory` 上限 8 条，超出按 `|weight|` 保留最强、同权重按 `day` 新者优先；`attitudeOf(state, npcId, playerId)` 返回 `-1..1`，作为 `DecisionSystem` 的额外项 `+0.3 × attitude`。

**验收标准**

| # | 断言 |
|---|---|
| C1 | 玩家连续 3 次违约 → 对方 `relation.value` 累计下降 ≥ 30，且 `causeEventId` 指向最后一次违约事件 |
| C2 | 100 次契约报价采样：`attitude < -0.3` 的 NPC 拒绝率比 `attitude > 0.3` 高 ≥ 25 个百分点 |
| C3 | 年衰减后 `abs(value)` 单调不增；`relations.length ≤ 400` |
| C4 | `memory.length ≤ 8` 且每条都能在 `history` 找到同 `day` 的记录 |

**测试用例（`tests/relations.test.ts`，5 例）**：违约降值、履约升值、衰减、记忆裁剪、拒绝率差异（统计断言，固定种子）。

**风险**：关系网 O(n²) 膨胀；缓解：只对 L1/L2 人物建立关系边，上限 400，超出按 `|value|` 裁剪。

### 2.4 M4.4 事件链与因果追溯（5 人日）

**目标**：GDD §13.2 的"矿难 → 救援 → 矿工组织 → 参政"能用现有事件引擎表达，且每条历史都能点回原因。

**现状**：`ScheduledEvent.parentEventId`、`HistoryRecord.causeEventId` 已存在；`applyEffect` 的 `schedule` 能入队后续事件。缺的是：**内容层的"后续表"**、**链深限制**、**事件实例图**。

**改动文件/模块**

| 文件 | 改动 |
|---|---|
| `src/core/WorldState.ts` | `EventDef.followUps?`；`EventInstance` + `eventLog` + `eventSeq` + `MAX_CHAIN_DEPTH` |
| `src/core/EventEngine.ts` | `scheduleFollowUps()`；`applyEvent` 落 `EventInstance`；`traceChain(state, instanceId)` 返回祖先/后代 |
| `src/core/History.ts` | `HistoryQuery.causeEventId`；`chainOf(instanceId)` |
| `src/content/events/*.json` | 6 条链、18 个 `followUps` |
| `src/ui/HistoryPanel.ts` | 每条记录显示"因为 …"，可展开 3 层 |

**数据模型增量**

```ts
export interface FollowUp {
  eventId: string;
  inDays: [number, number];        // 延迟区间，闭区间整数
  chance: number;                  // 0–1，入队时抽样
  requires?: Expr;                 // 入队时再判一次条件
  carryTarget: boolean;            // true = 沿用父事件目标
}

export interface EventDef {
  // …现有字段…
  followUps?: readonly FollowUp[];
}

export interface EventInstance {
  id: string;                      // `ei_000123`
  eventId: string; day: number;
  scope: EventDef['scope']; entityId: string;
  parentId: string | null;
  depth: number;                   // 0 起，MAX_CHAIN_DEPTH = 4
  choiceId: string | null;
}

/** WorldState 增量：eventLog: EventInstance[]（上限 3000，超出从头部丢 500 条）、eventSeq、stats.chainTruncated */
```

**示例内容（`content/events/organization.json` 片段）**

```json
{ "id": "ev_org_mine_collapse", "domain": "organization", "scope": "organization",
  "conditions": { "all": [{ "path": "industry", "op": "==", "value": 2 }] },
  "risk": { "lambda0": 0.004, "terms": [{ "path": "governance", "coef": -2.0 }] },
  "cooldownDays": 365,
  "effects": [{ "kind": "add", "path": "cash", "value": -800 }],
  "followUps": [
    { "eventId": "ev_org_mine_relief", "inDays": [3, 21], "chance": 0.7, "carryTarget": true },
    { "eventId": "ev_org_mine_strike", "inDays": [20, 60], "chance": 0.35, "carryTarget": true } ],
  "text": { "title": "矿井塌方", "body": "铁峰堡三号井塌了，{dead} 名矿工被埋在下面。" } }
```

**验收标准**

| # | 断言 |
|---|---|
| D1 | 强制 1000 次触发 `ev_org_mine_collapse` → `ev_org_mine_relief` 触发率 ∈ [65%, 75%] |
| D2 | 每条 `history.causeEventId` 都能在 `eventLog` 解析到实例；解析失败率 0 |
| D3 | 链深 > 4 时 `scheduleFollowUps` 返回 `false` 并 `stats.chainTruncated++`，不静默丢弃 |
| D4 | `eventLog.length ≤ 3000`，超出后最老 500 条被丢弃且 `eventLogDropped` 计数准确 |
| D5 | 100 年后 `history` 中 `kind: 'event'` 记录数 ≥ 120，链式记录占比 ≥ 25% |

**测试用例（`tests/chains.test.ts`，6 例）**：链概率、链深截断、父实例引用完整性、`eventLog` 裁剪、`carryTarget` 与跨目标调度、`traceChain` 返回顺序稳定。

**风险**：链爆炸（一个事件引发 5 个后续，每个再引发 5 个）；缓解：`MAX_CHAIN_DEPTH = 4` + 每条链最多 3 步 + 全局每月后续事件入队上限 12 条。历史噪声；缓解：M4.6 的历史分级保存。

### 2.5 M4.5 对话与抉择（7 人日）

**目标**：玩家能在事件里做选择，看到成本、风险与部分后果；**不引入分支剧本引擎**。

**最小形态（写死边界）**

```ts
export interface ChoiceDef {
  id: string; label: string;           // '出钱抚恤'
  hint?: string; requires?: Expr;      // 已知情报；不满足 → 按钮灰显（不是隐藏）
  cost?: { wealth?: number; influence?: number; days?: number };
  check?: { skill: string; difficulty: number };   // 可选：2d6+技能
  onSuccess: readonly Effect[];
  onFailure: readonly Effect[];        // 无 check 时只用 onSuccess
  reveal?: 'none' | 'partial';         // 隐藏后果：只显示"可能有代价"
}

/** EventDef 增量：choices?: readonly ChoiceDef[]；interrupt?: boolean（有 choices 时默认暂停快进） */

export interface PendingChoice {
  instanceId: string; eventId: string; // instanceId 指向 eventLog
  target: { scope: EventDef['scope']; entityId: string };
  day: number;
  choiceIds: string[];                 // 快照，防止内容热更导致选项漂移
}
// WorldState.pendingChoice: PendingChoice | null
```

命令：`{ kind: 'choose'; instanceId: string; choiceId: string }`。执行 `applyChoice`：校验 → 扣成本 → 可选检定（`SkillCheck`）→ 应用效果 → 清空 `pendingChoice` → 写历史（`causeEventId = eventId`）。

**引擎时序（关键，决定 R2 是否成立）**

```ts
// GameEngine 构造参数新增：
constructor(state, content, options?: { stopAtChoices?: boolean });
// 交互模式 true：遇到 choices 事件时写入 pendingChoice 并停止 advanceTo
// 批量/测试模式 false（默认）：按 choicePolicy 自动解析，然后继续
type ChoicePolicy = 'default' | 'greedy' | 'cautious';
```

> **R2 的扩展定义**：含抉择的世界，`advanceDays(1200)` 与 1200 次 `advanceDays(1)` 必须哈希一致，**前提是两次运行使用同一 `choicePolicy`**。这条写进 `tests/fastforward.test.ts` 的注释与断言，避免以后有人用"抉择天然不可快进"当借口。

**UI**：`EventDialog` 增加选项区——每个按钮显示 `label` + `hint` + 成本（`−1,200 铜币`）+ 风险（`检定 口才 DC 12，成功率 58%`）；`reveal: 'none'` 只显示"结果未知"。

**验收标准**

| # | 断言 |
|---|---|
| E1 | 成本不足 → `ok: false`，`hash()` 不变，`pendingChoice` 保留 |
| E2 | 同一 `instanceId` 只能选一次；第二次 `ok: false`（`error: '该事件已处理'`） |
| E3 | `pendingChoice` 非空时存档 → 读档 → 仍可 `choose`，结果与不中断一致 |
| E4 | `stopAtChoices: false` 下 R2/R3 全绿（哈希一致） |
| E5 | 每条 `choices` 的 `onSuccess`/`onFailure` 效果路径都在白名单内（`audit:content` 检查） |
| E6 | 26 个抉择中至少 8 个带 `check`，且成功率显示值与 `skillCheck` 实际频率偏差 ≤ 5 个百分点（1000 次采样） |

**测试用例（`tests/choices.test.ts`，7 例）**：成本不足、重复选择、存档往返、自动策略确定性、检定成功率、`requires` 灰显、`reveal` 不泄露隐藏效果。

**风险**：抉择让"快进"语义变复杂（缓解：`stopAtChoices` 默认 false，只有 UI 显式打开）；文本膨胀（缓解：单条 `body` ≤ 240 字，`label` ≤ 12 字，`audit:content` 强制）。

### 2.6 M4.6 存档 v3 迁移、内容审计与验收（4 人日）

**`SCHEMA_VERSION` 2 → 3**，迁移只增不改：

```ts
// storage/Migration.ts
const MIGRATIONS: Record<number, (raw: any) => any> = {
  1: upgradeV1ToV2,   // 已存在
  2: upgradeV2ToV3,   // 新增
};

function upgradeV2ToV3(raw: any): any {
  const year = Math.floor((raw.clock.day - 1) / 360) + 1;
  Object.keys(raw.characters).sort().forEach((id, i) => {
    const c = raw.characters[id];
    Object.assign(c, {
      sex: c.sex ?? (i % 2 === 0 ? 'f' : 'm'),        // 确定性，不随机
      birthYear: c.birthYear ?? year - (c.age ?? 30),
      familyId: c.familyId ?? null, spouseId: c.spouseId ?? null,
      parentIds: c.parentIds ?? [null, null], generation: c.generation ?? 1,
      offices: c.offices ?? [], memory: c.memory ?? [],
      career: c.career ?? { track: c.classId, xp: {}, rank: 1, reputation: 0.3, retired: false },
    });
  });
  for (const org of Object.values<any>(raw.organizations)) {
    const sum = org.shares.reduce((a: number, s: any) => a + s.share, 0);
    org.treasuryShares ??= Math.max(0, Number((1 - sum).toFixed(6)));
  }
  Object.assign(raw, { families: raw.families ?? {}, characterSeq: raw.characterSeq ?? 0,
    estateSeq: 0, eventLog: raw.eventLog ?? [], eventSeq: 0, pendingChoice: null });
  raw.meta.schemaVersion = 3;
  return raw;
}
```

**哈希策略**：迁移后状态必然与旧哈希不同，`parseSave()` 在迁移分支跳过 `hash` 比对并记录 `migratedFrom: 2`；未迁移分支仍严格比对（R3 现状不变）。

**旧档夹具**：把当前 `release` 版本导出的真实存档存为 `tests/fixtures/saves/v2-demo.json`（约 300 KB，压缩后进仓库），另造 `v2-minimal.json` 覆盖边界（无契约、无货运、股份和 < 1）。

**内容审计脚本** `scripts/audit-content.ts`（`pnpm audit:content`）：

| 检查项 | 失败条件 |
|---|---|
| ID 唯一 | 事件/职业/官职/家族 ID 重复 |
| 引用存在 | `followUps[].eventId`、`choices[].onSuccess` 里的 `schedule.eventId` 指向不存在的事件 |
| 效果路径 | `add/set/mul` 的 `path` 不在白名单（组织 28 个字段、国家 9 个、地区 4 个、人物 6 个） |
| 链深 | 静态展开后深度 > 4 |
| 文本长度 | `title > 24` 字、`body > 240` 字、`label > 12` 字 |
| 数值区间 | `chance ∉ [0,1]`、`inDays` 非升序、`cooldownDays < 0` |
| 规模 | `events.length < 30` 时报警（防止误删内容） |

**验收**：`audit:content` 0 错误；故意插一个悬空 `followUps` → 退出码 1 且错误信息含该 id；用例总数 ≥ 90；v2 夹具迁移后 `validateWorld === []`。

### 2.7 M4 内容量与包体拆账

| 内容 | 现状 | M4 目标 | 增量 | 估算字节 |
|---|---:|---:|---:|---:|
| 事件（条） | 20 | 40 | +20 | 24 KB（含正文） |
| 事件链（条 / `followUps` 项） | 0 | 6 / 18 | +18 | 4 KB |
| 抉择（个 / 平均选项） | 0 | 26 / 2.4 | +26 | 7 KB（含选项文本） |
| 初始人物（名） | 20 | 24 | +4 | 3 KB |
| 信仰 / 背景 / 名字池（个） | 0 | 5 / 6 / 160 | +171 | 8 KB |
| 家族 / 官职 / 职业 | 0 | 12 / 12 / 3 | +27 | 6 KB |
| 文本字数（汉字，含在上述行内） | ≈ 6,000 | ≈ 18,000 | +12,000 | — |
| **内容 JSON 小计** | 44.8 KB | — | — | **+52 KB** |
| 新增/修改 TS（行） | 9,164 | — | +3,200 | +45 KB（14 B/行） |
| **M4 产物增量** | — | — | — | **≈ +98 KB** |
| **累计产物** | 146.5 KB | — | — | **≈ 245 KB（15.6%）** |

> 估算方法：当前 146,534 B ÷ 9,164 行 = 16.0 B/行（含 JSON 与运行时）；纯 TS 取 14 B/行，内容 JSON 按原始 UTF-8 字节计（单文件不做 gzip）。误差带 ±25%。结论：**M4 不可能撞包体预算**，真正的成本是作者时间与内容一致性。

### 2.8 与现有架构的冲突点（必须正面处理）

| 冲突 | 现状 | 处理 | 代价 |
|---|---|---|---|
| `races.json` 未被装配 | `content/index.ts` 只 import 5 个 JSON，`raceId` 是死字段 | M4.1 增加 `WorldContent.races`，`mortalityRiskFor` 按 `lifespan` 归一 | `WorldContent` 形状变化 → 所有构造 `content` 的测试夹具要补 `races`（1 处 helper） |
| 死者仍占 `characters` | `handleDeath` 只置 `alive = false` | 保留条目 + 字段裁剪；`validateWorld` 允许死者 `organizationId = null` | 存档体积随代数线性增长，需裁剪 |
| 股份留在死者名下 | `CharacterSystem.ts` 注释明说"股份仍记在死者名下（遗产）" | `settleEstate` 转移 + `treasuryShares` 兜底 | 新增字段，v2→v3 迁移 |
| `Organization.leadership.leaderId` 可指向死者 | 无继承人时 `leaderId` 仍是死者、合法性 0.1 | M4.1 允许"空缺"：`leaderId: null` 需要改类型（破坏面大）→ 折中：保留死者 ID 但增 `leadership.vacant: boolean`，UI 显示"领袖空缺" | 类型不改，语义靠 `vacant` |
| 事件没有"实例"概念 | 历史只存 `causeEventId` 字符串 | 新增 `eventLog` + `EventInstance` | 存档 +5 KB/100 年（上限 3000 条） |
| 快进没有中断点 | `ScheduledKind` 有 `'interrupt'` 占位，无查询 API | M4.5 增加 `pendingChoice` 与 `stopAtChoices`，**不改** `advanceTo` 签名 | 引擎多一个构造参数，UI 多一个分支 |
| `Polity` 只有两种 | `type Polity = 'monarchy' \| 'republic'` | M6.2 扩到 5 种，`PolicySystem` 的 `support` 计算改策略表 | M3 的 `runPolicyRound` 要预留策略表入口（见 §8） |

---

## 3. M5 整合与校准

### 3.1 完整 UI（13 人日）

**M5.1 城市内视图与四图层（8 人日）**

- **模型扩展**：不改 `Region`，新增独立运行时表 `state.districts`。

```ts
export interface DistrictDef {
  id: DistrictId; regionId: RegionId; name: string;
  kind: 'market' | 'harbor' | 'barracks' | 'temple' | 'craft';
  x: number; y: number;           // 城市局部坐标 0–400
}
export interface District {
  id: DistrictId; regionId: RegionId; kind: DistrictDef['kind'];
  prosperity: number;             // 0–1
  unrest: number;                 // 0–1
  population: number;
}
```

  **为什么另起一张表**：`Region` 是"内容不可变 + 地图节点 + 市场容器"三合一，把城区塞进去会让 `RegionDef`（只读）与 `Region`（可变）继续分叉，且 `createWorld` 的 region 循环会被城区污染。独立表迁移简单（v3→v4 只加一个空对象 + 默认城区）。
- **月结**：`settleMonthlyDistricts` 按"地区价格偏离 → 繁荣度"、"国家稳定度 + 失业 → 动荡"更新，公式写在 `balance.json` 的 `district` 段。
- **四图层**：`src/ui/layers/{Political,Economy,Commerce,War}Layer.ts`，统一接口 `render(state): SVGGElement`；`MapView` 为每层建一个 `<g data-layer>`，切换只改 `hidden`，不重建 DOM。
- **人物档案可视化**：人物面板加「六维条」（6 条 0–20 横条，带均值 10 参考线）、「阵营九宫格」（3×3 网格，当前格高亮 + `law/good` 数值）、「信仰徽记」（5 个 SVG 徽记 + 无信仰用空心圈）、地点行「绿野 · 城镇（停留 12 天）」；玩家卡与人物面板共用 `src/ui/profile.ts` 的渲染函数（新增文件，纯函数，便于测试）。
- **兼容性**：`MapView` 当前一次 `build()` 后只 `update()` 人口文本；图层需要"状态变了但几何不变"的增量重绘，否则 p95 帧会超 16 ms。

**M5.2 教程 / 无障碍 / 移动端（5 人日）**

- 教程 7 步（看地图 → 选地区 → 进组织 → 投一次资 → 游说一次 → 看历史因果 → 存档），状态存 `state.settings.tutorialStep`（随存档），可跳过。
- 无障碍：焦点陷阱（模态）、`:focus-visible` 2px 环、对比度 ≥ 4.5:1、`prefers-reduced-motion`、字号 100/125/150%（`--font-scale`）、`aria-live="polite"` 的通知区。
- 移动端：断点 768px，单列布局，地图 40vh，页签横向滚动，触控目标 ≥ 44×44。

**M5.3 批量模拟与校准（6 人日）**

- `scripts/batch-sim.ts --seeds 100 --years 100 --workers 4 --out reports/`：`worker_threads` 并行，单 seed ≈ 1.7 s，4 线程 ≈ 45 s，预算 10 min。
- 输出 `reports/calibration-<date>.json`（每 seed 一行）+ `reports/calibration-<date>.md`（分位数表）。
- 目标带（先定义体验，再让数据收敛，遵循 GDD §19.4）：

| 指标 | 目标带 | 当前（3 seed） |
|---|---|---|
| 破产率 | 15–35% | 22.2–31.6% ✅ |
| 分裂率 | 5–15% | 5.6–10.5% ✅ |
| 政策变更次数 / 100 年 | 8–25 | 待 M3 测量 |
| 政体变更 / 100 年 | 0–1 | 待测 |
| 存活人物 / 100 年 | 40–120 | **0** ❌（M4.1 修） |
| 代数 | ≥ 3 | 1 ❌ |
| 价格偏离 p95 | ≤ 35% | 待测（同盟 grain/iron 曾 120–128%） |
| 组织资产基尼 | ≤ 0.7 | 待测 |
| 历史条数 / 100 年 | ≤ 8,000 | 预估 8k–20k ⚠️ |

- 每次只改一个参数族，写 `reports/calibration-log.md`（before/after 两列指标），禁止"多参数一起调"。

### 3.2 性能预算复核

| 场景 | 现预算 | 实测/预估 | 结论 |
|---|---|---|---|
| 100 年（5 区 20 市场） | < 2 s | 1.4–1.7 s | 达标，M4 后需重测（人口 160） |
| 单次 UI 更新 | < 16 ms | 未测 | M5.1 图层化后必须测 p95（200 帧采样） |
| 存档写入 | < 100 ms | 未测 | 历史裁剪后测；JSON 序列化 500 KB ≈ 20–40 ms |
| 构建产物 | ≤ 1.5 MiB | 146.5 KB | 余量 3.6 倍 |

**热路径**（`settleMonthlyMarket` → `settleMonthlyTrade` → `monthlyOrganizationSettlement`）：

- 市场循环 = 地区 × 商品 × 组织份额分配；5×4×10 = 200 次，14×6×30 ≈ 2,520 次（M6）。
- `hashWorld()` 对全状态 `stableStringify`，历史 8k 条时约 15–30 ms/次；`--check` 跑两次可接受，但不要放进逐帧循环。

### 3.3 跨浏览器与 `file://` 兼容矩阵

| 环境 | Chrome 120+ | Edge 120+ | Firefox 121+ | Safari 17+ |
|---|---|---|---|---|
| `https://`（Pages） | 必测 | 必测 | 必测 | 必测 |
| `file://` 双击 | 必测 | 必测 | 必测 | 必测 |
| IndexedDB 可用 | ⚠️ 需实测 | ⚠️ 需实测 | ✅ 预计 | ❌ 预计不可用 |
| `structuredClone` | ✅ | ✅ | ✅ | ✅（15.4+） |
| 导出/导入 JSON | 必测 | 必测 | 必测 | 必测 |

**已知风险**：`file://` 是 opaque origin，部分浏览器对 IndexedDB/localStorage 抛 `SecurityError`。`SaveManager.storageAvailable()` 目前只探测 IndexedDB。M5 必须加降级链：**IndexedDB → localStorage → 内存槽位 + 强制提示"请导出存档"**，并在发布检查里逐浏览器勾选。这是"离线双击可玩"承诺的必要条件。

### 3.4 发布检查清单（M5.4，5 人日）

- [ ] `pnpm verify` 全绿（typecheck / lint / format / test / build / release）；版本号三处一致：`package.json`、HTML `<title>`、页脚
- [ ] `release/index.html` ≤ 1,572,864 B；无 `<script src>`、无外链 `@import`/`url(http)`
- [ ] `file://` 打开：0 console error、6+3 个面板可达、存档→读档→续跑一致
- [ ] 4 浏览器 × 2 协议矩阵全绿，截图存档到 `docs/release/`
- [ ] `pnpm sim --years 100 --seed demo-seed --check` 哈希一致、< 2 s
- [ ] `batch:sim` 100 seed 报告归档，指标落入目标带
- [ ] 存档 v2/v3 夹具迁移通过；迁移后哈希重算不报错
- [ ] 教程可跳过；键盘可完成"投一次资 + 游说一次"

---

## 4. M6 战争与世界扩展

### 4.1 战争最小闭环（10 人日）

**四阶段：动员 → 行军 → 会战 → 和约**。不做实时战术、不做兵种树、不做补给线图。

```ts
export interface Army {
  id: ArmyId; countryId: CountryId; size: number; morale: number;   // morale 0–1
  locationRegionId: RegionId; commanderId: CharacterId | null;
  supply: number;                 // 0–1，敌方领土每日 -0.02
  stance: 'garrison' | 'march' | 'engage';
}

export interface War {
  id: WarId; aggressorId: CountryId; defenderId: CountryId;
  casusBelli: 'territory' | 'trade' | 'succession' | 'raid';
  startDay: number; endDay: number | null;
  warScore: number;               // -100..100，正 = 侵略方有利
  battles: BattleId[];
  status: 'declared' | 'active' | 'ceasefire' | 'treaty';
}

/** Battle: { id, warId, day, regionId, attackerArmyId, defenderArmyId,
 *  attackerPower, defenderPower, losses{attacker,defender}, winner: attacker|defender|draw } */
```

**结算公式（写进 `balance.json` 的 `war` 段）**

```text
power = size × (0.5 + morale) × (1 + tactics/40) × (0.6 + 0.4×supply) × terrainMod
terrainMod: 山地 1.25（守方）/ 平原 1.0 / 城市 1.35（守方）/ 海岸 0.9
lossRate = clamp(0.12 + 0.4 × |ratio − 1|, 0.05, 0.45)
warScore += winner === attacker ? +18 : −12（会战规模加权 ±6）
```

- 触发：`casusBelli` 概率由 `diplomacy < -40`、领土争端、继承危机（M4 链）驱动，`lambda0 = 0.008/年`，目标 1/15–25 年。
- 和约：`warScore ≥ 40` 可提条件（赔款 / 割 1 区 / 贸易特权 / 白和）；`≤ -40` 被迫接受；`±40` 之间只能停战。
- 动员成本：`size × 12` 铜币一次性 + `militaryShare` 上调压力；这直接压 `CountrySystem` 的预算恒等式。

### 4.2 七国与魔法经济（14 人日）

| 内容 | 体量 | 估算 |
|---|---|---|
| 新增 5 国（铁誓公国 / 灰烬教国 / 林海议会 / 沙海商团 / 北境联合） | 每国 1 条 `countries.json` + 2–3 区 | 2 KB + 3 KB |
| 新增 9 区（总 14 区，56 市场） | 坐标、人口、链接 | 5 KB |
| 政体扩到 5 种（+`theocracy` / `oligarchy` / `confederation`） | `Polity` 联合类型 + `PolicySystem` 策略表 | 代码 400 行 |
| 魔法商品 4 种（魔力结晶 / 卷轴 / 药剂 / 附魔钢） | `goods.json` + 生产链 | 1.5 KB |
| 法师组织 3 家 + 法师塔建筑 | `organizations.json` | 1.5 KB |
| 战争事件 12 条 / 外交事件 8 条 / 魔法事件 6 条 | `events/war.json`（新）、`magic.json`（新） | 24 KB |
| 七国背景文本 | ≈ 6,000 字 | 18 KB |

**魔法经济的边界**：魔法只作为"商品 + 一次性命令"，不引入第二套资源循环。例：`cast_scry`（情报，冷却 90 天，花费 1 结晶）只提高事件 `requires` 的可见度；`teleport_goods` 把一次运输的 `days` 降到 1，但成本 = 3 结晶 + 运力减半。**禁止**传送门网络自动重写 `TradeSystem` 路由——那会让 M2 的所有运力校准失效。

### 4.3 与现有系统的耦合点

| 系统 | 耦合 | 必须改的地方 |
|---|---|---|
| `CountrySystem` | `militaryShare × revenue` → 军费；战时额外支出 | `settleMonthlyCountry` 增加 `warExpense` 字段 |
| `TradeSystem` | 战区商路 `warRisk = 0.08/日` 损耗；被围城地区 `exportCapacity = 0` | `settleMonthlyTrade` 读取 `War.status` |
| `MarketSystem` | 武器需求 +40%，粮食需求 +15%（战时） | `demandModifier` 由战争状态注入，不硬编码 |
| `CharacterSystem` | 指挥官每场会战 8% 死亡；死亡触发继承 | 复用 M4.1 `handleDeath`，不新增路径 |
| `OrganizationSystem` | 军需契约（supply）利润高、违约惩罚重 | `ContractSystem` 增加 `war_supply` 子类型或复用 `supply` |
| `PolicySystem` | 战败 → `legitimacy -0.15`；胜利 → `+0.1` | `runPolicyRound` 的压力项增加 `warWeariness` |
| `History` | 新增 `kind: 'war'` | `HistoryKind` 联合类型扩一项，UI 加筛选 |

### 4.4 为什么必须是 post-MVP（前置条件）

1. **战争是方差放大器**。它同时推高价格、抬高破产率、改变政策、杀死人物。若经济与组织尚未校准（M2 的破产率刚进区间、M3 的同盟顶价未修），战争会让所有指标不可读——无法判断"破产率上升"是战争导致还是参数错。
2. **它依赖 M4 的三样东西**：稳定的死亡/继承（指挥官阵亡）、官职体系（宣战需要"统帅"职位）、事件链（继承危机是 `casusBelli` 的主要来源）。
3. **它依赖 M5 的批量模拟**。战争频率 1/15–25 年这种指标，只能靠 100 seed × 100 年测出来；没有 harness 就是在盲调。
4. **它把地图从 5 区扩到 14 区**，是唯一会让性能预算翻倍的改动（见 4.5）。必须在 M5 性能基线稳定后再动。
5. **GDD 的 MVP 定义（§18）明确不含战争**；把它写进 16 周承诺就是范围失控。

### 4.5 性能再预算（必须拍板的账）

| 规模 | 市场循环次数 | 预估 100 年耗时 | 对 2 s 预算 |
|---|---:|---:|---|
| 5 区 × 4 商品 × 10 组织 | 200 | 1.4–1.7 s | ✅ |
| 14 区 × 6 商品 × 30 组织 | 2,520 | 3.5–4.5 s | ❌ 超 2 倍 |

**三个选项**：

- **A. 修订预算**：5 区 < 2 s、14 区 < 3.5 s（承认规模变了，预算按实体数分摊）。成本 0，但"100 年 < 2 s"这条对外承诺要改口。
- **B. L3 聚合**：非邻国地区只保留"价格指数 + 供需缺口"两个标量，月结不逐商品算。成本 4 人日，收益约 40%，风险是指标粒度下降。
- **C. 降频**：远端地区改为季结。成本 1 人日，收益 30%，风险是 R2 等价性要重新证明（季结与快进的边界处理）。

**建议**：B + A 组合——先做 B（4 人日），仍超则把预算改成"≤ 2 s @ 5 区 / ≤ 3 s @ 14 区"。这条必须在 M6 第一周决定，不能等到 W17。

---

## 5. post-1.0 展望

| 方向 | 价值判断 | 成本量级 | 前置 |
|---|---|---:|---|
| **内容包 / mod 式 JSON** | 最高性价比：游戏长尾完全取决于内容，而引擎已经是数据驱动的 | 8–10 人日（导入校验 + 冲突检测 + 版本协商） | 内容 schema 冻结（M6 后） |
| **本地化框架** | 打开非中文市场；但 18,000 字文本的翻译与校对是持续成本 | 6 人日代码 + 翻译人力 | `EventDef.text` 改为 `textKey`（破坏性，需 v4 迁移） |
| **桌面封装（Tauri/Electron）** | 解决 `file://` 的 IndexedDB 与存档路径问题，顺带进 Steam；原生移动端同源，收益低于内容 | 5 人日（移动端原生壳 +10） | 无 |
| **地图/事件编辑器** | 只在前两项成立后才有价值；自用价值 > 对外价值 | 25–30 人日 | mod 格式稳定 |
| **异步多人交易** | 与"单机"定位冲突，且需要服务器与反作弊；不建议做 | 25+ 人日 + 运维 | 命令日志 + 回放（当前没有） |

**排序建议**：mod 格式 → 桌面封装 → 本地化 → 编辑器 → 其余不做。

---

## 6. 横切关注点

### 6.1 存档兼容策略

| 层 | 版本 | 规则 |
|---|---|---|
| `SAVE_FORMAT_VERSION` | 1 | 信封结构；只在信封字段变化时 +1（如加签名） |
| `SCHEMA_VERSION` | 2 → 3（M4）→ 4（M5 城市/设置）→ 5（M6 战争） | 世界状态形状；**只增不改**，新字段必须有默认值。v2→v3 补 `Character` 的 `sex/birthYear/generation/familyId/parentIds/spouseId/attributes/alignment/faith/location/homeRegionId/offices`（见 §2.0.1） |
| `CONTENT_VERSION` | 0.1.0 → 0.3.0（M3）→ 0.4.0（M4）→ 0.9.0 → 1.0.0 | 内容变更；不匹配时**警告不拒绝**（事件 ID 变了会导致旧档引用悬空，由 `audit` 兜底） |

- 迁移注册表：`MIGRATIONS: Record<number, (raw) => raw>`，逐级上推，禁止跳级。
- 迁移后丢弃旧哈希：`parseSave` 在"发生过迁移"分支跳过 `hash` 比对，并在信封写 `migratedFrom`。
- 夹具：`tests/fixtures/saves/v2-minimal.json`、`v2-demo.json`、`v3-city.json`；每次升版必须新增一个真实导出档。
- 只读兼容：新版本必须能读旧档，**旧版本不要求读新档**（明确写进 README）。

### 6.2 内容流水线

```text
content/*.json
  → tsc（EventDef 类型即编译期 schema）
  → scripts/audit-content.ts（引用 / 路径白名单 / 链深 / 文本长度 / 数值区间）
  → tests/events.test.ts（R8：全部事件可被至少一个实体触发）
  → pnpm build → release/index.html
```

- 不引入 `ajv`：`EventDef` 已是 TS 类型，JSON 的 `as unknown as` 只在 `content/index.ts` 一处；再加一个运行时 schema 库会让"唯一装配器"变成两个校验源。**权衡**：外部 mod 进来时（post-1.0）再加 JSON Schema，因为那时内容不再经过 tsc。`audit:content` 进 CI 作为独立步骤（`pnpm audit:content`），失败即红。

### 6.3 测试金字塔（R1–R8 扩展到 R14）

| 编号 | 内容 | 文件 | M4/M5/M6 扩展 |
|---|---|---|---|
| R1 | 同种子 100 年哈希稳定 | `simulation.test.ts` | 加"含出生/死亡"的 200 年双跑 |
| R2 | 逐日 vs 快进等价 | `fastforward.test.ts` | 加 `stopAtChoices:false` 的含抉择世界 |
| R3 | 存档往返与损坏拒绝 | `fastforward.test.ts` | 加 `pendingChoice` 非空往返 |
| R4 | 破产流程无负资产残留 | `organization.test.ts` | 加战争赔款导致的破产 |
| R5 | 政策变更不违反政体约束 | `country.test.ts` | 加 5 种政体的策略表 |
| R6 | 事件互斥组不双发 | `events.test.ts` | 加链式事件与父事件互斥 |
| R7 | 死亡不产生资产/职位重复 | `organization.test.ts` | **强化**：股份和 = 1、官职唯一、遗产守恒 |
| R8 | 内容 schema 与引用校验 | `events.test.ts` | 拆出 `audit-content` 单测 |
| **R9**（新） | 人口学与人物档案不变量 | `character-lifecycle.test.ts` + `character-model.test.ts` | 出生/死亡/婚配/上限；属性 1–20、九宫格边界、信仰 null、地点合法 |
| **R10**（新） | 关系与记忆 | `relations.test.ts` | 衰减、裁剪、拒绝率 |
| **R11**（新） | 事件链因果完整 | `chains.test.ts` | 链深、概率、`eventLog` 裁剪 |
| **R12**（新） | 抉择幂等与原子性 | `choices.test.ts` | 成本不足不改状态 |
| **R13**（新） | 内容审计脚本自身 | `audit-content.test.ts` | 故意坏内容必须报错 |
| **R14**（新） | 战争结算守恒 | `war.test.ts` | 兵力/士气/割地/赔款 |

目标：M4 结束 ≥ 90 例，M5 结束 ≥ 110 例，M6 结束 ≥ 130 例；`core`/`systems` 行覆盖 ≥ 80%。

### 6.4 可观测性（`sim` 报告新增指标）

```
人口    存活 62 / 总数 148 / 世代 4 / 出生 96 / 死亡 54 / 婚配 31 / 遗产 41 起
生涯    有官职 7 人 / 平均等级 2.4 / 交叉路径 5 人（商→政 3，兵→政 2）
叙事    事件 214 条 / 链式 71 条（33%）/ 平均链深 1.7 / 截断 3 次 / 抉择 58 次
关系    关系边 187 / 负向 62 / 平均 |value| 24
历史    条数 6,412 / 序列化 512 KB / hash 22 ms
绩效    100 年 1.83 s / 月结 1.1 ms / 年结 9 ms
战争    （M6）战争 6 场 / 会战 23 场 / 平均 3.8 场/战 / 割地 4 区
```

`scripts/sim.ts` 增加 `--json` 输出，供 `batch-sim` 直接汇总；人类可读版保持现有格式，追加上述行。

### 6.5 技术债清单

**必须先做（M4 前置，否则会返工）**

| # | 债 | 证据 | 代价 |
|---|---|---|---|
| 1 | `WorldState.history` 无上限 | `History.append` 只 push；100 年预估 8k–20k 条 | 存档 2 MB、hash 变慢、UI 卡；M4.6 做分级保存（`tier: 1\|2\|3` + 年结折叠 finance/trade） |
| 2 | 引擎无事务回滚 | `GameEngine.settleDay` 无 try/catch；开发计划 §M1 声称有回滚 | 任一系统抛错 → 半更新状态 + 快进中断；至少给 `dispatch` 加回滚，结算异常标记 `state 损坏` 并停表 |
| 3 | 迁移只有 v1→v2 且无真实夹具 | `Migration.ts` 的 `MIGRATIONS` 只有一条 | 每次升版都可能悄悄丢字段；M4.6 补 v2 夹具 |
| 4 | `races.json` 未装配 | `content/index.ts` 无 import | 寿命/种族特质全是死数据 |
| 5 | `mortalityRisk` 忽略种族 | `CharacterSystem.ts` 固定曲线 | 精灵与人类同寿，世界观失真 |
| 6 | `Date.now()` 未被 lint 拦截 | `eslint.config.js` 只拦 `new Date()` | 时间泄漏进模拟 → 不可复现；补 `MemberExpression` 规则 |

**可以后做**

| # | 债 | 何时 |
|---|---|---|
| 7 | 事件文本内联中文、无 key | 本地化时（post-1.0） |
| 8 | UI 面板全量重绘 | 帧时间超 16 ms 时再改增量 |
| 9 | 无命令日志/回放 | 做多人或 bug 复现时 |
| 10 | `Polity` 硬编码 2 种 | M6.2 自然扩 |
| 11 | 无 JSON Schema | 接外部 mod 时 |
| 12 | 存档不压缩 | 超过 1 MB 时（`CompressionStream` 或简单 RLE） |

---

## 7. 风险登记册

| # | 风险 | 影响 | 概率 | 缓解 | 触发信号 |
|---|---|---|---|---|---|
| 1 | 世代系统让 100 年模拟超 2 s | 高 | 中 | 人口上限 160；只对 L2 人物做婚配；年结批量抽样 | `sim` 耗时 > 2.0 s 或人口 > 160 |
| 2 | 抉择暂停破坏快进等价（R2） | 高 | 中 | `stopAtChoices` 默认 false；批量用固定 `choicePolicy`；R2 用例显式覆盖 | R2 在含抉择世界上哈希不一致 |
| 3 | `history` 膨胀导致存档 2 MB+ | 高 | 高 | M4.6 分级保存 + 年结折叠；目标 ≤ 8,000 条 | 序列化 > 800 KB 或 > 100 ms |
| 4 | v2→v3 迁移丢字段，旧档打不开 | 高 | 中 | 真实存档夹具 + `validateWorld` 兜底 + 迁移后跳过旧哈希 | 迁移后 `validateWorld` 非空 |
| 5 | 人口灭绝（出生率 < 死亡率） | 高 | 中 | 出生率 0.16/年、死亡曲线分段；`batch:sim` 监控 `alive` | 100 年 `alive < 40` |
| 6 | 人口爆炸（继承让财富集中、出生率失控） | 中 | 中 | 上限 + 出生率二次衰减 + 遗产税 | `alive > 120` 或基尼 > 0.75 |
| 7 | 事件链爆炸导致历史噪声 | 中 | 中 | 链深 ≤ 4、每链 ≤ 3 步、每月后续入队 ≤ 12 | `eventLogDropped` 快速增长 |
| 8 | 城市视图与 `Region` 模型冲突 | 中 | 中 | 独立 `districts` 表，不复用 `Region` | 迁移后 `RegionDef` 需要可变字段 |
| 9 | `file://` 下 IndexedDB 不可用 → 存档丢失 | 高 | 中 | 降级链 + 强制导出提示 + 逐浏览器矩阵 | 某浏览器 `storageAvailable()` 返回 false |
| 10 | 1.5 MiB 预算（美术/SVG 膨胀） | 中 | 低 | 预算表 + 内联 SVG ≤ 120 KB；禁止位图 | `pnpm release` 体积 > 60% 预算 |
| 11 | M4 范围膨胀（单人开发） | 高 | 高 | 子迭代可独立交付；每 2 周一次可玩检查点 | 任一子迭代超 8 人日 |
| 12 | 七国扩展使性能翻倍 | 高 | 高 | L3 聚合 + 预算修订（§4.5） | 14 区 100 年 > 3 s |
| 13 | 战争让经济指标不可读 | 高 | 中 | 战争频率先校准到 1/15–25 年；战时指标单独分组 | 破产率方差 > 2 倍 |
| 14 | 数值漂移（多参数同时调） | 中 | 高 | 一次只改一个参数族 + 校准日志 | 两次提交指标变化 > 20% 且无记录 |

---

## 8. 对 M3 的接口要求

M3 收尾时按此清单对齐，**M4 不修改 M3 已冻结的字段名**。

### 8.1 字段（`Country` / `WorldState`）

| 字段 | 状态 | M4 用途 | 要求 |
|---|---|---|---|
| `Country.policies: PolicyVector` | 已有 | 官职影响力作用于政策 | 五字段名不重命名 |
| `Country.diplomacy: Record<CountryId, number>` | 已有 | 战争 `casusBelli`、外交事件 | 保持 -100..100 |
| `Country.legitimacy` / `stability` | 已有 | 继承危机链、政变事件 | 保持 0–1 |
| `Country.rulerId` | 已有 | 统治者死亡触发继承 | 允许由 `handleDeath` 改写 |
| **`Country.offices`** | **新增** | 政治家路径的落点 | `{ id, title, holderId, influence, salaryMonthly }[]`；`holderId` 必须在 `characters` 中 |
| **`Country.succession`** | **新增** | 继承规则（长子/选举/议会） | `'primogeniture' \| 'elective' \| 'council'` |
| **`Country.courtPressure`** | **新增（可选）** | 政策提案的派系压力 | 0–1 标量，`runPolicyRound` 读取 |

### 8.2 事件

| 要求 | 说明 |
|---|---|
| 8 条国家事件 ID 冻结 | `ev_country_*` 不得改名；M4 的 `followUps` 会引用 |
| 新增 `ev_country_succession_crisis` | 统治者死亡且无合法继承人时触发；M4 继承链的入口 |
| 新增 `ev_country_office_vacant` | 官职空缺；`seek_office` 的时机来源 |
| 政策变更必须写历史 | `kind: 'policy'`，`refs: [{ type: 'country', id }]`，`causeEventId` 可空 |
| 事件 `scope` | 国家事件一律 `scope: 'country'`，不得用 `region` 代替 |

### 8.3 API

| 接口 | 现状 | M4 需要 |
|---|---|---|
| `evaluatePolicyPressure(state, countryId)` | 已导出 | 保持纯函数、无副作用 |
| `runPolicyRound(state, ctx, day, config?)` | 已导出（第 4 参已被 `config: PolicyConfig` 占用） | 增加**第 5 参** `influence?: number`（0–1），并透传给 `policySupport(state, country, influence = 0)`；默认 0 时行为与现在完全一致（保证 M3 回归不变） |
| `capitalWeight(state, countryId)` | 已导出 | 不变 |
| `settleMonthlyCountry(...)` | 返回 `{ countryId, balance, debtAfter }[]` | 增加 `legitimacyDelta`、`stabilityDelta`，供 M4 事件读取 |
| `handleDeath(state, characterId)` | 在 `CharacterSystem.ts` | M3 不要在此函数里加国家逻辑；继承规则由 M4.1 接管，M3 只提供 `succession` 字段 |

### 8.4 必须由 M3 修掉的问题（否则 M4 阻塞）

1. **同盟 grain/iron 长期顶价**（`README` 已列）：M4 的"饥荒链"以 `market.price / market.ceiling > 0.9` 为条件，顶价会让该链**永真**，事件洪水。M3 必须把三 seed 的 `priceDeviation` 压到 35% 以内。
2. **政策抖动**：100 年政策变更 8–25 次是 M5 的校准目标带；若 M3 结束时 > 40 次，M4 的"政策→生涯"路径会失去意义。
3. **`contentVersion` 升到 `0.3.0`**：M4 存档会记录 `contentVersion`，跨版本只警告不拒绝，但需要一个明确的基线值。

### 8.5 冻结清单（M3 交付时签字）

- [ ] `Country` 字段名与类型不再变化（除 §8.1 新增）
- [ ] 8 条国家事件 ID 与 `scope` 冻结
- [ ] `runPolicyRound` 增加可选 `influence` 参数，默认行为不变
- [ ] `pnpm sim --years 100` 的 `priceDeviation` ≤ 35%
- [ ] `tests/country.test.ts` 覆盖 5 种政策字段的全部边界
- [ ] `CONTENT_VERSION = 0.3.0`

---

## 附录 A · 术语与 ID 约定

| 项 | 约定 |
|---|---|
| ID | 人物 `c_<name>` / 新生 `c_gen_NNNN`（不复用）；家族 `fam_<seatRegion>_<n>`；事件实例 `ei_NNNNNN`（由 `eventSeq` 单调生成）；官职 `off_<country>_<title>`；战争 `war_NNNN`（由 `warSeq` 生成） |
| 金额 | 整数铜币；`Math.round` 只出现在结算边界，且必须可复现 |
| 指标 | 0–1 浮点；展示层乘 100 |
| 时间 | 只存 `day`（1 起）；`age` 在年结 +1，`age === currentYear - birthYear` 为不变量 |

**变更记录**：v1.0（2026-11-19）初版——M4 六子迭代、M5 校准、M6 战争、横切与风险、M3 接口清单。

---

## 附：本文档与既有文档的关系

- 玩法定义以 `design.md` 为准；本文不重新定义"应该发生什么"，只定义"先做哪一块、做到什么程度算完成"。
- 架构铁律以 `development-plan.md §4` 为准；本文所有新增模块都遵守五条铁律。
- 本文与 `development-plan.md §8` 的差异（M4 15 → 30 人日、M5 15 → 22 人日、新增 M6 32 人日）是**重新计价**，不是范围扩张：M4 的增量全部来自已确认的三个缺口（世代、链、抉择）。
- 下次修订时机：M4.3 结束（重新校准 M5 的 UI 工作量）与 M5.3 结束（用真实批量数据回填 §3.1 的目标带）。
