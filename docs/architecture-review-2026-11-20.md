# 代码结构评审（2026-11-20，对应 v2.0.0）

> 目的：回答两个问题——**① 现在的代码结构是否合理？② 文档说明与代码是否匹配？**
> 方法：全仓库静态核对（`read` / `grep` / `glob`），逐个模块看 import 边、文件行数、导出与调用方。
> **限制**：本次评审环境无法执行 `bash`（Git Bash 沙箱后端不可用，命令未启动即被拒绝），
> 因此 `tsc --noEmit`、`vitest run`、`pnpm build` 均未复跑；所有结论来自源码与配置的静态事实，
> 数字（文件数、行数、用例数、字节数）均以仓库内文件为准。

## 1. 结论摘要

**结构总体合理，分层是真的落地的，不是口号。** 五条铁律里最关键的两条（依赖单向、单一写入口）
有 ESLint 强制 + 代码事实双重支撑；七个业务域按域分目录，域间只有 13 条单向依赖、**没有跨域循环**；
状态是可序列化的纯数据，随机走命名流，因此 32 个测试文件可以做到「同种子必同哈希」。

同时存在 **6 处值得整改的结构问题**，按严重程度排序：
1 处是真实的依赖方向破例（`systems → content`），2 处是「文档说法与代码事实不符」
（`ui → systems` 的只读引用、`core` 的实际职责比名字更大），2 处是文件过大影响可维护性，
1 处是纯死代码。**没有一处是架构性错误**——不需要重写，只需要局部调整与拆分。

| # | 问题 | 严重度 | 建议 |
|---|---|---|---|
| ① | `systems/country/PolicySystem.ts` 唯一一处 `systems → content` 依赖（默认参数） | 中 | `runPolicyRound` 改为必填 `config`，调用方传 `content.balance.policy`；ESLint 补 `content` 规则 |
| ② | `ui → systems` 10 个文件的只读引用，让「UI 只经 GameEngine」名不副实 | 中 | 推荐把它写进铁律当既定例外（下沉到 `ui/` 反而会扩大反向依赖，见 §4.2） |
| ③ | 6 个超大文件（`WorldState.ts` 1431 行等） | 中 | 按「类型 / 构造 / 查询 / 哈希校验」拆；优先拆 `CommandBus.applyCommand` |
| ④ | `core` 实为 application 层（`GameEngine` 编排 14 个系统），命名与 GDD §17.1 的「Simulation Core」错位 | 低 | 文档写清「core = 状态内核 + 编排层」，不改目录 |
| ⑤ | `systems/character/SkillCheck.ts` 零引用死代码 | 低 | 删除，或接进 `Check.ts` 的对抗检定 |
| ⑥ | `Chronicler.entityNames()` 的缓存失效键是「人物数量」 | 低（真 bug 隐患） | 缓存键加内容指纹，或改用 `state` 版本号 |

## 2. 分层现状（实测依赖矩阵）

`src/` 的实际分层与依赖方向（箭头 = import 方向）：

```text
main.ts ──► ui ──► core ──► systems ──► core(类型/工具)
             │                  └──► content   ← 仅 1 处（PolicySystem）
             └──► storage ──► core(WorldState/Migration)
```

逐条证据：

| 边 | 条数 | 证据 |
|---|---|---|
| `core → systems` | 15 条 import 语句 / 14 个模块 | `GameEngine.ts:43-65`（六相位编排）、`EventEngine.ts:16`（`rollCheck`）、`CommandBus.ts:34-59`（10 个结算函数） |
| `systems → core` | 几乎全部 30 个文件 | 只有类型、`sortedIds`、`marketKeyOf`、`buildCharacter`、`neutralAttributes`、`formatDate`、`DAYS_PER_YEAR`、`readFeature` —— **都是纯函数与类型，没有反向写状态** |
| `systems → systems` | 13 条 | 见下节，全部单向 |
| `systems → content` | **1 条** | `PolicySystem.ts:25` |
| `ui → core` | 预期内 | `App.ts` 取 `GameEngine`/`CommandBus`/`GameClock`/`EventEngine` 纯函数 |
| `ui → storage` | 预期内 | `App.ts`、`SaveDialog.ts` 用 `SaveManager` 槽位与导入导出 |
| `ui → systems` | **10 个文件** | 见 §4.2 |
| `core/systems → ui` | **0 条** | `grep` 全无匹配 |

### 2.1 域间依赖（`systems → systems`，13 条，无环）

```text
goals/Goals    → character/Career, character/Activity, country/Offices, organization/Shares, organization/Organization
goals/Ambition → country/Offices
character/CharacterSystem → organization/Organization, country/Ruler
character/Retire          → country/Ruler, organization/Organization
organization/Finance      → character/SkillEffects
military/WarSystem        → character/Character
economy/TradeSystem       → economy/MarketSystem
country/PolicySystem      → country/Ruler
organization/ContractSystem → organization/Lifecycle (type)
organization/OrganizationSystem → organization/OrganizationRisk, organization/Lifecycle
```

这个形状是**健康的**：`goals` 是唯一横切域（只出不进），`character` 是基础域（被军事/组织/goals 引用），
`country` 的 `Ruler` 是继承逻辑的唯一出处。**没有任何跨域循环**，这在大仓库里很少见，值得保持。

### 2.2 铁律核验

| 铁律 | 状态 | 证据 |
|---|---|---|
| `core`/`systems` 不依赖 UI 与存储 | ✅ 成立 | `eslint.config.js:44-57` 的 `no-restricted-imports` + 代码零匹配 |
| 单一写入口 `GameEngine.dispatch` | ✅ 成立 | 所有状态变更经 `dispatch → applyCommand`（`CommandBus.ts:193`），UI 侧 `engine.state` 只读 |
| 随机唯一来源 | ✅ 成立 | `eslint.config.js:61-75` 禁 `Math.random`；`Random.ts` 命名流（`stream:entityId:periodKey`） |
| 遍历按稳定 ID 排序 | ✅ 成立 | `sortedIds()`（`WorldState.ts:1418`）在 30 个系统里被普遍使用 |
| 时间唯一入口 `GameClock` | ✅ 成立 | 禁 `new Date()`（`eslint.config.js:73`）；`Date.now()` 仅 3 处且在 UI（存档时间戳） |

**额外发现（文档 §5.2 #14 的准确边界）**：ESLint 只拦 `NewExpression[callee.name='Date']`，
**不拦 `Date.now()`**。实际存在 `src/ui/App.ts:886`、`src/ui/SaveDialog.ts:52,190`——都在 UI 层做存档时间戳，
不破坏确定性（模拟本身不用真实时间），但规则与文档描述的「禁一切真实时间」有偏差，已在 `development-plan.md` §5.2 #14 记明。

## 3. 结构优点（不建议动的地方）

1. **`WorldState` 是纯数据 + 纯函数**，`cloneWorld`/`hashWorld`/`stableStringify`/`validateWorld` 都在同一文件，
   这让「存档 = JSON」「确定性 = 哈希」两件事都变成一句话能验证的断言。
2. **业务系统全部是 `(state, ...) => void` 形式的纯结算函数**，没有 class 状态、没有单例、没有事件总线。
   这是 32 个测试文件能跑在 3 秒内的根本原因。
3. **`content/` 只有一个装配器** `index.ts`（15 条 JSON import），其余代码只 import `content`，不 import 具体 JSON。
   内容校验（R8）虽然还缺独立用例，但结构上是对的。
4. **UI 零框架、零 runtime 依赖**（`package.json` 无 `dependencies`），`dom.ts` 85 行自建 `el/button/svgEl`。
   单文件产物 368 KB 而不需要框架 runtime，这个取舍是对的。
5. **`CommandBus` 的 `Command` 是可辨识联合**（33 种 `kind`，`CommandBus.ts:68-139`），
   `describeCommand` 能把它翻成人话——这条设计让「玩家卡片上的按钮」与「历史记录文本」共用一套词汇。
6. **`Migration.ts` 有真实迁移链**（`migrateV1`…`migrateV8`，351 行）与 8 个用例，
   包括「v1 一路迁到 v9」「迁移后 hash 失效」「更高版本拒绝」——存档兼容不是 PPT。

## 4. 待整改项（逐条给证据与改法）

### 4.1 ① `systems → content` 的唯一例外

```ts
// src/systems/country/PolicySystem.ts:25
import { content as defaultContent } from '../../content';
// :256
export function runPolicyRound(state, ..., config: PolicyConfig = defaultContent.balance.policy)
```

- **为什么算问题**：`systems` 层本应只接受调用方传进来的数值，一旦自带 `content` 默认值，
  这个函数就不再是「纯函数」，也让 `systems` 的依赖方向出现了一条通往 JSON 的捷径。ESLint 拦不住它
  （`eslint.config.js:44-57` 的 group 只有 `@/ui/*`、`@/storage/*`），所以只能靠约定。
- **改法**（10 行内）：把 `config` 改为必填，`GameEngine.onCountryPhase` 与 `scripts/sim.ts` 两处调用点传
  `this.content.balance.policy`；然后给 ESLint 的 `no-restricted-imports` group 补 `'**/content'`、
  `'@/content'`，把这条规则变成机器可查。
- **代价**：`tests/policy.test.ts` 的 6 个用例要各加一个参数（或者加个 `makePolicyConfig()` 夹具）。

### 4.2 ② `ui → systems` 的 10 个文件（只读纯函数）

| UI 文件 | 引用的系统函数 | 性质 |
|---|---|---|
| `CreateCharacterDialog.ts:8-9` | `CharacterCreator.TALENT_PICKS/TALENT_TAGS` | 常量表 |
| `CountryPanel.ts:7` | `Offices.officeIdOf/officeSeatsFor` | 纯查询 |
| `CharacterCard.ts:10-13` | `Profile.alignmentCell/alignmentLabel`、`Career.careerTitle`、`Relations.RELATION_LABELS/relationsOf`、`SkillEffects.skillEffectSummary` | 纯展示 |
| `PlayerPanel.ts:12,19,24,25` | `Profile`、`Career`、`SkillEffects`、`goals/Ambition.ambitionOf/chapterOf` | 纯展示 |
| `RegionPanel.ts:12-13` | `Offices`、`SkillEffects.purchaseFactor/saleFactor/tradeCarryCapacity` | 纯展示 |
| `ArmyPanel.ts:5` | `WarSystem.isAtWar` | 纯谓词 |
| `OrganizationPanel.ts:9-10` | `Organization.valuation`、`Shares.canClaimLeadership/unassignedShare` | 纯查询 |
| `SuggestionsPanel.ts:10` | `goals/Goals.suggestGoals` | 纯计算 |
| `App.ts:20,24` | `goals/Ambition`、`character/Check.describeCheck` | 纯展示 |

- **为什么算问题**：`development-plan.md` §5.3 原本写「`ui → core, storage`」，实际是 4 个目标。
  不是架构错误（**零写操作**），但「UI 只经 GameEngine 取数据」这句话现在是半真的：
  状态确实只经 `engine.state`，而「怎么把状态翻译成人话」这条路直连 `systems`。
- **两条改法，选一条**：
  - **A（保守，推荐）**：承认它是对的。在 `development-plan.md` §4 铁律里补一句：
    「`ui` 可以只读引用 `systems` 的纯展示函数（不得调用会写 `state` 的函数）」，
    并给 ESLint 加一条自定义约束的替代方案——把「只读」写在每个被引用函数的 JSDoc 里。
  - **B（彻底）**：新建 `src/ui/derive.ts`，把这些格式化/派生函数搬过去（它们本来就只依赖 `state` 与类型），
    `systems` 不再被 UI import。代价是 `CharacterCard`/`PlayerPanel`/`RegionPanel` 的 import 全改一遍，
    约 10 个文件、200 行搬移，且 `Goals.suggestGoals` 依赖 `Career/Offices/Shares` 的计算——
    搬过去会让 `ui` 反向依赖更多 `systems`，**反而更差**。所以推荐 A。

### 4.3 ③ 六个超大文件

| 文件 | 行数 | 内容构成 | 拆分建议 |
|---|---|---|---|
| `src/core/WorldState.ts` | **1431** | 类型定义 + `createWorld` + 构造工具 + 查询谓词 + `hashWorld`/`validateWorld`/`cloneWorld` | 拆 `world/types.ts`、`world/create.ts`、`world/query.ts`、`world/hash.ts`；`index.ts` 再导出，外部 import 不变 |
| `src/core/CommandBus.ts` | **1173** | `Command` 联合（33 种）+ `applyCommand` 巨大 switch（:199-1016）+ `describeCommand`（:1104-1170）+ `regionHasPath` | 按域拆 `commands/{org,person,military,office}.ts`，`applyCommand` 只做分发 |
| `src/core/EventEngine.ts` | **967** | 候选收集 + 条件编译 + 互斥竞速 + 效果结算 + 后续排程 | 拆 `events/{collect,resolve,schedule}.ts` |
| `src/ui/App.ts` | **971** | 布局 + 事件绑定 + 模态管理 + 自动存档 + 快进循环 | 拆 `App.ts`（装配）+ `app/{toolbar,modals,autosave}.ts` |
| `src/systems/character/Demography.ts` | **702** | 出生/死亡/婚姻/迁移/关系 | 拆 `demography/{birth,death,marriage,migration}.ts` |
| `src/ui/MapView.ts` | **674** | SVG 地图 + 交互 + tooltip | 拆 `map/{render,pick,tour}.ts` |

- **为什么算问题**：这 6 个文件里有 3 个是「一个函数里 800 行 switch」。
  `applyCommand` 的 33 个分支共享一个 `state` 与出错返回约定，拆开后**入参与返回值完全不变**，
  属于低风险高收益的重构（也是唯一能让人愿意 review PR 的前提）。
- **不建议现在动**：没有测试回归保护的重构不应与功能改动同批。`applyCommand` 建议先补
  「每个 kind 至少一条命令级用例」再拆（现在有 8 个文件覆盖命令，但不齐）。

### 4.4 ④ `core` 的命名与职责

`GameEngine.ts:43-65` 一次性 import 14 个系统函数并在六个 `on*Phase` 里编排它们。
按常见分层术语，它更接近 **application/service 层**，而 GDD §17.1 说的「Simulation Core」是更薄的东西。

- **不建议改名/搬家**：改名的成本远大于收益，且 `core` 里确实放着「状态 + 时钟 + 随机 + 历史」这些内核。
- **建议**：在 `development-plan.md` §4 的分层图旁写一句
  「`core` = 状态内核（`WorldState`/`Random`/`GameClock`/`History`）+ 编排层（`GameEngine`/`CommandBus`/`EventEngine`）」，
  让读代码的人不困惑。

### 4.5 ⑤ `SkillCheck.ts` 死代码

```text
src/systems/character/SkillCheck.ts  (89 行)
  export function skillCheck(rng, options)     :33
  export function opposedCheck(rng, a, b, ...) :57
```

`grep` 全仓库（`src/` + `tests/`）：**零引用**。只有 `development-plan.md` §5.3 与 `docs/roadmap-m4-plus.md`
把它当「M4 骨架」提到。实跑走的是 `Check.ts` 的 d20（`EventEngine.ts:958`）。

- **选择**：要么删除（推荐，M4 的 2d6 方案已被 d20 取代），要么在 roadmap 里明确它是「未接入的实验代码」
  并移到 `src/systems/character/.experimental/`（但那会进构建）。
- 若保留，至少让 `Chained checks` 用它：`opposedCheck` 恰好能表达「谈判对抗」这类双人检定，
  目前是 `rollCheck` 单边判定。

### 4.6 ⑥ `Chronicler` 缓存失效键

```ts
// src/core/Chronicler.ts:18
const nameCache = new WeakMap<WorldState, { count: number; names: Map<string, string> }>();
// :23-31 失效条件：state.characters 的数量变化
```

- **场景**：某人物被改名（或 `createPlayer` 重建同 id 的人物）而总人数不变 → 读到旧名字表。
- **影响**：编年史文本里出现旧名，不影响模拟数值，属于文案级 bug。
- **改法**：缓存键改为 `Object.keys(state.characters).length + ':' + (state.playerId ?? '')`，
  或干脆在 `record()` 里每次重建（12,000 条历史的开销是毫秒级，`composeChronicle` 本身只做字符串替换）。

## 5. 文档与代码的匹配（本轮已落地的修改）

本轮把「文档说 A、代码是 B」的地方全部对齐。**改动原则**：
- **当前状态型陈述**（「现在有几个文件/多少用例/多少字节」）→ 一律改为代码实测值；
- **阶段记录型陈述**（§8.x 各阶段当时写了什么）→ **保留原样**，因为它是历史快照；
- **设计意图文档**（`design.md` GDD）→ **不改正文**，只在文首加「实现进度见 README」的指引。

### 5.1 逐份文档的修改

| 文档 | 改了什么 |
|---|---|
| `README.md` | 全篇重写对齐 v2.0.0：`core` 8→**9** 个模块（补 `Chronicler`）、`systems` 14→**30** 个文件 7 域（补 `goals/`）、`ui` 12→**20** 个 `.ts`；测试 26/177、16/121、29/194 三种互相矛盾的口径统一为 **32 文件 / 201 例**；产物 353,647 / 363,804 → **368,416 字节（23.4%）**；`pnpm sim` 1.4–1.7 s → **3.66–3.89 s**；测试表 14 行 → **32 行**（`migration` 的「5 例、v1→v4」→「8 例、v1→v9」）；里程碑段落按 M0→M7 时序重排（原先 M6.2 在 M6.1 之前、M7 阶段 4/5/6 只有标题）；`存档版本链 v1→v7` → **v1→v9**；修正把「§5.2/§8.1」错挂到 `roadmap-m4-plus.md` 名下的链接 |
| `development-plan.md` | 头部 v0.2→**v0.3** 并加修订记录；§1.1 现状全段改实测（9 模块 / 30 文件 7 域 / 7 国 14 区 21 组织 54 人物 90 事件 / 32 文件 201 例 / 368,416 字节 23.4%）；§3 `TypeScript 5.x`→**6.x**、组件 15→20、5 城→14 区；§4.1 mermaid 的 `UI→CommandBus→GameEngine` 方向**画反了**，改为 `UI → engine.dispatch → applyCommand`，删掉并不存在的 `SNAP` 节点；§4.3 数据流改为 `hash()` + `App.refresh()` 轮询（`snapshot()`/`subscribe()` 确实不存在，原注记正确但「属于 M5 的工作」已过期）；§5.1 目录树整棵重写（core 9 / systems 30 / content 补 `faiths`+`backgrounds`+`names`+6 个 events / ui 20 / tests 32 / release 368,416）；§5.2 偏差表 **15→18 行**（#8 `choices` 已实现、#12 WarSystem 568 行含会战围城、#13 ui 20 文件、#15 M2–M7 全完成、新增 #16 `systems→content`、#17 `ui→systems` 10 文件、#18 Chronicler 归属与缓存问题）；§5.3 模块表补全 30 个系统与真实导出；§7.9 `formatVersion` 1→**9**、`SCHEMA_VERSION` 1→**9**、「没有迁移链」→ `migrateV1…V8` + 8 例覆盖；§8.1 标题改 v2.0.0 并**新增 M7 一行**；§9.2 测试映射 5 文件 33 例→**32 文件 201 例**、R4/R5/R7 由 ⚠️ 改 ✅、R8 保持 ❌（断言 21 组织/54 人物/≥22 事件）；§9.3 性能断言 `< 5000 ms`→**实际 `< 8000 ms`**；§13 口径 v0.2→v2.0.0；结尾「下一步（v0.2 实际）」→**v2.0.0 之后**的五条待办；**章节结构修复**：§8.30–§8.39 原本被插在 §9 标题之后，现回到 §9 之前并明示「倒序记录，最新在前」 |
| `docs/acceptance.md` | 加文件头说明「§1–§17 为各阶段快照，当前口径见 §18」；§0 复跑命令 15/109→**32/201**；§16 的 `SCHEMA_VERSION 8`→**9**（并注明当时误记）；§17 的 26/177、353,647 标注为快照；**新增 §18「当前口径（v2.0.0 最终）」**表：四版本常量、内容规模、代码规模、32/201、确定性、性能（含 `< 8000 ms` 断言位置）、368,416 字节、迁移 v1→v9 8 例、仍缺项 |
| `design.md` | 正文 2107 行**一字未动**（它是设计意图，不该按实现进度改写）；仅在文首加一行 blockquote：实现进度见 `README.md`/`development-plan.md`，验收数字见 `docs/acceptance.md`，结构审计见本文档 |
| `docs/roadmap-m4-plus.md`<br>`docs/redesign-v2.md`<br>`docs/growth-travel-design.md`<br>`docs/playtest-2026-11-20.md` | **未改**。前两份是历史规划/设计档（改了反而篡改历史）；`growth-travel-design.md` 的 P1–P3 与代码一致；`playtest` 是某次试玩的现场记录，其中的数字是那一刻的事实 |

### 5.2 三个版本常量的现状（文档里最容易写错的地方）

| 常量 | 位置 | 值 | 以前文档写错成 |
|---|---|---|---|
| `CONTENT_VERSION` | `src/content/index.ts:36` | `'0.7.0'` | `'0.1.0'` |
| `SAVE_FORMAT_VERSION` | `src/storage/Migration.ts:23` | `9` | `1`（§7.9）、`6`（§5.3） |
| `SCHEMA_VERSION` | `src/core/WorldState.ts:25` | `9` | `1`、`8`（acceptance §16） |
| `version` | `package.json` | `2.0.0` | `1.0.0`（§13） |

## 6. 仍未解决（明确不属本次范围）

1. **R8 内容校验**：`development-plan.md` §9.2 唯一还挂 ❌ 的一项。现在 `tests/simulation.test.ts:70` 只断言
   「组织 = 21 / 人物 = 54 / 事件 ≥ 22」，既不校验 JSON schema，也不校验「事件引用的 `regionId`/`orgId` 是否存在」。
   这是**内容改动最容易踩的坑**，建议优先级最高。
2. **无 `snapshot()` / `subscribe()`**：UI 靠 `App.refresh(forceHash)`（`src/ui/App.ts:404`）+ `hash()` 判重轮询。
   `WorldState` 1431 行 + 12,000 条历史时，每次 `refresh` 都重新算 `hashWorld`（`stableStringify` 全量遍历），
   是把 `refresh` 当成「每帧全量重建」的隐患。加订阅或至少做脏标记，比拆文件更能改善手感。
3. **无 UI 端到端测试**：`ui-panels` / `modal-pause` / `app-modal-pause` 用 jsdom，只覆盖 DOM 结构，
   不覆盖真实浏览器里的布局与点击坐标；发布流程靠手工 Edge 探针（`panels=7 | buttons=148 | errs=0`）。
4. **`core`/`ui` 未拆成可独立发布的包**：`vite-plugin-singlefile` 的单文件方案不需要它，
   但 GDD §17.7 的「模拟核心可独立跑」目前是靠 `pnpm sim`（`tsx` 直跑）实现的，不是靠包边界。

## 7. 如果只做三件事

1. **补 R8**（内容 schema + 引用校验）——它保护的是后续所有内容改动。
2. **拆 `CommandBus.applyCommand`**（1173 行 → 按域 4 个文件）——它是唯一「每加一个动词都要改 800 行」的地方，
   也是新贡献者的第一道墙。
3. **把 ②（`ui→systems`）写进文档当既定例外**——代码不用动，但后来的读者需要知道这是**有意为之**，
   而不是失误。
