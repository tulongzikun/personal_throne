# 代码结构评审与整改（2026-11-20，对应 v2.0.0）

> 目的：回答两个问题——**① 现在的代码结构是否合理？② 文档说明与代码是否匹配？**
> 方法：全仓库静态核对（`read` / `grep` / `glob`），逐个模块看 import 边、文件行数、导出与调用方；
> 结构结论（依赖边、行数、模块清单）来自静态核对，**验证性数字全部实跑复核**。
>
> **本文档分两段读**：
> - §1–§3 是**评审时（整改前）的诊断**，保留当时的证据与判断，便于回溯「为什么要改」；
> - §4 是**本轮已落地的整改**，逐条给整改前后的对照与验证方式；
> - §5 是文档与代码的对齐记录，§6 是仍未解决项，§7 是后续优先级。
>
> 整改后实跑状态（2026-11-20，`tsc --noEmit` / `eslint .` / `prettier --check .` 全干净）：
> `vitest run` **33 文件 / 207 例全绿**、`vite build` 成功、`node scripts/release.mjs` 产出
> **374,280 字节（预算占用 23.8%）**、`tsx scripts/sim.ts --years 100 --seed demo --check` 复跑一致、
> **耗时 3.33–3.77 s（8 次采样，14 区预算 4.0 s）**。

## 1. 结论摘要

**结构总体合理，分层是真的落地的，不是口号。** 五条铁律里最关键的两条（依赖单向、单一写入口）
有 ESLint 强制 + 代码事实双重支撑；八个业务域按域分目录，域间只有 14 条单向依赖、**没有跨域循环**；
状态是可序列化的纯数据，随机走命名流，因此 33 个测试文件可以做到「同种子必同哈希」。

评审时发现 **7 处值得整改的问题**，**均已在同一轮内整改完毕**（详见 §4）。
没有一处是架构性错误——不需要重写，只是局部调整、拆分与文档澄清。

| # | 问题 | 整改结果 |
|---|---|---|
| ① | `systems/country/PolicySystem.ts` 唯一一处 `systems → content` 依赖（默认参数） | ✅ `config` 改为必填，调用方显式传 `content.balance.policy`；ESLint 补 `content` 规则并实测拦得住；`systems → content` 边归零 |
| ② | `ui → systems` 的只读引用，让「UI 只经 GameEngine」名不副实 | ✅ 认定为**既定例外**写进 `development-plan.md` §4.2 铁律 1，并给出「为什么不下沉到 `ui/`」的理由 |
| ③ | 6 个超大文件（`WorldState.ts` 1431 行等） | ✅ 全部按职责拆分，**所有源文件已 ≤ 602 行**（最大为 `core/GameEngine.ts`） |
| ④ | `core` 实为 application 层，命名与 GDD §17.1 的「Simulation Core」错位 | ✅ 在 `development-plan.md` §4.1 分层图旁写明「`core` = 状态内核 + 编排层」，目录不动 |
| ⑤ | `systems/character/SkillCheck.ts` 零引用死代码 | ✅ 已 `git rm`（89 行） |
| ⑥ | `Chronicler.entityNames()` 的缓存失效键是「人物数量」 | ✅ 改为显式失效 `invalidateEntityNames(state)`，6 处实体写入点全部调用；新增回归用例 |
| ⑦ | `content/{races,classes,items}.json` 三个文件零引用 | ✅ 已 `git rm`（合计 1,365 字节），`Profile.ts` 的注释同步改写 |

## 2. 分层现状（实测依赖矩阵）

`src/` 的实际分层与依赖方向（箭头 = import 方向）：

```text
main.ts ──► ui ──► core ──► systems ──► core(类型/工具)
             │                  └──► content   ← 整改后：0 处
             └──► storage ──► core(schema/WorldState/Migration)
```

逐条证据（整改后复测）：

| 边 | 条数 | 证据 |
|---|---|---|
| `core → systems` | **29 条** import 语句 | `core/GameEngine.ts`（六相位编排，15 条）、`core/commands/{military,organization,personal,politics}.ts`（拆 `CommandBus` 后命令实现分散于此）、`core/event/eventEffects.ts`（`rollCheck`） |
| `systems → core` | 几乎全部 34 个文件 | 只有类型、`sortedIds`、`marketKeyOf`、`buildCharacter`、`neutralAttributes`、`formatDate`、`DAYS_PER_YEAR`、`readFeature`、`invalidateEntityNames` —— **都是纯函数与类型，没有反向写状态** |
| `systems → systems` | 14 条 | 见 §2.1，全部单向、无环 |
| `systems → content` | **0 条** | ① 整改后 `grep -rn "from '.*content" src/core src/systems` 无匹配 |
| `ui → core` | 预期内 | `App.ts` 取 `GameEngine` / `CommandBus` / `GameClock` / `EventEngine` 纯函数 |
| `ui → storage` | 预期内 | `App.ts`、`SaveDialog.ts` 用 `SaveManager` 槽位与导入导出 |
| `ui → systems` | **11 个文件 / 13 个模块** | 见 §4.2，全部只读纯函数 |
| `core/systems → ui` | **0 条** | `grep` 全无匹配 |

### 2.1 域间依赖（`systems → systems`，14 条，无环）

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
region/RegionNews          → character/Check (rollCheck)
```

这个形状是**健康的**：`goals` 是横切域（只出不进），`character` 是基础域（被军事/组织/goals/region 引用），
`country` 的 `Ruler` 是继承逻辑的唯一出处，`region/RegionNews` 只在 `character/Check` 与 `core` 上有出边。
**没有任何跨域循环**，这在大仓库里很少见，值得保持。

### 2.2 铁律核验

| 铁律 | 状态 | 证据 |
|---|---|---|
| `core`/`systems` 不依赖 UI、存储与内容装配 | ✅ 成立 | `eslint.config.js:44-57` 的 `no-restricted-imports`（四个目标：`ui` / `storage` / `content` / 各自子路径）+ 代码零匹配；① 整改时用临时 probe 文件实测规则生效 |
| 单一写入口 `GameEngine.dispatch` | ✅ 成立 | 所有状态变更经 `dispatch → applyCommand`（`core/CommandBus.ts:193`），UI 侧 `engine.state` 只读 |
| 随机唯一来源 | ✅ 成立 | `eslint.config.js:61-75` 禁 `Math.random`；`Random.ts` 命名流（`stream:entityId:periodKey`） |
| 遍历按稳定 ID 排序 | ✅ 成立 | `sortedIds()`（`core/WorldState.ts:1418`）在 34 个系统里被普遍使用 |
| 时间唯一入口 `GameClock` | ✅ 成立 | 禁 `new Date()`（`eslint.config.js:73`）；`Date.now()` 仅 3 处且在 UI（存档时间戳） |

**额外发现（文档 §5.2 #14 的准确边界）**：ESLint 只拦 `NewExpression[callee.name='Date']`，
**不拦 `Date.now()`**。实际存在 `src/ui/App.ts:886`、`src/ui/SaveDialog.ts:52,190`——都在 UI 层做存档时间戳，
不破坏确定性（模拟本身不用真实时间），但规则与文档描述的「禁一切真实时间」有偏差，已在 `development-plan.md` §5.2 #14 记明。

## 3. 结构优点（整改时特意保住的东西）

1. **`WorldState` 是纯数据 + 纯函数**，`cloneWorld`/`hashWorld`/`stableStringify`/`validateWorld` 逻辑同源，
   这让「存档 = JSON」「确定性 = 哈希」两件事都变成一句话能验证的断言。**拆分时把类型层与逻辑层分开，
   但对外接口一字未变**（`core/WorldTypes.ts` 用 `export *` 再导出，66 个 importer 零改动）。
2. **业务系统全部是 `(state, ...) => void` 形式的纯结算函数**，没有 class 状态、没有单例、没有事件总线。
   这是 33 个测试文件能在 ~43 秒内跑完的根本原因，也是拆分重构能安全进行的前提（每一步都有全量回归）。
3. **`content/` 只有一个装配器** `index.ts`（14 条 JSON import）。⑦ 整改后，`content/` 里**没有任何孤儿文件**，
   「能改的文件都真的生效」这条不再有例外。
4. **UI 零框架、零 runtime 依赖**（`package.json` 无 `dependencies`），`dom.ts` 85 行自建 `el/button/svgEl`。
   单文件产物 **374 KB** 而不需要框架 runtime，这个取舍是对的。
5. **`Command` 是可辨识联合**（33 种 `kind`，现位于 `core/commandTypes.ts`），
   `describeCommand` 能把它翻成人话——这条设计让「玩家卡片上的按钮」与「历史记录文本」共用一套词汇。
   ② 拆分时新增 `CommandOf<K extends CommandKind> = Extract<Command, { kind: K }>`，
   让每个命令实现函数的参数类型精确到具体 kind，`switch` 的穷尽检查仍在。
6. **`Migration.ts` 有真实迁移链**（`migrateV1`…`migrateV8`，351 行）与 8 个用例，
   包括「v1 一路迁到 v9」「迁移后 hash 失效」「更高版本拒绝」——存档兼容不是 PPT。

## 4. 已落地的整改（逐条对照）

### 4.1 ① `systems → content` 依赖已切断

**整改前**（问题所在）：

```ts
// src/systems/country/PolicySystem.ts:25
import { content as defaultContent } from '../../content';
// :256
export function runPolicyRound(state, ..., config: PolicyConfig = defaultContent.balance.policy)
```

`systems` 层本应只接受调用方传进来的数值，一旦自带 `content` 默认值，这个函数就不再是「纯函数」，
也让 `systems` 的依赖方向出现了一条通往 JSON 的捷径。ESLint 也拦不住（原 group 只有 `@/ui/*`、`@/storage/*`）。

**整改后**：

- `PolicySystem.ts` 删掉该 import，签名改为 `runPolicyRound(state, ctx, day, config: PolicyConfig, influence = 0)`。
- 三个调用点全部显式传 `content.balance.policy`：`core/GameEngine.ts:373`（原本已传）、
  `tests/acceptance.test.ts:117`、`tests/country.test.ts:91`；`tests/policy.test.ts` 4 处本来就有该参数。
- `eslint.config.js` 的 `no-restricted-imports` group 扩为
  `['@/ui/*','@/storage/*','@/content','@/content/*','**/ui/*','**/storage/*','**/content','**/content/*']`，
  message 注明「配置由调用方显式传入」。
- **验证**：`grep -rn "from '.*content" src/core src/systems` → 无匹配；
  临时建 `src/systems/_probe.ts` 写 `import { content } from '../../content'`，
  `eslint` 报 `no-restricted-imports` 错误，规则确认生效（probe 已删）。

### 4.2 ② `ui → systems` 的只读引用：认定为既定例外

整改后实测 **11 个 ui 文件 / 13 个 systems 模块**（`core/commands/` 拆分与 `ui/app/` 拆分带来的文件数变化，
依赖本身没有增加新的写操作）：

| UI 文件 | 引用的系统函数 | 性质 |
|---|---|---|
| `ui/CreateCharacterDialog.ts` | `CharacterCreator` 的 `TALENT_PICKS` / `TALENT_TAGS` | 常量表 |
| `ui/CountryPanel.ts` | `Offices.officeIdOf` / `officeSeatsFor` | 纯查询 |
| `ui/CharacterCard.ts` | `Profile.alignmentCell/alignmentLabel`、`Career.careerTitle`、`Relations.RELATION_LABELS/relationsOf`、`SkillEffects.skillEffectSummary` | 纯展示 |
| `ui/PlayerPanel.ts` | `Profile`、`Career`、`SkillEffects`、`goals/Ambition.ambitionOf/chapterOf` | 纯展示 |
| `ui/RegionPanel.ts` | `Offices`、`SkillEffects.purchaseFactor/saleFactor/tradeCarryCapacity`、`RegionNews.banditryLabel` | 纯展示 |
| `ui/ArmyPanel.ts` | `WarSystem.isAtWar` | 纯谓词 |
| `ui/OrganizationPanel.ts` | `Organization.valuation`、`Shares.canClaimLeadership` / `unassignedShare` | 纯查询 |
| `ui/SuggestionsPanel.ts` | `goals/Goals.suggestGoals` | 纯计算 |
| `ui/app/signalsFeed.ts` | `region/RegionNews.regionNews` | 纯查询 |
| `ui/app/lifecycle.ts` | `goals/Ambition` | 纯展示 |
| `ui/app/appTypes.ts` | `character/Check.describeCheck` | 纯展示 |

- **判断**：不是架构错误（**零写操作**），而是「状态只经 `engine.state`、但把状态翻译成人话的路直连 `systems`」。
- **处理**：选保守方案——承认它、写进铁律。`development-plan.md` §4.2 铁律 1 已补：
  「**反向的 `ui → systems` 是被允许的例外**：`ui` 可以只读引用 `systems` 的纯展示/纯查询函数……**但不得调用任何会写 `state` 的函数**」，
  并列出 13 个模块。**为什么不下沉**：`Goals.suggestGoals` 依赖 `Career`/`Offices`/`Shares` 的计算，
  把这些搬到 `ui/derive.ts` 会让 `ui` 反向依赖更多 `systems`，反而更差。

### 4.3 ③ 六个超大文件已全部拆分

| 文件 | 整改前 | 整改后 | 拆分结果 |
|---|---|---|---|
| `src/core/WorldState.ts` | 1431 | **591** | 类型层 → `core/schema/`（ids 62 / character 107 / organization 109 / country 114 / economy 102 / defs 290 / state 133）+ `core/WorldTypes.ts`（23 行 re-export，`export *` 保证 66 个 importer 零改动） |
| `src/core/CommandBus.ts` | 1173 | **205** | `core/commandTypes.ts` 107（`Command` 33 arm + `CommandOf<K>`）、`core/commandHelpers.ts` 88、`core/commands/{organization 396, personal 424, military 98, politics 59}.ts`；`CommandBus.ts` 只留 33 条 `case` 分发 + `describeCommand` |
| `src/core/EventEngine.ts` | 967 | **43** | `core/event/{eventTypes 52, eventPaths 156, eventFeatures 98, eventConditions 301, eventEffects 319, eventChoices 58}.ts`；`EventEngine.ts` 为纯 re-export，**导出面 29 个符号与原文件 diff 为空** |
| `src/ui/App.ts` | 953 | **595** | `ui/app/{appTypes 54, topbar 105, timebar 47, keyboard 95, signalsFeed 122, lifecycle 93, autosave 57}.ts` |
| `src/systems/character/Demography.ts` | 702 | **302** | `character/demography/{demographyTypes 20, demographyRules 153, demographyFamily 151, demographyEstate 93}.ts` |
| `src/ui/MapView.ts` | 674 | **508** | `ui/map/{mapGeometry 150, mapTypes 31}.ts` |

**整改后全仓库最大文件**：`core/GameEngine.ts` 602 行（未在清单内，未拆）> `ui/App.ts` 595 > `core/WorldState.ts` 591 >
`systems/military/WarSystem.ts` 568 > `ui/MapView.ts` 508 > `ui/OrganizationPanel.ts` 491 > `core/commands/personal.ts` 424。
**全部源文件已 ≤ 602 行**，600 行线以上的只剩 `GameEngine.ts` 一个且刚过线。

拆分时踩到并已解决的三个坑（留给后来者）：

1. **不要在 `core/` 下建名为 `content.ts` 的文件**：`eslint.config.js` 的 `'**/content'` 规则会把
   `import ... from './schema/content'` 也判为违规。类型层最终叫 `core/schema/defs.ts`。
2. **`resolveChoice` 必须放在 `eventEffects` 而不是 `eventChoices`**：它依赖 `applyEffect`，而 `applyEffect` 依赖
   `pickChoice`，放错会形成 `eventEffects ↔ eventChoices` 循环。
3. **re-export 只覆盖原本就 public 的符号**：否则内部 helper（`round`/`sanitize`/`pathParts` 等）会被一并导出，
   引发 `TS2459` / `TS2440` 冲突。

### 4.4 ④ `core` 的命名与职责：写清但不改名

`core/GameEngine.ts` 一次性 import **15 个系统模块**并在六个 `on*Phase` 里编排它们。
按常见分层术语，它更接近 **application/service 层**，而 GDD §17.1 说的「Simulation Core」是更薄的东西。

**处理**：不改名/不搬家（成本远大于收益，且 `core` 里确实放着状态、时钟、随机、历史这些内核），
在 `development-plan.md` §4.1 的分层图旁写明：

> `core` 实际包含两类东西——**状态内核**（`WorldState` / `Random` / `GameClock` / `History` / `Chronicler` / `SimulationTier`）
> 与**编排层**（`GameEngine` 的六相位调度、`CommandBus` 的命令分发、`EventEngine` 的事件抽样）。

### 4.5 ⑤ `SkillCheck.ts` 死代码已删除

```text
src/systems/character/SkillCheck.ts  (89 行，来自 M1 初始提交 fd91f44)
  export function skillCheck(rng, options)     :33
  export function opposedCheck(rng, a, b, ...) :57
```

`grep -rn "SkillCheck\|skillCheck\|opposedCheck" src tests scripts` **只命中文件自身**。
实跑走的是 `Check.ts` 的 d20（`core/event/eventEffects.ts` 调 `rollCheck`）。

**处理**：`git rm`。M4 的 2d6 方案已被 d20 取代，`development-plan.md` §5.3 与 `docs/roadmap-m4-plus.md` 里的提及
属于历史计划，保留但不再指代现存文件。

### 4.6 ⑥ `Chronicler` 缓存改为显式失效

**整改前**：

```ts
// src/core/Chronicler.ts:18
const nameCache = new WeakMap<WorldState, { count: number; names: Map<string, string> }>();
// 失效条件：state.characters 的数量变化
```

某人物被改名（或 `createPlayer` 重建同 id 的人物）而总人数不变 → 读到旧名字表，编年史文本出现旧名。

**整改后**（`src/core/Chronicler.ts:12-45`）：

```ts
const nameCache = new WeakMap<WorldState, Map<string, string>>();
export function invalidateEntityNames(state: WorldState): void { nameCache.delete(state); }
export function entityNames(state: WorldState): Map<string, string> {
  const cached = nameCache.get(state);
  if (cached) return cached;
  // ... 遍历 regions / countries / organizations / characters 建表
  nameCache.set(state, names);
  return names;
}
```

失效调用点覆盖全部 6 处实体写入：

| 写入点 | 位置 |
|---|---|
| 玩家人物创建 | `systems/character/CharacterCreator.ts:340` |
| 新生人口 | `systems/character/Demography.ts:563` |
| 外来者生成 | `systems/character/Demography.ts:667` |
| 摄政生成 | `systems/country/Ruler.ts:87` |
| 组织创建 | `systems/organization/OrganizationSystem.ts:128` |

**踩坑记录**：第一版直接删缓存，`sim --years 100` 从 3.58–3.66 s 涨到 **4.45–4.95 s（超出 4.0 s 预算）**
——`record()` 每条历史都查一次 `entityNames`，100 年上万次。改为显式失效后回到 ~3.0–3.6 s。

**回归用例**：`tests/chronicle.test.ts` 新增「实体改名后编年史跟着变（缓存不得以数量为失效键）」，
先断言 `humanize(world, org.id) === org.name`，再改名 + `invalidateEntityNames(world)`，断言返回新名。

### 4.7 ⑦ 三个孤儿 JSON 已删除

```text
src/content/races.json    289 字节
src/content/classes.json  436 字节
src/content/items.json    640 字节
```

它们既不在 `content/index.ts` 的 14 条 import 里，`WorldContent` 也没有 `races`/`classes`/`items` 字段，
更没有 `RaceDef`/`ClassDef`/`ItemDef` 类型；产物里搜 `grain_sack` 与 `铁锭` 均为 0 命中。

**处理**：`git rm` 三个文件。种族/职业/物品的真实来源是 `world.json` + `goods.json` + 代码里的常量表
（`ui/labels.ts` 的 `RACE_LABELS`/`CLASS_LABELS`、`systems/character/Profile.ts` 的种族修正）。
`Profile.ts:14` 的注释同步改写为：

```ts
/** 种族属性修正。种族本体在 `content/world.json` 的 `characters[].race`，修正表只在此处维护。 */
```

**为什么值得删**：它们看起来「像配置」，容易被后来的人当成真配置去改，改完毫无效果——
和 ⑤ 的死代码是同一类问题，只是这边是**数据**而不是**代码**。

## 5. 文档与代码的匹配（对齐记录）

本轮把「文档说 A、代码是 B」的地方全部对齐。**改动原则**：

- **当前状态型陈述**（「现在有几个文件 / 多少用例 / 多少字节」）→ 一律改为代码实测值；
- **阶段记录型陈述**（`development-plan.md` §8.x 各阶段当时写了什么）→ **保留原样**，因为它是历史快照；
- **设计意图文档**（`design.md` GDD）→ **不改正文**，只在文首加「实现进度见 README」的指引。

### 5.1 逐份文档的修改

| 文档 | 改了什么 |
|---|---|
| `README.md` | 全篇重写对齐 v2.0.0：`core` 8→**9** 个模块（补 `Chronicler`）、`systems` 14→**34** 个文件 8 域（补 `goals/` 与 `region/`）、`ui` 12→**29** 个 `.ts`（含 `app/` 7、`map/` 2）；测试 26/177、16/121、29/194 三种互相矛盾的口径统一为 **33 文件 / 207 例**；产物 353,647 / 363,804 → **374,280 字节（23.8%）**；`pnpm sim` 1.4–1.7 s → **3.33–3.77 s**；测试表 14 行 → **33 行**（`migration` 的「5 例、v1→v4」→「8 例、v1→v9」）；里程碑段落按 M0→M7 时序重排（原先 M6.2 在 M6.1 之前、M7 阶段 4/5/6 只有标题）；`存档版本链 v1→v7` → **v1→v9**；修正把「§5.2/§8.1」错挂到 `roadmap-m4-plus.md` 名下的链接；架构速览重写为「core = 状态内核 + 编排层」并标注**全部源文件 ≤ 602 行** |
| `development-plan.md` | 头部 v0.2→**v0.3** 并加修订记录；§1.1 现状全段改实测（9 模块 / 34 文件 8 域 / 7 国 14 区 21 组织 54 人物 90 事件 / 33 文件 207 例 / 374,280 字节 23.8%）；§3 `TypeScript 5.x`→**6.x**、组件 15→29、5 城→14 区；§4.1 mermaid 的 `UI→CommandBus→GameEngine` 方向**画反了**，改为 `UI → engine.dispatch → applyCommand`，删掉并不存在的 `SNAP` 节点，并补「`core` = 状态内核 + 编排层」的说明；§4.2 铁律 1 补上「`ui → systems` 是允许的只读例外」与 13 个模块清单；§4.3 数据流改为 `hash()` + `App.refresh()` 轮询（`snapshot()`/`subscribe()` 确实不存在，原注记正确但「属于 M5 的工作」已过期）；§5.1 目录树整棵重写（core 顶层 9 + `schema/`(7) `commands/`(4) `event/`(6) 逐文件带行数、systems 34 含 `region/` 与 `demography/`、content 删掉三个孤儿 JSON 行、ui 29 个 .ts 列出 `app/` 与 `map/` 行数、tests 207、release 374,280）；§5.2 偏差表 **15→18 行**（#8 `choices` 已实现、#12 WarSystem 568 行含会战围城、#13 ui 29 文件、#15 M2–M7 全完成、新增 #16 `systems→content`（现为已整改）、#17 `ui→systems` 只读引用、#18 Chronicler 归属与缓存问题）；§5.3 模块表补全 34 个系统与真实导出；§7.9 `formatVersion` 1→**9**、`SCHEMA_VERSION` 1→**9**、「没有迁移链」→ `migrateV1…V8` + 8 例覆盖；§8.1 标题改 v2.0.0 并**新增 M7 一行**；§9.2 测试映射 5 文件 33 例→**33 文件 207 例**、R4/R5/R7 由 ⚠️ 改 ✅、R8 保持 ❌（断言 21 组织/54 人物/≥22 事件）；§9.3 性能断言 `< 5000 ms`→**实际 `< 8000 ms`**；§13 口径 v0.2→v2.0.0；结尾「下一步（v0.2 实际）」→**v2.0.0 之后**的五条待办；**章节结构修复**：§8.30–§8.39 原本被插在 §9 标题之后，现回到 §9 之前并明示「倒序记录，最新在前」 |
| `docs/acceptance.md` | 加文件头说明「§1–§17 为各阶段快照，当前口径见 §18」；§0 复跑命令 15/109→**33/207**；§16 的 `SCHEMA_VERSION 8`→**9**（并注明当时误记，实际位于 `core/schema/ids.ts:21`）；§17 的 26/177、353,647 标注为快照；**新增 §18「当前口径（v2.0.0 最终）」**表：四版本常量、内容规模、代码规模（34 文件 8 域 / ui 29 / tests 33 / 全部源文件 ≤ 602 行）、33/207、确定性、性能（3.33–3.77 s，含 `< 8000 ms` 断言位置）、374,280 字节、迁移 v1→v9 8 例、仍缺项 |
| `design.md` | 正文 2107 行**一字未动**（它是设计意图，不该按实现进度改写）；仅在文首加一行 blockquote：实现进度见 `README.md`/`development-plan.md`，验收数字见 `docs/acceptance.md`，结构审计见本文档 |
| `docs/roadmap-m4-plus.md`<br>`docs/redesign-v2.md`<br>`docs/growth-travel-design.md`<br>`docs/playtest-2026-11-20.md` | **未改**。前两份是历史规划/设计档（改了反而篡改历史）；`growth-travel-design.md` 的 P1–P3 与代码一致；`playtest` 是某次试玩的现场记录，其中的数字是那一刻的事实 |

### 5.2 四个版本常量的现状（文档里最容易写错的地方）

| 常量 | 位置 | 值 | 以前文档写错成 |
|---|---|---|---|
| `CONTENT_VERSION` | `src/content/index.ts:36` | `'0.7.0'` | `'0.1.0'` |
| `SAVE_FORMAT_VERSION` | `src/storage/Migration.ts:23` | `9` | `1`（§7.9）、`6`（§5.3） |
| `SCHEMA_VERSION` | `src/core/schema/ids.ts:21`（经 `core/WorldState.ts` 再导出） | `9` | `1`、`8`（acceptance §16） |
| `version` | `package.json` | `2.0.0` | `1.0.0`（§13） |

## 6. 仍未解决（明确不属本轮范围）

1. **R8 内容校验**：`development-plan.md` §9.2 唯一还挂 ❌ 的一项。现在 `tests/simulation.test.ts:70` 只断言
   「组织 = 21 / 人物 = 54 / 事件 ≥ 22」，既不校验 JSON schema，也不校验「事件引用的 `regionId`/`orgId` 是否存在」。
   这是**内容改动最容易踩的坑**，建议优先级最高。
2. **无 `snapshot()` / `subscribe()`**：UI 靠 `App.refresh(forceHash)`（`src/ui/App.ts:404` 附近）+ `hash()` 判重轮询。
   12,000 条历史时，每次 `refresh` 都重新算 `hashWorld`（`stableStringify` 全量遍历），
   是把 `refresh` 当成「每帧全量重建」的隐患。加订阅或至少做脏标记，比继续拆文件更能改善手感。
3. **无 UI 端到端测试**：`ui-panels` / `modal-pause` / `app-modal-pause` 用 jsdom，只覆盖 DOM 结构，
   不覆盖真实浏览器里的布局与点击坐标；发布流程靠手工 Edge 探针（`panels=7 | buttons=148 | errs=0`）。
4. **`core`/`ui` 未拆成可独立发布的包**：`vite-plugin-singlefile` 的单文件方案不需要它，
   但 GDD §17.7 的「模拟核心可独立跑」目前是靠 `pnpm sim`（`tsx` 直跑）实现的，不是靠包边界。

## 7. 下一步优先级

1. **补 R8**（内容 schema + 引用校验）——它保护的是后续所有内容改动。
2. **给 `refresh()` 加脏标记或订阅**——比继续拆文件更能改善手感（§6 第 2 条）。
3. **补 UI 端到端**（Playwright 或等价方案）——现在的 jsdom 覆盖不到真实布局。
4. **把 `core`/`ui` 的出包边界想清楚**——不是为了现在拆包，而是为了让「哪些东西是公开 API」有答案，
   `EventEngine` 的 43 行 re-export 已经证明这条路可行。
