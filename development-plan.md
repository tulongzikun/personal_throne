# 《王座与黄金》开发计划

**Throne & Gold — Development Plan v0.3**

- 编制日期：2026-11-19
- 修订日期：2026-11-19（v0.2：按仓库实现现状校准 §1/§5 目录与 §9 测试，新增 §5.2「实现偏差记录」与 §8.1「当前进度」）
- 修订日期：2026-11-20（v0.3：M7 与 v2.0.0 收尾后全面对齐——§1.1/§3/§5.1 的数字与目录树改为代码实测值，§4.1 分层图与 §4.3 数据流改为实际的 `dispatch` + `refresh()` 轮询，§5.2 偏差表逐条复核，§7.9 存档改到 v9，§8.1 进度表补到 M7，§9.2/§9.3 测试与性能口径对齐代码，§13 状态口径统一到 v2.0.0；§8.30 起的阶段记录改为最新在前倒序并移回 §9 之前。代码结构评审见 `docs/architecture-review-2026-11-20.md`）
- 依据文档：`design.md`（GDD v1.0，2107 行）
- 交付目标：16 周内产出可玩的单文件 MVP（`dist/index.html`）
- 人力假设：1 名开发者 + AI 结对开发
- 仓库根目录即项目根（原始清单中的 `throne-and-gold/` 为项目代号，对应本仓库 `personal_throne/`）

---

## 0. 文档职责

| 文档 | 回答的问题 | 变更频率 |
|---|---|---|
| `design.md` | 游戏**是什么**：玩法、规则、数值意图 | 低（策划变更时） |
| 本文件 | 游戏**怎么做**：架构、任务、排期、验收 | 高（每阶段更新） |
| `README.md` | 如何运行、如何构建 | 低 |

本计划不重复 GDD 的玩法定义。凡涉及"应该发生什么"的争议，以 `design.md` 为准；凡涉及"如何实现、先做哪一块"的争议，以本文件为准。

---

## 1. 工程基线

### 1.1 现状

- M0 工程基线已落地：Vite + `vite-plugin-singlefile`、TypeScript 严格模式、ESLint 架构约束（`core`/`systems` 禁依赖 UI 与存档层、禁 `Math.random` 与 `new Date()`）、Vitest、GitHub Actions。
- M1 模拟核心主体已落地：`src/core/` **9 个模块**（GameEngine / WorldState / GameClock / CommandBus / EventEngine / Random / History / SimulationTier / Chronicler）、`src/systems/` **34 个文件（8 个域**：character / organization / country / economy / npc / military / goals / region）、存档信封与 IndexedDB 槽位、`pnpm sim` 命令行。
- M2–M7 已全部落地：组织生命周期与契约、国家政策三阶段与公职、人物档案/人口学/生涯/关系、事件链与抉择、战争（宣战/行军/会战/围城/议和）、薄 UI 与 M5 界面整合、v2 的四层循环与个人动词。
- 内容规模（代码实测）：**7 国 / 14 地区 / 21 组织 / 54 人物 / 90 条事件**（events 分 6 个文件：local 42、country 20、organization 13、adventure 9、war 3、economy 3）。
- 当前为 **v2.0.0（M0–M7 全部完成）**：100 年模拟 3.33–3.77 s（14 区口径，8 次采样），**33 个测试文件 / 207 个用例**全绿，验收 A–F 见 `docs/acceptance.md`。
- `release/index.html` 是仓库内可下载的成品（当前 **374,280 字节**，占 1.5 MiB 预算约 **23.8%**），线上地址 <https://tulongzikun.github.io/personal_throne/>。
- 版本常量：`CONTENT_VERSION = '0.7.0'`（`src/content/index.ts:36`）、`SAVE_FORMAT_VERSION = 9`（`src/storage/Migration.ts:23`）、`SCHEMA_VERSION = 9`（`src/core/WorldState.ts:25`）、`package.json` 的 `version = 2.0.0`。

### 1.2 交付形态

| 项目 | 约定 |
|---|---|
| 发布物 | `dist/index.html` 单文件，JS/CSS/图片全部内联 |
| 运行方式 | 双击本地打开即可运行，**不依赖网络与本地服务器** |
| 浏览器 | Chrome / Edge 最近两个大版本，基准分辨率 1920×1080，最低 1366×768 |
| 存档 | 浏览器本地存储 + JSON 文件导入导出 |
| 包体预算 | 首屏 HTML ≤ 1.5 MB（gzip 前），加载 ≤ 1 s |

### 1.3 环境要求

- Node.js 22 LTS、pnpm 11（`packageManager: pnpm@11.28.5`）
- Git、VS Code（推荐插件：ESLint、Prettier、Vitest）
- 开发期另需 `tsx`（已列入 `devDependencies`，仅用于 `pnpm sim`，不进入产物）
- 无后端、无数据库、无云服务

---

## 2. 范围冻结（MVP）

范围一旦冻结，新增需求进入 `M6+ 待办`，不在 16 周内插入。

### 2.1 纳入范围

| 维度 | MVP 内容 | 来源 |
|---|---|---|
| 国家 | 2 个：银月王国（封建君主制）、港口自由同盟（商业共和国） | GDD 18.2 |
| 城市/地区 | 5 个（含首都、港口、矿区、农业区、边境镇） | GDD 18.2 |
| 组织 | 10 个（商会 4、佣兵团 2、教会 1、贵族家族 1、冒险者协会 1、秘密组织 1） | GDD 18.2 |
| 重要 NPC | 20 名（含 2 名统治者、4 名组织领袖、若干官员/商人/军官） | GDD 18.2 |
| 商品 | 粮食、铁矿、武器、奢侈品 | GDD 9.2 |
| 职业方向 | 商人、佣兵、政治人物（可交叉发展） | GDD 18.3 |
| 事件 | 组织 10、国家 8、宏观 6 | GDD 18.2 |
| 政策 | 财政（税率/支出）、商业（关税/贸易自由度）、军事（军费） | GDD 8.3 |
| 系统 | 时钟与快进、分层模拟、事件引擎、组织财务、区域市场、国家财政与政策、NPC 月度决策、人物与 D20 检定、历史记录、存档 | GDD 17.1 |
| 界面 | 顶栏 + 左人物 + 中地图 + 右情报 + 底行动/事件、四种地图图层、事件弹窗、组织面板、历史面板 | GDD 16 |

### 2.2 明确排除（M6+）

- 七国全量、完整世界地图与外交体系
- 战争深度模拟（MVP 只保留"战争风险事件 + 简化的战争结果"，不做战役级结算）
- 魔法经济、宗教体系、多世界包、模组接口
- 多人、联机、云存档
- 实时制、离线收益、签到
- 任意脚本化内容（事件只允许受限 DSL，禁止 `eval`）

### 2.3 MVP 成功判据

不是"模拟 100 年后生成一段精彩历史"，而是玩家能走完：

> 进入世界 → 选择身份 → 建立/加入组织 → 遭遇由经济政治自然产生的挑战 → 用不同策略应对 → 在世界状态中看到可解释的后果 → 达成目标后仍愿意继续 → 以另一身份重开同一世界。

对应 GDD 第二十四章，逐条映射见 §13。

---

## 3. 技术选型

| 领域 | 选择 | 理由 | 放弃的方案 |
|---|---|---|---|
| 语言 | TypeScript 6.x（`devDependencies` 为 `typescript ^6.0.3`），`strict` + `noUncheckedIndexedAccess` | 世界状态字段多，类型是主要文档 | JS（重构风险高） |
| 构建 | Vite + `vite-plugin-singlefile` | 官方单文件方案，CSS/JS/资源内联，产物即发布物 | Webpack（配置重）、esbuild 手写（插件生态弱） |
| UI | 原生 DOM + 轻量组件类（`mount/update/dispose`） | 面板式界面，`src/ui/` 现有 20 个 `.ts` + `styles/base.css`；无虚拟 DOM 需求 | React/Vue：为单文件体积与长期依赖增加成本 |
| 地图 | SVG + 手写投影 | 14 个地区，SVG 便于命中测试与主题化 | Canvas（交互与缩放成本高）、地图库（体积） |
| 测试 | Vitest（node 环境 + 少量 jsdom） | 与 Vite 同源，快 | Jest（配置重） |
| 开发期 CLI | `tsx`（devDependency） | 直接执行 `scripts/sim.ts` 这类 TS 脚本，ESM 下零额外配置，且不参与打包 | ts-node（与 ESM/Vite 生态摩擦大）、先编译再运行（多一步产物） |
| 存档 | IndexedDB（主）+ localStorage（设置）+ 文件导出 | 快照体积可控（< 2 MB），IndexedDB 容量足够 | 纯 localStorage（5 MB 上限风险） |
| 架构风格 | 结构化对象 + 系统函数（非 ECS） | 实体 < 500（54 具名人物 + 21 组织 + 14 地区），系统 34 个文件、8 个域；ECS 在此规模只增加间接层 | ECS |
| 状态管理 | `GameEngine` 单一 store，UI 只读 `engine.state` + `refresh()` 轮询 | 权威状态唯一；未做快照与订阅（见 §4.3） | Redux 类库 |

**版本策略**：`package.json` 使用 caret 范围并在 `pnpm-lock.yaml` 锁定；升级依赖只在里程碑边界进行，且必须跑完整的确定性回归测试。

---

## 4. 架构总览

### 4.1 分层

```mermaid
flowchart LR
    UI["ui/*（App 持有 engine 实例）"] -->|engine.dispatch Command| ENGINE[core/GameEngine]
    ENGINE -->|applyCommand 校验与结算| BUS[core/CommandBus]
    ENGINE --> TIER[core/SimulationTier]
    ENGINE -->|六相位编排| SYS["systems/*（34 个文件 / 8 域）"]
    SYS --> STATE[core/WorldState]
    ENGINE --> EVT[core/EventEngine]
    EVT --> STATE
    EVT --> HIST[core/History]
    STATE -.只读 engine.state + refresh 轮询.-> UI
    STATE --> SAVE[storage/SaveManager]
    SAVE --> MIG[storage/Migration]
    UI -.只读纯函数.-> SYS
```

> 与 v0.2 的差异：原先画成 `UI → CommandBus → GameEngine` 是反的——`CommandBus` 只导出 `applyCommand()` / `describeCommand()` 纯函数，由 `GameEngine.dispatch()` 调用；UI 侧拿的是引擎实例。`STATE --> SNAP --> UI` 也不存在（无 `snapshot()`），实际是 UI 只读 `engine.state` 并自行轮询。`TIER --> SYS` 同样不准确：`SimulationTier` 只算层级分，真正调 14 个系统函数的是 `GameEngine` 的六个 `on*Phase` 方法。
>
> **关于 `core` 这个名字**：`core` 实际包含两类东西——**状态内核**（`WorldState` / `Random` / `GameClock` / `History` / `Chronicler` / `SimulationTier`）与**编排层**（`GameEngine` 的六相位调度、`CommandBus` 的命令分发、`EventEngine` 的事件抽样）。按常见分层术语，编排层更接近 application 层，与 GDD §17.1 的「Simulation Core」不完全对应。目录名保持 `core/` 不变（改名成本大于收益），读代码时按上述两类来理解即可。

### 4.2 五条铁律

1. **core 不依赖 UI**：`src/core/**` 与 `src/systems/**` 不得 import `ui/`、`storage/`、DOM API、`window`（ESLint `no-restricted-imports` 拦截）。**反向的 `ui → systems` 是被允许的例外**：`ui` 可以只读引用 `systems` 的纯展示/纯查询函数（`Profile` / `Career` / `SkillEffects` / `Relations` / `Offices` / `Organization.valuation` / `Shares` / `WarSystem.isAtWar` / `goals.{Goals,Ambition}` / `region/RegionNews` / `Check.describeCheck` / `CharacterCreator` 的常量表，共 **11 个 ui 文件、13 个 systems 模块**），**但不得调用任何会写 `state` 的函数**。理由见 `docs/architecture-review-2026-11-20.md` §4.2：把这些函数下沉到 `ui/` 会让 `ui` 反向依赖更多 `systems`，反而更差。
2. **单一写入口**：权威状态只能由 `GameEngine.dispatch()`（玩家命令）或系统结算函数修改；UI 不得直接改状态。
3. **随机唯一来源**：禁止 `Math.random()`；所有随机数来自 `Random.ts` 的命名流，可序列化、可复现。
4. **顺序确定**：所有实体遍历按稳定 ID 排序；结算按 `(日, 相位, 序号)` 三元组排序，禁止依赖 `Object.keys` 的插入顺序。
5. **时间唯一入口**：日期只能由 `GameClock` 推进；禁止直接赋值 `state.clock.day`。

### 4.3 数据流

```
玩家操作 → Command（带类型与参数）→ GameEngine.dispatch() → CommandBus.applyCommand() 校验与结算
  → 失败：返回 CommandResult.error，状态不变
  → 成功：写入 state + 追加 History
  → advanceTo(targetDay) / advanceDays(n)
      → 逐日 → 逐结算点 → 六相位（行动/市场/组织/国家/事件/收尾）
      → 各系统按相位结算 → DomainEvent[]
      → EventEngine 抽样 → 新事件/后续事件 → pendingEvents
  → History 追加（裸 id 在写入时换成专名）
  → UI 侧：App.refresh() 读 engine.state 重建视图（hash 变化才重绘）
```

> **实现状态（v0.3 实测）**：`GameEngine` 对外是 `dispatch()` / `advanceDays()` / `advanceTo()` / `choose()` / `applyTrigger()` / `hash()` / `heirs()` / `continueAs()` / `playerInfluence()` / `createPlayer()` 与只读 `state`。**`snapshot()` 与 `subscribe()` 至今未实现**——UI 用 `App.refresh(forceHash)`（`src/ui/App.ts:404`）轮询，用 `hash()` 判断是否需要重绘，用 `pendingChoices` + `stopAtChoices` 表达「需要玩家决策」。确定性校验用 `hash()` 而不是快照版本号。

### 4.4 结算相位（同一天内的固定顺序）

| 相位 | 名称 | 内容 |
|---:|---|---|
| 0 | 行动 | 玩家/NPC 已提交行动的结算、移动、旅行到达 |
| 1 | 市场 | 产量、需求、价格、商路运输 |
| 2 | 组织 | 财务月结（月末）、规模与风险指标更新 |
| 3 | 国家 | 财政、政策压力、派系、外交 |
| 4 | 事件 | 风险抽样、事件结算、后续事件入队 |
| 5 | 收尾 | 生命周期变更、清理、历史摘要、快照 |

相位是**排序约束**而非"每相位每帧都算"：每个结算点只处理到期项（见 §7.1）。

---

## 5. 目录结构与模块职责

### 5.1 当前结构（v2.0.0 实测）

与 v0.1 计划的差异集中在内容装配、CLI/发布脚本与 `release/`，逐项理由见 §5.2。

```
personal_throne/                # 仓库根即项目根
│
├── index.html                  # HTML 入口（Vite 注入 /src/main.ts）
├── package.json                # 脚本与 devDependencies（含 tsx）
├── tsconfig.json               # strict + noUncheckedIndexedAccess + @/* 别名（include: src, tests, vite.config.ts）
├── vite.config.ts              # singlefile 打包与 vitest 配置
├── eslint.config.js            # 架构依赖方向 + 随机/时间禁令
│
├── src/
│   ├── main.ts                 # 引导：加载内容 → 校验 → 读档 → App.mount
│   │
│   ├── core/                   # 状态内核 + 编排层，不依赖 UI/存档/内容（已实现）
│   │   ├── GameEngine.ts       # 602 行：唯一写入口 + 六相位编排（全仓库最大文件）
│   │   ├── WorldState.ts       # 591 行：createWorld / validateWorld / hashWorld / cloneWorld
│   │   ├── WorldTypes.ts       # 23 行：对 schema/ 的 re-export（对外接口不变）
│   │   ├── GameClock.ts
│   │   ├── CommandBus.ts       # 205 行：applyCommand 分发 + describeCommand
│   │   ├── commandTypes.ts     # 107 行：Command 联合（33 种 kind）/ CommandResult
│   │   ├── commandHelpers.ts   # 88 行：canControl / isAmount / fail / regionHasPath …
│   │   ├── commands/           # 按域拆分的命令实现（organization 396 / personal 424 /
│   │   │                       #   military 98 / politics 59）
│   │   ├── EventEngine.ts      # 43 行：对 event/ 的 re-export（导出面与原文件一致）
│   │   ├── event/              # eventTypes 52 / eventPaths 156 / eventFeatures 98 /
│   │   │                       #   eventConditions 301 / eventEffects 319 / eventChoices 58
│   │   ├── schema/             # 类型层：ids 62 / character 107 / organization 109 /
│   │   │                       #   country 114 / economy 102 / defs 290 / state 133
│   │   ├── Random.ts
│   │   ├── History.ts
│   │   ├── SimulationTier.ts
│   │   └── Chronicler.ts       # 编年史投影（GameEngine.record() 调用，另有 ui 只读复用）
│   │
│   ├── systems/                # 34 个文件，8 个域（已实现）
│   │   ├── character/          # 11 + demography/(4)：Character / CharacterSystem / SkillEffects / Profile /
│   │   │                       #     Career / Relations / Retire / CharacterCreator / Activity / Demography / Check
│   │   │                       #     demography/：demographyTypes 20 / Rules 153 / Family 151 / Estate 93
│   │   ├── organization/       # 7：Organization / OrganizationSystem / Finance / OrganizationRisk /
│   │   │                       #    Lifecycle / ContractSystem / Shares
│   │   ├── country/            # 4：CountrySystem / PolicySystem / Ruler / Offices
│   │   ├── economy/            # 3：MarketSystem / ProductionSystem / TradeSystem
│   │   ├── npc/                # 1：DecisionSystem
│   │   ├── military/           # 1：WarSystem（宣战 / 行军 / 会战 / 围城 / 厌战）
│   │   ├── goals/              # 2：Goals（建议事项）/ Ambition（野心与章节）
│   │   └── region/             # 1：RegionNews（远方见闻、旅途遭遇检定）
│   │
│   ├── content/                # 静态内容；index.ts 装配 14 个 JSON（8 个顶层 + 6 个 events）
│   │   ├── index.ts            # 唯一装配器：content / CONTENT_VERSION('0.7.0') / eventsById
│   │   ├── goods.json          # 商品定义单列
│   │   ├── organizations.json  # 21 家
│   │   ├── countries.json      # 7 国
│   │   ├── world.json          # 14 区 54 人
│   │   ├── balance.json
│   │   ├── faiths.json
│   │   ├── backgrounds.json
│   │   ├── names.json
│   │   └── events/             # 共 90 条
│   │       ├── local.json          # 42 条
│   │       ├── country.json        # 20 条
│   │       ├── organization.json   # 13 条
│   │       ├── adventure.json      # 9 条
│   │       ├── war.json            # 3 条
│   │       └── economy.json        # 3 条
│   │
│   ├── storage/
│   │   ├── SaveManager.ts      # 信封、序列化/校验、IndexedDB 槽位、文件导出
│   │   └── Migration.ts        # SAVE_FORMAT_VERSION = 9；migrateV1…V8 迁移链
│   │
│   ├── ui/                     # 29 个 .ts + styles/base.css（原生 DOM，零依赖）
│   │   ├── App.ts              # 595 行：装配、refresh 轮询、时间推进
│   │   ├── MapView.ts          # 508 行：程序化 SVG 地形与商路
│   │   ├── app/                # appTypes 54 / topbar 105 / timebar 47 / keyboard 95 /
│   │   │                       #   signalsFeed 122 / lifecycle 93 / autosave 57
│   │   ├── map/                # mapGeometry 150 / mapTypes 31
│   │   ├── context.ts / signals.ts / labels.ts / dom.ts
│   │   ├── RegionPanel / CharacterPanel / CharacterCard / OrganizationPanel / CountryPanel /
│   │   │   ArmyPanel / HistoryPanel / EventDialog / PlayerPanel / SuggestionsPanel /
│   │   │   SaveDialog / CreateCharacterDialog / StartDialog / Tour
│   │   └── styles/base.css
│   │
│   └── assets/                 # 目前只有 .gitkeep（无位图，图形全部程序化）
│
├── scripts/
│   ├── sim.ts                  # pnpm sim --years N --seed S [--check]（tsx 执行）
│   └── release.mjs             # dist → release，校验无外链与 ≤1,572,864 字节
│
├── tests/                      # 33 个测试文件（207 条用例）+ helpers
│   ├── helpers/index.ts        # makeWorld / makeEngine
│   └── （详见 §9.1 表）
│
├── release/
│   └── index.html              # 仓库内发布的成品单文件（374,280 字节，CI 校验一致）
│
└── dist/
    └── index.html              # 构建缓存（.gitignore 忽略）
```

**相对 v0.1 计划的增量（7 处）**

| 增量 | 职责 | 原因 |
|---|---|---|
| `src/content/goods.json` | 商品定义（4 种：粮食、铁矿、武器、奢侈品）单列 | 商品同时被市场、生产、商路与组织 industry 引用；从 `world.json` 抽出后，调价与新增商品不必改地图文件。 |
| `src/content/{faiths,backgrounds,names}.json` | 信仰、出身、各文化姓名库单列（M4 创建人物用） | 增删信仰与出身只动小文件，且与 `world.json` 的地理解耦。 |
| `src/content/index.ts` | 唯一 import JSON 的装配器，导出 `content: WorldContent`、`CONTENT_VERSION = '0.7.0'`、`eventsById` | 引擎只接收装配好的对象，不感知文件系统；事件在装配时按 id 排序，保证候选遍历顺序稳定。 |
| `src/systems/goals/` | `Goals.ts`（建议事项、每条的数值依据）与 `Ambition.ts`（野心推导、章节标题） | 这两个是横切能力：既被 UI 直接读取，也在 M7 阶段 5 成为「第一份财报」的文案来源。 |
| `scripts/sim.ts` | `pnpm sim --years N --seed S [--check]`，输出摘要、状态哈希与耗时 | M1 的验收入口；`--check` 复跑并比对哈希，直接对应 R1。 |
| `scripts/release.mjs` | 校验 `dist/index.html` 存在、非空、无外链、≤ 1,572,864 字节后复制为 `release/index.html` | 发布物必须在仓库内可直接下载；三道校验保证「单文件、零外链、不超预算」不会靠人工检查。 |
| `release/index.html` | 仓库内发布的成品单文件（当前 374,280 字节 / 23.8%） | 构建目录 `dist/` 被 gitignore，发布物需要独立落点；CI 用 `git diff --exit-code -- release/index.html` 确认提交的产物与构建一致。 |
| `tests/helpers/index.ts` | `makeWorld(seed)` / `makeEngine(seed)` 测试夹具 | 33 个测试文件共用固定内容 + 固定种子，避免每个用例重复构造世界。 |

`src/content/balance.json`（v0.1 已列）职责不变：所有可调系数集中一处，批量模拟时可整文件替换做对照。

> 已知缺口：`src/assets/` 仍只有 `.gitkeep`（所有图形都是程序化 SVG，没有位图资源）；`tests/helpers` 里没有独立的快照哈希与会计不变量断言工具（这两类断言目前分散在各用例内）。当前仓库**没有** `systems/country/Country.ts`，国家类型直接定义在 `core/WorldState.ts`。

### 5.2 实现偏差记录

记录「计划写的」与「代码实际做的」之间的差异。**未验证的能力不写成已完成**；状态列只描述仓库里能读到的事实。

| # | 计划 / v0.1 写法 | 代码现状（v0.3 实测） | 理由与影响 |
|---|---|---|---|
| 1 | 内容目录只有 `world.json` 承载商品与地图 | 商品拆到 `goods.json`；`world.json` 只留地图、初始人物与地区；另有 `faiths/backgrounds/names.json` | 见 §5.1 增量表；`world.json` 从 9 KB 级降到只含地理与人物，改商品不再碰地图 |
| 2 | 各模块自行 import JSON | 仅 `src/content/index.ts` import JSON，导出 `content`、`CONTENT_VERSION = '0.7.0'`、`eventsById` | 保持「引擎不认识文件系统」；事件按 id 排序后装配，遍历顺序确定 |
| 3 | 无开发期 CLI | `scripts/sim.ts` + `pnpm sim`（`--years` / `--seed` / `--check`） | M1 验收入口；`--check` 两次运行比哈希，是 R1 的手工版 |
| 4 | 发布 = `pnpm build` 产出 `dist/index.html` | `pnpm release` = build + `scripts/release.mjs`：存在性、无外链（`<script src>` / 外部 `<link href>` / `@import` / `url(http…)`）、≤ 1,572,864 字节，逐项通过才复制到 `release/index.html` | 单文件与体积预算是硬约束，交给脚本而不是 checklist；失败不产生半成品 |
| 5 | 发布物只在 `dist/` | `release/index.html` 进仓库并随阶段提交（当前 374,280 字节） | `dist/` 被 gitignore；仓库内的成品才可直接下载双击；CI 校验「提交的 release 与构建一致」 |
| 6 | `tsconfig`/`vite`/`vitest` 即可 | 额外 devDependency `tsx` | 只服务 `pnpm sim` 运行 TS CLI：ESM 下零配置、无需预编译产物、不进 bundle。选择它而非 ts-node 是为了避开与 Vite/Vitest 的 ESM 解析差异 |
| 7 | M1 命令集：`move` / `work` / `invest` / `createOrg` / `joinOrg` / `setStrategy` / `negotiate` / `lobby` / `advance` / `save` | 实际 **33 种 `kind`**（`src/core/commandTypes.ts`，原名 `CommandBus.ts:69-139`）：组织 12（invest / recruit / set_strategy / take_loan / repay_debt / buy_asset / sell_asset / open_route / lobby / sign_contract / break_contract / restructure）+ 个人 16（change_career / train / choose / move / trade_goods / seek_audience / gift / gossip / rest / deposit / withdraw / buy_shares / sell_shares / claim_leadership / attend_court / inspect_market）+ 军事 4（declare_war / offer_peace / levy_army / march_army）+ 公职 1（seek_office） | v0.1 的 `work` / `createOrg` / `joinOrg` / `advance` / `save` 没有被采用：打工被 `train` 与 `trade_goods` 覆盖，入组织走 `sign_contract`（`employment` 类型），推进与存档是 UI 直接调用而非命令 |
| 8 | `EventDef.text` 用 `titleKey` / `bodyKey`，且有 `choices` | `text: { title, body }` 直接内联中文（支持 `{country}/{place}/{subject}` 占位符）；**`choices` 已实现**：`ChoiceDef` 含 `check?: {attribute, difficulty}` 与 `failureEffects`，玩家发 `choose` 命令，NPC/无头模式按 `choiceUtility` 择优 | 单语言 MVP 不需要 key 间接层；M7 阶段 7 把「系统代选」去掉后，抉择成为核心交互，`tests/choices.test.ts` 9 例 + `tests/checks.test.ts` 5 例覆盖 |
| 9 | `GameEngine` 暴露 `snapshot()` / `subscribe()` | 仍**没有**；对外是 `dispatch()` / `advanceDays()` / `advanceTo()` / `choose()` / `applyTrigger()` / `hash()` / `heirs()` / `continueAs()` / `playerInfluence()` / `createPlayer()` 与只读 `state` | UI 已接入但不订阅：`App.refresh(forceHash)` 轮询 + 只读 `engine.state`。快照与订阅仍是待办（见 `docs/architecture-review-2026-11-20.md` §6） |
| 10 | `GameClock.nextInterrupt()` | 只实现 `nextBoundary()`；`ScheduledEvent` 有 `kind: 'interrupt'` 占位，但没有中断查询 API | 「需要玩家决策」由 `stopAtChoices` + `pendingChoices` 表达，未做通用中断查询 |
| 11 | `systems/country/Country.ts` | 无此文件；`Country` / `CountryDef` / `PolicyVector` 在 `core/schema/country.ts`（经 `core/WorldState.ts` 再导出） | 国家实体字段少且被 core 直接引用，单列文件只会造成循环依赖风险；政策逻辑仍在 `PolicySystem.ts` |
| 12 | `WarSystem` 属 M6，只做月度军费 | **已远超占位**：568 行，含常备军规模/训练/士气、宣战与双向交战列表、逐月行军与拦截、会战（战力比/伤亡/撤退）、3 个月围城易主、厌战累积自动议和、AI 宣战 | 深度战争仍缺多军团与战线、战役地形修正（见 README「尚未完成」） |
| 13 | UI 组件在 M5 建 | `src/ui/` 现有 29 个 `.ts`（顶层 20 + `app/` 7 + `map/` 2）+ `styles/base.css`（`App.ts` 595 行、`MapView.ts` 508 行），`src/main.ts` 已改为真实引导（加载内容 → 校验 → 读档 → `App.mount`） | M5 已完成，此类文案债已清零 |
| 14 | ESLint 禁 `Math.random()` 与 `Date.now()` | 规则（`eslint.config.js:61-75`）拦截 `Math.random` 与 `new Date()`；`Date.now()` 仍无专门选择器，实际出现在 `src/ui/App.ts:886`、`src/ui/SaveDialog.ts:52,190`（都在 UI 层的存档时间戳） | `new Date()` 是主要的时间泄漏形态；`Date.now()` 由评审兜底，后续可补 `MemberExpression` 规则 |
| 15 | 里程碑 M2–M4 尚未开始 | M2–M7 全部完成（v2.0.0），33 个测试文件 / 207 例 | 代码骨架先行不等于里程碑完成；退出标准按 §8 逐阶段记录，此处已全部达成 |
| 16 | `core` / `systems` 不依赖 `content` JSON | **已整改归零**：原 `systems/country/PolicySystem.ts:25` 的 `import { content as defaultContent }` 与其默认参数（:256）已删除，`runPolicyRound(state, ctx, day, config: PolicyConfig, influence = 0)` 改为必填，三个调用点显式传 `content.balance.policy`；`eslint.config.js` 的 group 已补 `'@/content'`/`'**/content'`/各自子路径，临时 probe 实测可拦截 | 消除 systems→content 的最后一条边；配置由调用方注入，`systems` 回到纯函数形态（详见 `docs/architecture-review-2026-11-20.md` §4.1） |
| 17 | 依赖方向 `ui → core, storage` | `ui` 还**只读** import 了 `systems`（现为 **11 个 ui 文件 / 13 个 systems 模块**：`PlayerPanel`/`CharacterCard`/`RegionPanel`/`OrganizationPanel`/`CreateCharacterDialog`/`SuggestionsPanel`/`CountryPanel`/`ArmyPanel`/`App` 之外的 `app/signalsFeed`、`app/lifecycle`、`app/appTypes`），涵盖 `character/{Profile,Career,Relations,SkillEffects,Check,CharacterCreator}`、`organization/{Organization,Shares}`、`country/Offices`、`military/WarSystem(isAtWar)`、`goals/{Goals,Ambition}` 与 `region/RegionNews` | 都是纯展示用的纯函数（**零写操作**）。**已认定为既定例外**并写进 §4.2 铁律 1：沉到 `ui/` 会让 `ui` 反向依赖更多 `systems`（`Goals.suggestGoals` 依赖 `Career`/`Offices`/`Shares`），反而更差。详见 `docs/architecture-review-2026-11-20.md` §4.2 |
| 18 | `core/Chronicler.ts` 属内核 | 确实属内核：`GameEngine.record()`（`src/core/GameEngine.ts:580`）对每条历史调用 `composeChronicle()`，产出 `summary/subject/place`；`ui/HistoryPanel` 与 `tests/chronicle.test.ts` 只是复用其中的 `humanize()`/`entityNames()` | 位置正确，无需迁移。缓存失效键的隐患**已修复**：改为显式 `invalidateEntityNames(state)`（`src/core/Chronicler.ts`），6 处实体写入点（`CharacterCreator` / `Demography`×2 / `Ruler` / `OrganizationSystem`）全部调用，并有回归用例 |

### 5.3 模块职责与里程碑归属

| 文件 | 职责 | 关键导出 | 里程碑 |
|---|---|---|---|
| `index.html` | 唯一挂载点、字体与 meta、首屏骨架样式 | — | M0 完成 |
| `package.json` | 脚本：`dev` / `build` / `release` / `preview` / `typecheck` / `test` / `test:watch` / `sim` / `lint` / `format`；devDeps 含 `tsx` | — | M0 完成 |
| `tsconfig.json` | strict、`noUncheckedIndexedAccess`、`moduleResolution: bundler`、路径别名 `@/*` | — | M0 完成 |
| `vite.config.ts` | singlefile 插件、`assetsInlineLimit: 100_000_000`、`build.target: es2022`、vitest node 环境 | — | M0 完成 |
| `eslint.config.js` | core/systems 禁 import ui/storage；禁 `Math.random` 与 `new Date()` | — | M0 完成 |
| `src/main.ts` | 引导：加载内容 → 校验 → 读档 → `App.mount` | — | M0 / M5 完成 |
| `core/WorldState.ts` | 状态与内容类型、工厂、完整性校验、状态哈希 | `WorldState`, `WorldContent`, `createWorld()`, `validateWorld()`, `hashWorld()`, `monthKeyOf()`, `SCHEMA_VERSION = 9` | M1 完成 |
| `core/GameClock.ts` | 360 天/年、相位枚举、结算点、下一边界、日期格式化 | `GameClock`, `DAYS_PER_YEAR`, `Phase`, `settlementPoints()`, `nextBoundary()` | M1 完成（`nextInterrupt()` 未实现） |
| `core/CommandBus.ts` | 命令联合类型（已扩到 M7 的全部动词）、校验与结算 | `Command`, `applyCommand()`, `CommandResult`, `describeCommand()` | M1 完成，M2–M7 持续扩展 |
| `core/GameEngine.ts` | 唯一写入口与时间推进；按六相位结算 | `GameEngine`（`dispatch` / `advanceDays` / `advanceTo` / `choose` / `hash` / 只读 `state`） | M1 完成（**无** `snapshot`/`subscribe`，UI 用 `refresh()` 轮询） |
| `core/Random.ts` | FNV-1a 种子派生、命名流、计数器、快照 | `Random`, `fnv1a64()`, `keyOf()` | M1 完成 |
| `core/EventEngine.ts` | 条件求值、λ 风险、互斥竞速、冷却、效果应用、后续事件、文本与占位符 | `evaluate()`, `collectCandidates()`, `selectTriggered()`, `applyEvent()`, `eventText()`, `eventTextForRefs()` | M1 完成，M4/M7 扩展 |
| `core/History.ts` | 追加式历史、查询、月度摘要 | `History`, `HistoryRecord`, `HistoryKind` | M1 完成 |
| `core/SimulationTier.ts` | L1/L2/L3 评分与升降层、国家聚合 | `Tier`, `computeTiers()`, `applyTiers()` | M1 完成 |
| `core/Chronicler.ts` | 编年史投影：裸 id → 专名、推出主体（subject）与地点（place） | `entityNames()`, `nameOf()`, `regionOfRef()`, `humanize()`, `composeChronicle()` | M7 完成（`GameEngine.record()` 在 :580 调用 `composeChronicle()`，见评审文档 §2） |
| `systems/character/Character.ts` | 人物查询、派生技能、财富转移 | `effectiveSkill()`, `transferWealth()` | M4 完成 |
| `systems/character/CharacterSystem.ts` | 月度酬金、年度老化、死亡与领袖继承 | `settleMonthlyCharacters()`, `settleYearlyCharacters()`, `handleDeath()` | M4 完成（年度循环已由 `Demography` 接管） |
| `systems/character/Demography.ts` | 年度衰老/死亡、婚姻建族、出生继承、具名人口下限补员 | `settleYearlyDemography()` 等 | M4 完成 |
| `systems/character/CharacterCreator.ts` | 出身 6 种、天赋 3 标签、姓名/性别/信仰/归属，白身入场 | `TALENT_PICKS`, `TALENT_TAGS`, `createCharacter()` | M4 完成 |
| `systems/character/Profile.ts` | 阵营双轴与九宫格、信仰、地点 | `alignmentLabel()` 等 | M4 完成 |
| `systems/character/Career.ts` | 生涯四阶、月俸、晋升与降级、转行 | `switchCareer()` 等 | M4 / M7 完成 |
| `systems/character/Relations.ts` | 关系网双向边、年度回归 | `bumpRelation()`, `setRelation()` | M4 完成 |
| `systems/character/Retire.ts` | 退场：旧位置按规则移交 NPC | `retireCharacter()` | M4 完成 |
| `systems/character/Activity.ts` | 行动力（3/月，上限 6）与健康 0–100 | 动词前置条件与消耗 | M7 阶段 3 完成 |
| `systems/character/SkillEffects.ts` | 技能每级折算（买价/卖价/运力/利率/游说/打听） | `purchaseFactor()`, `saleFactor()`, `tradeCarryCapacity()`, `skillEffectSummary()` | M7 阶段 7 完成 |
| `systems/character/Check.ts` | d20 检定：加值、门槛、文案 | `checkBonus()`, `describeCheck()`, `rollCheck()` | M7 阶段 7 完成 |
| `systems/character/SkillCheck.ts` | 技能对抗检定（M4 骨架） | `skillCheck()`, `opposedCheck()` | M4 骨架（实跑走 `Check.ts`） |
| `systems/organization/Organization.ts` | 股权、控股、继承顺序、估值 | `majorityHolder()`, `successionOrder()`, `valuation()` | M2 完成 |
| `systems/organization/Finance.ts` | 月度损益、权益与会计恒等式、分红 | `settleMonthlyFinance()`, `equityOf()` | M2 完成，M7 阶段 2 补分红 |
| `systems/organization/OrganizationRisk.ts` | 冲突/资金/规模的风险增量 | `settleMonthlyRisk()` | M2 完成 |
| `systems/organization/Lifecycle.ts` | active → crisis → restructuring → dissolved 与清算顺序 | 生命周期状态机 | M2 完成 |
| `systems/organization/ContractSystem.ts` | 供货/运输/贷款/雇佣契约 | 契约签订与月度结算 | M2 完成 |
| `systems/organization/Shares.ts` | 股份买卖、未登记份额、34% 门槛 | `shareOf()`, `canClaimLeadership()`, `unassignedShare()` | M4 完成 |
| `systems/organization/OrganizationSystem.ts` | 月度编排：财务 → 风险 → 生命周期 | `monthlyOrganizationSettlement()` | M2 完成 |
| `systems/country/CountrySystem.ts` | 月度预算、债务、稳定性聚合 | `settleMonthlyCountry()`, `capitalOf()` | M3 完成 |
| `systems/country/PolicySystem.ts` | 政策压力、提案、政体差异 | `evaluatePolicyPressure()`, `runPolicyRound()`, `capitalWeight()` | M3 完成 |
| `systems/country/Ruler.ts` | 统治者/摄政/继承危机 | 继承与摄政规则 | M3 / M7 阶段 6 完成 |
| `systems/country/Offices.ts` | 三席任命、评分门槛、谋求公职 | `officeIdOf()`, `officeSeatsFor()`, `applyForOffice()`, `influenceOf()` | M4 完成 |
| `systems/economy/MarketSystem.ts` | 地区×商品价格与库存 | `settleMonthlyMarket()`, `priceOf()` | M2 完成 |
| `systems/economy/ProductionSystem.ts` | 投入产出、产能、效率 | `settleMonthlyProduction()` | M2 完成 |
| `systems/economy/TradeSystem.ts` | 商路流量、运力、关税、COGS 单一口径 | `settleMonthlyTrade()` | M2 完成，M7 阶段 2 改口径 |
| `systems/npc/DecisionSystem.ts` | 效用评分与月度决策（组织 + 内阁） | `strategyUtility()`, `settleMonthlyDecisions()`, `settleCountryDecisions()` | M3 完成 |
| `systems/military/WarSystem.ts` | 军费、宣战、行军、会战、围城占领、厌战议和、AI 宣战 | `settleMonthlyMilitary()`, `declareWar()`, `isAtWar()`, `settleMonthlyWar()`, `makePeace()`, `battlePower()` | M6 完成 |
| `systems/goals/Goals.ts` | 建议事项三条与每条的数值依据 | `suggestGoals()` | M7 阶段 5 完成 |
| `systems/goals/Ambition.ts` | 野心推导（富甲一方/权倾朝野/名动四方）与章节标题 | `ambitionOf()`, `chapterOf()` | M7 阶段 5 完成 |
| `content/index.ts` | 唯一 JSON 装配器；事件按 id 排序 | `content`, `CONTENT_VERSION = '0.7.0'`, `eventsById` | M1 完成 |
| `content/*.json` | 静态内容；`world.json` 7 国 14 区 54 人、`organizations.json` 21 家、`goods.json` 4 商品，另有信仰 6 / 出身 6 / 名字池 4 文化 | — | M1 完成，M6.1/M6.2 扩到当前规模 |
| `content/events/*.json` | **90 条**事件（本地 42 / 国家 20 / 组织 13 / 冒险 9 / 战争 3 / 经济 3），含事件链、抉择与互斥组 | — | M1 完成，M2–M7 扩展 |
| `storage/SaveManager.ts` | 信封、序列化与校验、IndexedDB 槽位、文件导入导出 | `createEnvelope()`, `serializeSave()`, `parseSave()`, `readSlot()`, `writeSlot()`, `listSlots()`, `deleteSlot()`, `downloadSave()`, `readSaveFile()` | M1 基础完成 |
| `storage/Migration.ts` | 信封与世界状态迁移、错误类型 | `SAVE_FORMAT`, `SAVE_FORMAT_VERSION = 9`, `SaveError`, `migrateSave()`, `migrateWorldState()` | 逐级迁移 v1→v9（`SCHEMA_VERSION = 9`） |
| `scripts/sim.ts` | 无 UI 快进、摘要、耗时、`--check` 复跑 | — | M1 完成 |
| `scripts/release.mjs` | 发布校验（存在/无外链/体积）并复制 | — | M0 完成 |
| `release/index.html` | 仓库内成品单文件（374,280 字节） | — | 每阶段更新 |
| `tests/helpers/index.ts` | 固定内容 + 固定种子的测试夹具 | `makeWorld()`, `makeEngine()` | M1 完成 |
| `ui/*` | 布局、玩家卡、地形地图、人物/组织/国家/军团面板、事件与抉择弹窗、历史/编年史、存档对话框、创建人物、建议事项、引导 | — | M5 完成，M6/M7 扩到 20 个 `.ts` + `styles/base.css` |

**依赖方向（代码实测）**：`ui → core, storage`，并且 `ui` 还会**只读**引用 `systems` 的 10 个纯函数文件（`CharacterCreator` / `Organization` / `Shares` / `Profile` / `Career` / `SkillEffects` / `Relations` / `Offices` / `Check` / `WarSystem(isAtWar)` / `goals.Goals` / `goals.Ambition`）；`core → systems, content`；`systems → core（类型）`，唯一例外是 `systems/country/PolicySystem.ts:25` 从 `content` 取 `balance.policy` 作为 `runPolicyRound()` 的默认参数；`content` 不依赖任何代码。反向依赖 `core|systems → ui|storage` 由 ESLint `no-restricted-imports` 拦截（`eslint.config.js:44`），**但该规则不拦 `../content`**，所以上面那条例外能通过 lint——评审文档把它记为偏差 ②。

---

## 6. 核心数据模型（草案）

类型定义分散在各自模块，`WorldState.ts` 只做聚合与校验。以下结构已按 v0.2 代码校准（以 `src/core/WorldState.ts` 为准）。

```ts
// core/WorldState.ts
interface WorldState {
  meta: { schemaVersion; contentVersion; seed; createdAt; worldId };
  clock: { day: number };                   // day 从 1 开始
  playerId: CharacterId;
  characters: Record<CharacterId, Character>;
  organizations: Record<OrgId, Organization>;
  countries: Record<CountryId, Country>;
  regions: Record<RegionId, Region>;
  markets: Record<MarketKey, Market>;       // `${regionId}:${goodId}`
  contracts: Record<ContractId, Contract>;
  relations: Relation[];                    // 有向边
  armies: Record<ArmyId, Army>;
  tiers: Record<EntityId, 1 | 2 | 3>;
  pendingEvents: ScheduledEvent[];          // 按 (day, phase, seq) 稳定排序
  rngCounters: Record<string, number>;
  cooldowns: Record<string, number>;        // `${eventId}@${entityId}` → 解禁日
  history: HistoryRecord[];
  scheduleSeq: number;                      // 调度序号，只增不减
}
```

```ts
interface Organization {
  id: OrgId; name: string; type: OrgType; industry: GoodId | 'service';
  foundedDay: number; homeRegionId: RegionId;
  scale: number;                     // 综合规模 0–100+
  cash: number; assets: number; liabilities: number;
  members: number; payrollMonthly: number;
  leadership: { leaderId: CharacterId; legitimacy: number };  // 0–1
  conflict: number; governance: number; efficiency: number;   // 0–1
  strategy: 'expand'|'steady'|'contract'|'pivot';
  lifecycle: 'founded'|'growing'|'stable'|'expanding'|'crisis'|'restructuring'|'shrinking'|'dissolved';
  shares: { characterId: CharacterId; share: number }[];      // 所有权；治理权由 leadership 表达
  lastMonthRevenue: number; lastMonthCost: number;            // 上月经营数据，供 UI 与再投资
}
```

```ts
interface Country {
  id: CountryId; name: string; polity: 'monarchy'|'republic';
  regionIds: RegionId[]; population: number;
  treasury: number; monthlyRevenue: number; monthlyExpense: number;
  debt: number; military: number;
  legitimacy: number; stability: number;   // 0–1，聚合值
  rulerId: CharacterId;
  policies: PolicyVector;                  // 税率/关税/军费/贸易自由度/监管强度
  diplomacy: Record<CountryId, number>;    // -100..100（M3 起使用）
}
```

```ts
interface Market {
  regionId: RegionId; goodId: GoodId;
  stock: number; production: number; demand: number;
  price: number; floor: number; ceiling: number;
  importCapacity: number; exportCapacity: number;
}
```

```ts
interface EventDef {
  id: string; domain: 'organization'|'country'|'economy'|'adventure';
  scope: 'organization'|'country'|'region'|'character';
  conditions?: Expr;                // 受限 DSL：all / any / not / {path,op,value}
  risk: { lambda0: number; terms: { path: string; coef: number }[] };
  exclusivity?: string;             // 同组事件互斥
  cooldownDays: number;
  weight?: number;
  effects: Effect[];                // add / mul / set / schedule
  text: { title: string; body: string };   // 当前内联中文，非 i18n key
}
```

**约定**

- 所有金额为整数"铜币"，避免浮点误差；比率用 0–1 浮点。
- 所有 0–1 的抽象指标（合法性、冲突、治理）在内部统一为 0–1，展示层再乘 100。
- 所有 ID 为稳定字符串（`org_blackcrow`），不使用自增数字，便于跨层与存档迁移。
- 时间统一存 `day`（整数），派生 `year/month/dayOfMonth` 只读计算。
- **与计划的差异**：`EventDef` 不再用 `titleKey/bodyKey`，也没有 `choices`；事件选项属于 M5 的 UI 工作，玩家干预统一走 `Command`（见 §5.2 第 8 条）。

---

## 7. 关键机制设计

### 7.1 时间与结算

- 历法：1 年 = 12 月 × 30 天 = 360 天；`day=1` 表示 1 年 1 月 1 日。
- 队列项：`{ day, phase, seq, kind, refId }`；`seq` 为入队序号，保证同日同相位稳定排序。
- 月结：每月第 30 天相位 2；季结：3/6/9/12 月末相位 3；年结：12 月 30 日相位 5。
- 倍速（1/7/30×）只影响**渲染节奏**，不改变结算语义：一次 `advanceTo` 与多次 `advanceTo` 结果必须一致。
- 中断：`nextInterrupt()` 返回"需要玩家决策"的最近节点（事件选项、合同到期、威胁生命、快进设置）。中断不消耗时间。

### 7.2 随机与可复现

- 算法：PCG32（32 位状态，易序列化，质量足够）。
- 派生键：`rngKey = ${stream}:${entityId}:${periodKey}`，`periodKey` 为结算点（如 `m120`）。
- 同一键多次取数时，用 `rngCounters[key]` 自增，保证"同一结算点内第 n 次抽样"稳定。
- 世界种子为字符串（如 `"T&G-2026-0001"`），`hashSeed()` 转为 64 位初始状态。
- **禁止**：`Math.random()`、`Date.now()` 参与模拟、`crypto.randomUUID()` 生成实体 ID（ID 由内容或确定性序列生成）。
- 验收：同种子 + 同命令序列，逐月与一次快进的最终状态哈希必须相同（测试 F）。

### 7.3 事件引擎

1. **加载期**：`content/index.ts` import JSON → TypeScript 在编译期按 `EventDef` 校验形状 → `validateWorld()` 在运行时校验引用（事件效果指向的组织/地区/人物必须存在）→ 失败则测试或构建报错。**说明**：未引入 JSON Schema 校验库，"编译条件为闭包树"也未实现，条件在每个结算点按 `Expr` 直接求值（内容量级下开销可忽略，见 §5.2 第 2、8 条）。
2. **风险计算**：`λ = λ0 × exp(Σ βᵢ·xᵢ)`，`xᵢ` 为归一化状态变量（0–1 或 z-score 后 clamp）。
3. **抽样**：对区间 `Δt`，`P = 1 − exp(−λ·Δt)`；同一 `exclusivity` 组内用指数竞速：`t_i = −ln(U_i)/λ_i`，取最小 `t_i` 且 `t_i ≤ Δt` 者发生，其余进入冷却。
4. **条件**：事件发生前必须通过 `conditions`（避免"高风险但条件不满足"仍被抽中）。
5. **效果**：只允许 `add` / `mul` / `set` / `schedule` 四类；每个效果写一条 `HistoryRecord`，`causeEventId` 指回触发事件，保证可追溯。
6. **后续事件**：`schedule` 效果写入 `pendingEvents`，`seq` 由 `scheduleSeq` 递增生成，形成事件链。
7. **玩家干预**：**尚未实现**。计划中的 `choices`（每项声明成本、成功率、可见/隐藏后果）随 M5 的事件弹窗一起做；在此之前玩家干预只能走 `CommandBus`，不直接改状态。

### 7.4 组织财务

- 月度损益：`利润 = 销售收入 − 采购成本 − 人工 − 运输 − 行政 − 利息 − 税费 − 损失`。
- 恒等式（每次月结后断言）：`资产 = 负债 + 所有者权益`；`现金变动 = 经营现金流 + 投资现金流 + 融资现金流`。
- 资产购买、贷款**不计入利润**，只改变结构。
- 违约流程：到期未付 → 宽限期（1 月）→ 重组（展期/债转股/出售资产）→ 清算；不得直接删除组织。
- 玩家三权分离：`shares` 决定分红与投票权，`positions` 决定治理权，`reputation/relations` 决定影响力；罢免通过 `OrganizationSystem` 的投票结算，不由 UI 直接改写。

### 7.5 市场与生产

- 价格：`P' = clamp(P × (1 + α·(D − S) / max(D, S, ε)), floor, ceiling)`；`α` 按商品配置（粮食 0.08、铁矿 0.12、武器 0.10、奢侈品 0.15，初值，待校准）。
- 生产：`产量 = min(劳动力上限, 原料上限/投入系数, 产能) × 效率 × 政策修正 × 安全修正`。
- 商路：运力、运费、时效、关税、战损概率；路由按最短路 + 容量约束分配。
- 不变量：区域内商品守恒（期初 + 产 + 入 − 出 − 消耗 = 期末），每次月结断言。
- 金币不强制全局守恒（税收/铸币/外部贸易是显式通道），但每笔注入必须记录 `cause`，便于审计数值膨胀。

### 7.6 国家与政策

- 预算：`收入 = 税基 × 税率 + 关税收入 + 国营收入`；`支出 = 行政 + 军费 + 公共支出 + 债务利息`；赤字进入债务。
- 稳定性：由财政压力、合法性、派系冲突、经济景气、战争疲劳加权，不做单一"稳定度"。
- 政策三阶段：压力（λ 计算）→ 提案（派系按利益打分选择方向）→ 决策（政体规则：君主制看统治者+贵族反对度；共和制看议会席位）。
- 政体变更：门槛极高，需连续 N 个季度满足条件 + 成功判定，变更后同步更新职位权限与政策选项。

### 7.7 NPC 决策

- 候选行动 8–12 个（投资、扩张、招募、结盟、竞选、举报、走私、休整）。
- `U(a) = Σ wᵢ·E[effectᵢ] − RiskCost(a) − ActionCost(a)`；性格权重来自 `traits`。
- 重要 NPC 每月决策一次；普通 NPC 用群体率（离职率、犯罪率、迁移率），不逐个规划。
- 决策记录写入 History（只记重要 NPC），供"世界观察"与调试回溯。

### 7.8 分层模拟

- 分层评分：`attention = w1·距离 + w2·关系强度 + w3·资产规模 + w4·玩家关注标记`；超过阈值升层，低于阈值降层。
- 降层时聚合：组织财务折算为区域行业总量，人物折算为群体统计；**保留 ID 与关键历史**，升层时按聚合值展开，不得凭空生成与历史矛盾的细节。
- 一致性约束（GDD 4.3）：唯一权威财政、资产不重复、ID 跨层一致、已发生事件不可撤销。

### 7.9 存档、迁移与回放

**已实现（v2.0.0，代码见 `src/storage/`）**

- 信封：`SaveEnvelope = { format: 'throne-and-gold-save', formatVersion, schemaVersion, contentVersion, savedAt, seed, day, hash, state }`；`formatVersion` 当前为 **`9`**（`SAVE_FORMAT_VERSION`，`src/storage/Migration.ts:23`），与状态自己的 **`SCHEMA_VERSION = 9`**（`src/core/WorldState.ts:25`）分开演进。
- 写入：`createEnvelope(state, savedAt)` → `serializeSave()`；读入：`parseSave(text)` 依次做 JSON 解析 → `migrateSave()`（拒绝非对象、未知版本、更高版本、缺 `schemaVersion`）→ `validateWorld()` → `hashWorld()` 与信封 `hash` 比对，任何一步失败抛 `SaveError`（`name = 'SaveError'`）。
- 槽位：IndexedDB `throne-and-gold` / store `saves` / keyPath `slot`；API `writeSlot(slot, state, label, savedAt)`、`readSlot(slot)`、`listSlots()`（按 `savedAt` 倒序）、`deleteSlot(slot)`、`storageAvailable()`。自动存档键名 `AUTO_SLOT = 'auto'`，**滚动 3 槽仍未实现**（只有 `auto` 约定，自动存档每 30 天写入一次）。
- 导入导出：`downloadSave(state, filename = 'throne-and-gold-save.json')` 与 `readSaveFile(file)`；文件名不是计划里的 `.tg.json`。
- 迁移：`src/storage/Migration.ts` 共 351 行，含真实迁移链 **`migrateV1` … `migrateV8`**，逐级把 v1 的存档升到 v9；`migrateSave(raw, savedAt)` 升信封，`migrateWorldState(raw)` 升状态。`tests/migration.test.ts` **8 例**覆盖：v1 一路迁到当前版本、更高版本拒绝、坏 JSON 拒绝、迁移后 hash 失效需重算、旧档续跑 10 年不炸。**§9.2 的 R8 仍然只由内容审计与 `validateWorld` 间接覆盖，没有独立的 schema 校验用例。**

**规划中（未实现）**

- 回放：`seed + 命令日志` 重建世界、回放哈希校验。当前只有 `engine.hash()` 与 `pnpm sim --check` 的"同参数复跑比哈希"，没有命令日志落盘。
- 压缩与分片：存档未压缩；大世界写入耗时未测（§9.3 预算待验证）。
- 自动存档滚动多槽（3 槽）与云同步（不在路线图内）。

### 7.10 界面

- 布局：顶栏（日期/倍速/身份/财富/通知）+ 左（人物）+ 中（地图）+ 右（情报）+ 底（行动/事件卡）。
- 组件契约：`mount(el)`、`update(snapshot)`、`dispose()`；只读快照，不持有可写引用。
- 地图：SVG 分层（地形、边界、城市、商路、军队），四图层切换；缩放用 `viewBox`。
- 事件弹窗：背景、触发原因（引用历史）、已知情报、选项、成本、风险、隐藏后果。
- 通知：三级（打断/横幅/日志），玩家可在设置中调整优先级。
- 性能：单次 `update` < 16 ms；地图重绘只在图层或选择变化时发生。

---

## 8. 里程碑与排期

以启动周为 W1，共 16 周。每周 5 个工作日，按 1 人 + AI 结对估算。

### 8.1 当前进度（v2.0.0 实测，M0–M7 全部完成）

| 里程碑 | 状态 | 证据（仓库内可核对） |
|---|---|---|
| M0 工程基线 | ✅ 完成 | `pnpm build` / `pnpm release` 脚本齐备；`release/index.html` 已入仓（当前 374,280 字节，预算占用 23.8%）；CI 四步全配 |
| M1 模拟核心 | ✅ 完成 | 9 个 core 模块、34 个 systems 文件（8 域）、内容装配、存档、`pnpm sim`；100 年模拟 3.33–3.77 s（预算 4.0 s），同种子哈希稳定；R8 仍由内容审计与 `validateWorld` 覆盖；证据见 §8.2 |
| M2 组织与经济 | ✅ 完成 | 生命周期四态与清算、契约（供货/运输/贷款/雇佣）、市场份额竞争、在途货运与关税、四类风险系数表、组织事件；验收 B/D 已断言，100 年破产率 22.2–31.6%、分裂率 5.6–10.5%；证据见 §8.3 |
| M3 国家与政策 | ✅ 完成 | 政策三阶段 + 传导经济 + 政体不变式 + 国家事件 + 内阁决策；验收 C 已断言；100 年政策变更 17/18/25 次、均价偏离 12.8–16.3%、20/20 市场在 70–140%；证据见 §8.6 |
| M4 角色与叙事 | ✅ 完成（M4.1–M4.6） | 人物档案、人口学、开局创建（6 背景 × 3 天赋）、关系网（五类有向关系 + 年度回归）、生涯阶梯、事件链与抉择（`choices` + `choose` + d20 检定）已落地；100 年 demo 存活 45 人、破产率 17.9%、价格偏离 14.3%；验收报告见 `docs/acceptance.md`；证据见 §8.7–§8.12 |
| M5 整合与校准 | ✅ 完成 | `src/ui/` 20 个 `.ts` + `styles/base.css`（玩家卡 + 地形地图 + 人物/组织/国家/军团/事件/历史面板 + 时间控制 + 多槽位存档 + 人物创建 + 建议事项 + 引导 + 快捷键），单文件可离线游玩；四种地图图层与像素级美术未做；证据见 §8.14 |
| M6 战争与扩展 | ✅ 完成（M6 + M6.1 + M6.2） | 战争：常备军（规模/训练/士气/统帅）、宣战、行军、会战、围城与占领、厌战与议和、AI 宣战，`balance.war` 参数化（§8.13）；扩展：7 国 / 14 区 / 21 组织 / 54 人物 / 4 文化、事件扩到 90 条，14 区 100 年 2.6–2.9 s（§8.16、§8.23）；开局创建、股份交易、公职谋求、军团指挥与平衡校准见 §8.17–§8.22；发布见 §8.24 |
| M7 打磨与发布 | ✅ 完成（阶段 1–7，v2.0.0） | 可玩性抢救、经济闭合、个人动词与行动力、叙事与专名、目标与新手、模拟深化、打磨与发布；33 个测试文件 / 207 例全绿；证据见 §8.30–§8.39 |

> 收尾状态（2026-11-20）：M0–M7 全部完成，版本 2.0.0；**33 个测试文件 / 207 例**全绿；`release/index.html` **374,280 字节（预算 23.8%）**；CI run 34 与 Pages run 31 均 success；100 年三 seed `--check` 全部一致（指标见 `docs/acceptance.md` §11–§12）。

### 8.2 M1 收尾修复（2026-11-19）

审计（内容只读审计 + 逐月探针）后修掉的问题，按影响排序：

| 问题 | 根因 | 修法 |
|---|---|---|
| 100 年模拟 130 s，超预算 65 倍 | `GameEngine.settlePhase` 每个相位都调 `syncCounters()`，而 `Random.countersOf()` 复制全量计数器表 → O(n²) | 只在 `advanceDays`/`advanceTo` 结束与 `dispatch` 失败分支同步；实测降到 1.3 s |
| 所有组织 2 年内现金归零 | `Finance` 把上月全量成本 `lastMonthCost` 当成"运输成本"再扣一次 | 新增 `Organization.lastMonthTransport`，贸易只登记、财务只扣一次 |
| 只要有一个月结余，粮价永久钉在下限 | 市场用 `stock + production` 作为当月供给参与竞价 | 供给 = 当月 `production`，`stock` 仅作缓冲库存 |
| 组织"卖出"超过市场需求的货，现金与国库无限膨胀 | 收入 = 产量 × 价格，与需求无关 | 同地区同行业按产量份额瓜分当月需求（`sellableUnits`）；留存现金超 12 个月工资转资产 |
| 国库长期盈余无限膨胀 | 只有税收流入，没有泄压阀 | 超 6 个月刚性开支的部分，一半用于公共工程（可选支出，不计入赤字判定） |
| 角色类事件永不触发 | `computeTiers` 不给人物分层，`?? 3` 被 `maxTier=2` 过滤 | 人物按"所在地区 / 所属组织"继承层级；新增回归用例 |
| 同盟地区与组织在第 90 天后整体冻结 | 跨国地区需分数达标才升 L2，同盟地区恒 L3 | 2 跳内地区一律 L2，L1/L2 地区内的组织一律 L2 |
| 政变 / 分裂 / 战争恐慌事件永不触发 | 阈值高于内容初值，且无增长机制 | 政变 `conflict>0.3`、分裂 `>0.45`；战争恐慌改用 `debtRatio`（国家口径 = 债务/(国库+债务)） |
| `ev_country_aftermath` 脱离前置事件独立触发 | 无前置约束、λ0 过低 | 加 `stability<0.6` 条件、λ0 提至 0.01、效果改为扣国库 |

> 结论：**M1 之后进入"测试与性能收尾"，而不是直接宣布 M2–M4 完成**。M2–M4 的代码骨架先行为的是让 100 年模拟有足够多的耦合面，退出标准仍按下表执行。

### 8.3 M2 组织与经济（2026-11-19）

| 机制 | 实现 | 证据 |
|---|---|---|
| 生命周期 | `Lifecycle.ts`：active → crisis（宽限）→ restructuring（出售资产/裁员/展期）→ dissolved；清算顺序 债主 → 欠薪 → 股东，差额记 `shortfall` 并入历史 | `tests/economy-m2.test.ts`、验收 D |
| 契约 | `ContractSystem.ts`：供货 / 运输 / 贷款 / 雇佣，含到期日、违约金、抵押处置；新命令 `sign_contract`、`break_contract`、`restructure`、`sell_asset` | 验收 B、D |
| 竞争 | 同地区同行业按吸引力（价格/质量/商誉）分配 `marketShare`，份额和 = 1；NPC 组织可新进入 | 验收 B |
| 运输与关税 | 在途 `Shipment` + 运输延迟 + 3% 损耗 + 运力上限；跨国按目的地国 `tariffRate` 收关税入国库 | 验收 B |
| 风险 | 分裂 / 破产 / 腐败 / 骚乱四类只读 `balance.risk` 系数表，`hazard = λ0·exp(Σcoef·feature)` | `OrganizationRisk.ts` |
| 事件 | 组织事件 4 → 10 条（继承纠纷、挤兑、罢工、并购、走私被查、商路断绝等），经济事件 3 条 | 30 年三 seed 每条 ≥1 次 |
| 确定性与性能 | `Random` 改为 FNV-1a 32 + splitmix32（命名流不变）；100 年 1.42–1.73 s | `pnpm sim --check` |
| 存档 | `SCHEMA_VERSION` / `SAVE_FORMAT_VERSION` 升到 2，新增 v1 → v2 迁移（补齐契约、货运、份额、风险字段；跨版本迁移后丢弃旧哈希） | `tests/migration.test.ts` |

**已知问题**：同盟的 grain / iron 长期顶在价格上限（三 seed 价格偏离 120–128%），根因是"本地无生产 + 进口运力不足"，计划在 M3 用本地生产与运力解决，不靠调参掩盖。`release/index.html` 由 M1 的 2,730 字节增长到 145 KB（预算占用 9.2%）。`tests/simulation.test.ts` 的 100 年双跑用例超时从 5 s 放宽到 20 s（单次约 1.7 s，双跑必超 5 s，非逻辑改动）。

| 里程碑 | 周期 | 目标 | 退出标准 |
|---|---|---|---|
| M0 工程基线 | W1 | 可构建、可测试、可发布单文件 | `pnpm build` 产出可双击运行的 `dist/index.html`；`pnpm test` 跑通空测试 |
| M1 模拟核心 | W2–W4 | 无 UI 可稳定模拟简化世界 | 控制台可跑 100 年，状态哈希稳定；存档往返一致 |
| M2 组织与经济 | W5–W7 | 商会可创建、经营、竞争、破产 | 验收测试 B、D 通过；组织指标分布合理 |
| M3 国家与政策 | W8–W10 | 政策可自主变化并与经济联动 | 验收测试 C 通过；100 年模拟无政策抖动 |
| M4 角色与叙事 | W11–W13 | 完整人物生涯与事件链 | 验收测试 E 通过；一名角色可完成"商人→从政"路径 |
| M5 整合与校准 | W14–W16 | 完整 UI、性能达标、数值校准 | 验收测试 A、F 通过；包体与性能达标；可发布 |
| M6 战争与扩展 | W17+ | 战争、七国、魔法经济 | 单独立项，不在本计划承诺 |

> **M4 及以后的细化路线**见 [docs/roadmap-m4-plus.md](docs/roadmap-m4-plus.md)：M4 拆成 6 个子迭代并重新计价为 **36 人日**（原 15 人日不含世代更替/事件链/抉择/人物档案），M5 24 人日、M6 36 人日，合计 **96 + 6 缓冲 ≈ 21 周**；决策记录见该文件 §0.1，人物档案模型（六维 / 阵营九宫格 / 信仰 / 地点）见 §2.0.1。

### 8.4 薄 UI（2026-11-19）

`src/ui/` 12 个文件，纯原生 DOM + SVG，零依赖：

| 区域 | 文件 | 能力 |
|---|---|---|
| 布局与状态 | `App.ts` / `context.ts` | 顶栏（日期/玩家/现金/速度/哈希）、页签、toast、统一刷新 |
| 地图 | `MapView.ts` / `RegionPanel.ts` | 5 个地区 + 连线（标注行程天数）、键盘可达；点选后显示 4 商品价格/库存/需求与该地组织 |
| 人物 | `CharacterPanel.ts` | 玩家属性/技能/职位 + 其余 19 名 NPC 只读卡片 |
| 组织 | `OrganizationPanel.ts` | 现金/资产/负债/成员/士气·效率/冲突/合法性/治理 + 玩家控制组织的 7 类操作 |
| 国家 | `CountryPanel.ts` | 两国财政与五条政策滑块 + 游说入口 |
| 事件与历史 | `EventDialog.ts` / `HistoryPanel.ts` | 预兆弹窗（不剧透结局）+ 最近 50 条可筛选历史 |
| 时间与存档 | `App.ts` + `SaveManager` | 暂停 / 1× / 7× / 30× / 跳下一事件；自动槽位保存、读取、导出、导入 |

验证：`release/index.html` 单文件 145,259 字节（无 `<script src>`、无 `<link href>`），真 Edge `file://` 打开探针输出 `panels=6 | buttons=69 | svg=1 | errs=0`。
已知取舍：士气用 `efficiency` 表达；预兆弹窗只显示占位文案，结算后的历史记录才显示事件正文；存档只做一个自动槽位；"跳下一事件"严格推进到 `pendingEvents` 最早日期，但引擎在月末 Event 相位才触发。


### M0 工程基线（W1，5 人日）

**任务**

1. `package.json`：脚本 `dev/build/preview/test/test:watch/typecheck/lint/sim`；依赖仅 `vite`、`vite-plugin-singlefile`、`typescript`、`vitest`、`eslint`、`prettier`。
2. `tsconfig.json`：`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、路径别名。
3. `vite.config.ts`：singlefile 插件；`build.assetsInlineLimit: 100_000_000`；`build.cssCodeSplit: false`；产物名固定 `index.html`。
4. `index.html`：`#app` 挂载点 + 首屏 loading 骨架。
5. 目录骨架与 `.gitignore`（`node_modules/`、`dist/`、`.tmp/`）。
6. ESLint 规则：禁止 `ui → systems` 反向依赖、禁止 `Math.random`。
7. CI（GitHub Actions）：`pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm build`，并检查产物大小。

**退出标准**：空项目可构建，产物能在 `file://` 下打开并显示"王座与黄金"标题；CI 绿。

### M1 模拟核心（W2–W4，15 人日）

**任务**

1. `WorldState.ts`：类型、`createWorld(content)`、`validateWorld()`（引用完整、金额非负、ID 唯一）。
2. `GameClock.ts`：日/月/年换算、结算队列、`nextBoundary()`、`nextInterrupt()`。
3. `Random.ts`：PCG32、`hashSeed`、命名流、计数器、快照。
4. `CommandBus.ts`：命令联合类型（`move`、`work`、`invest`、`createOrg`、`joinOrg`、`setStrategy`、`negotiate`、`lobby`、`advance`、`save`），校验器。
5. `GameEngine.ts`：`dispatch`、`advanceTo`、`snapshot`、`subscribe`；相位调度；错误隔离（单个系统异常不污染状态，事务式回滚）。
6. `EventEngine.ts`：加载/编译/校验、λ 计算、抽样、冷却、后续队列；先接 3 个示例事件验证管线。
7. `History.ts`：记录结构、索引、按月摘要。
8. `SaveManager.ts` + `Migration.ts`：快照序列化、槽位、v1 迁移空实现。
9. `content/world.json`：2 国 5 城的最小地理与初始实体（人物 20、组织 10 可先用占位数据）。
10. 测试：`fastforward.test.ts`（逐月 vs 快进等价）、状态哈希 golden test。

**退出标准**：Node 下 `pnpm sim --years 100 --seed X` 输出世界摘要与指标 JSON；两次运行哈希一致；存档→读档→再模拟 10 年与不中断模拟结果一致。

### M2 组织与经济（W5–W7，15 人日）

**任务**

1. `Organization.ts` / `OrganizationSystem.ts`：规模、治理、冲突、生命周期状态机。
2. `Finance.ts`：月度损益、资产负债、现金流、利息、税；恒等式断言。
3. `OrganizationRisk.ts`：四类风险强度函数（初值按 GDD 7.3 系数，写入 `balance.json`）。
4. `MarketSystem.ts`：库存、供需、价格公式、上下界。
5. `ProductionSystem.ts`：投入产出、产能、效率。
6. `TradeSystem.ts`：商路、运力、运费、关税、运输延迟。
7. `SimulationTier.ts`：L1/L2/L3 分配与升降层（先支持组织与地区）。
8. 事件：`content/events/organization.json` 10 个事件 + `economy.json` 前 3 个。
9. 测试：`organization.test.ts`（破产、分裂、收购、重组各 1 例）、`economy` 守恒与价格边界。

**退出标准**：验收测试 B（商业干预）、D（财务危机）通过；100 年模拟中组织破产率落在 15%–35%、分裂率 5%–15%（初值区间，允许校准调整）。

### M3 国家与政策（W8–W10，15 人日）

**任务**

1. `Country.ts` / `CountrySystem.ts`：预算、债务、稳定性聚合、国家事件结算。
2. `PolicySystem.ts`：政策向量、三阶段改革、政体差异、变更门槛。
3. `DecisionSystem.ts`：NPC 效用模型、月度决策、群体化统计。
4. `content/events/country.json` 8 个事件；`balance.json` 增加政策参数。
5. 分层扩展：国家与地区升降层、聚合公式。
6. 测试：`country.test.ts`（税率改革、政体不变式、债务违约）、NPC 决策单调性。

**退出标准**：验收测试 C（政策干预）通过；100 年内政策变更次数 8–25 次、政体变更 0–1 次；无"每月改税"抖动。

### M4 角色与叙事（W11–W13，15 人日）

**任务**

1. `Character.ts` / `CharacterSystem.ts`：属性、成长、年龄、健康、死亡、职位。
2. `SkillCheck.ts`：D20 检定、成功率预估、失败后果分级。
3. 冒险事件：`content/events/adventure.json` 6–8 个，含事件链。
4. 人物关系系统：关系类型、强度、事件影响、NPC 行为修正。
5. 历史与结局：人物结局生成、跨角色继承规则（只走法律/任命/买卖，不跨角色指定）。
6. 测试：`events.test.ts`（条件、互斥、冷却、链式）、`character` 死亡与继承。

**退出标准**：验收测试 E（人物死亡）通过；一名角色可完成"商人→商会会长→政治游说"完整路径；死亡后无资产重复与职位错继承。

### M5 整合与校准（W14–W16，15 人日）

**任务**

1. `App.ts` + 五个面板 + `MapView` + `EventDialog` + `HistoryPanel` + 样式（暗色奇幻主题）。
2. 交互闭环：行动菜单、事件选项、组织管理、政策查看与影响、快进与中断。
3. 存档完整化：自动存档、导入导出、迁移测试夹具。
4. 批量模拟：100 种子 × 100 年，产出指标报告；按报告调 `balance.json`。
5. 性能：快进 100 年 < 2 s（2 国 10 组织规模）；UI 单帧 < 16 ms。
6. 发布检查：单文件包体、离线打开、无控制台错误、跨浏览器。

**退出标准**：验收测试 A、F 通过；§13 清单全部打勾；产物可发布。

### 8.5 后续计价与人物档案（2026-11-19 拍板）

| # | 决策 | 结果 |
|---|---|---|
| D1 | M4 重新计价 | 15 → **36 人日**（7 周），拆 6 个子迭代 |
| D2 | 抉择中断语义 | 默认 `stopAtChoices: false`，批量模拟不受影响 |
| D3 | M6 性能 | 先做 L3 国家聚合（+4 人日并入 M6.1），预算分档「5 区 < 2 s、14 区 < 3 s」；**D7 修订（2026-11-19）**：14 区实测 2.8–3.1 s，分档改为 < 3.5 s；**M7 后修订（2026-11-20）**：加 42 条本地事件、编年史专名、战争与继承后实测 3.66–3.89 s，分档改为 < 4.0 s |
| D4 | 人物档案 | 六维 1–20（生成用「天赋标签 3 选」：默认 10、标签 +2、上限 16）；阵营九宫格（`law`/`good` 双轴 −100..100，随事件/抉择/命令动态调整、年度向 0 收敛）；`location.site`；`faith` 可为 `null` |

合计（参考值，**不设上限**）**96 人日 + 6 人日缓冲 ≈ 21 周**。类型定义、迁移规则（`SCHEMA_VERSION` 2 → 3）与验收用例见 [docs/roadmap-m4-plus.md](docs/roadmap-m4-plus.md) §2.0.1。

### 8.6 M3 国家与政策（2026-11-19）

| 项 | 实现 | 证据 |
|---|---|---|
| 政策三阶段 | `evaluatePolicyPressure` 七类压力 → 提案（成本 120 + 月收入 2%，国库不足转债务）→ 政体支持度 `0.35+legit*0.45+authority*0.2`（共和用 `capitalWeight`），`pressure*0.5+support*0.6 ≥ 0.45` 且 `pressure ≥ 0.6` 才通过 | `tests/policy.test.ts` 6 例；100 年 17/18/25 次变更，最小间隔 900 天 |
| 政策传导 | 关税进贸易成本与到港征收；`tradeFreedom` 影响容量/损耗/税基；`regulation` 压有效价格上限并抬行政成本；`taxRate` 进组织有效税率 | 验收 C：低关税毛利 45,025 vs 高关税 24,855 |
| 政体不变式 | `Ruler.ts` 的 `chooseRuler/spawnRegent/installRuler`；`validateWorld` 断言统治者在世；政体变更需连续 24 月合法性与稳定度崩溃 + 距上次 ≥240 月 + 50% 判定 | `tests/policy.test.ts` 强制崩溃用例 |
| 事件 | 国家事件 4 → 10 条（原 ID 未改），`harvest`/`throne` 两组互斥 | 三 seed 10 条全部命中 |
| 同盟顶价 | 删掉 `tiers>2` 断供、`importedUnits` 参与供给、运价 0.35、3% 基准锚定、`capRatio=max(0.2,1-0.7*regulation)`；`weapons/luxury` floorRatio 0.5→0.7 | 均价偏离 120% → 12.8–16.3%；20/20 落在 70–140% |
| 内阁决策 | `settleCountryDecisions`：增税 / 裁军 / 借债三选一，0.03 粘性，借债上限债务率 1.5 | `tests/policy.test.ts` |
| 存档 | `SCHEMA_VERSION` 2→3（`policyCooldowns/polityPressureMonths/lastPolityChangeDay/cabinetAction/succession/offices/importedUnits` 等），`CONTENT_VERSION` 0.3.0 | `tests/migration.test.ts` |

**遗留**：`Country.offices` 已建模但未配置人选、`runPolicyRound` 的 `influence` 参数已就绪但引擎未传（M4 接）；政体变更 100 年实测 0 次（门控偏严，可调）；国家预算的抽象关税与贸易到港关税两个口径未合并。

### 8.7 M4.1 人物档案与人口学（2026-11-19）

| 项 | 实现 | 证据 |
|---|---|---|
| 人物档案 | `Character` 增加 `sex/birthYear/generation/familyId/parentIds/spouseId/attributes/alignment/faith/homeRegionId/location/offices`；`ATTRIBUTE_KEYS` 六维 1–20、`Alignment` 双轴 −100..100、`SITE_KINDS` 七种地点、`Family` 家系 | `tests/character-model.test.ts` 6 例 |
| 生成规则 | `buildCharacter()` 统一构造（缺省属性 10、阵营 0/0、信仰 null）；`Profile.ts` 提供种族修正、技能上限 `3+floor(attr/3)`、九宫格标签与单次阵营变化上限 20；天赋标签 3 选（默认全 10，+2 标签可重复，任一维 ≤16） | `tests/character-model.test.ts` |
| 人口学 | `Demography.ts`：年度衰老→死亡（遗产：配偶→子女→兄弟姐妹，现金均分、无继承人充公入国库；股份同比例转移，恒为 100%）→婚姻（同地区/同国/异地概率 1/0.45/0.15，建家族）→出生（父母均值 ±1 属性、信仰随机、代际 +1）→人口流入（具名人口 < 24 时每年补 1–6 人） | `tests/character-lifecycle.test.ts` 6 例（含遗产守恒、家族一致性） |
| 内容 | 6 信仰 / 6 开局背景 / 2 文化姓名池；20 位人物补 `sex/faithId/alignment/attributes`；`CONTENT_VERSION` 0.4.0 | 内容自检 `chars 20 faiths 6` |
| 性能 | 随机计数器改为引擎持有活引用（不再每次推进后整表复制）；`EventEngine` 路径切分缓存、同轮实体列表复用；`priceRatio` 不再逐次重排市场表 | 100 年引擎内 1.1 s（测试断言 <2 s） |
| 存档 | `SCHEMA_VERSION` 3→4（新增 `families` 与 15 个档案字段），`migrateV3toV4` 逐人物补默认值 | `tests/migration.test.ts` 仍 5 例通过 |

**三 seed 100 年实测**（`pnpm sim --years 100 --seed demo|alpha|beta --check`）：哈希 `9415d63d1400df5c` / `d46594abab0e06c4` / `40450b05ac9d08b5`，耗时 2.0–2.4 s（含 tsx 启动），存活 45 / 91 / 78 人（出生 58 / 119 / 98 位），家族 13 / 30 / 25 个，破产率 17.9% / 23.1% / 24.0%，分裂率 0% / 3.8% / 4.0%，复跑一致。

### 8.8 M4.2 开局人物创建（2026-11-19）

| 项 | 实现 | 证据 |
|---|---|---|
| 规则 | 六维默认全 10；6 个天赋标签（强健/灵巧/聪慧/坚毅/敏锐/煊赫，各 +2）选 3 个、可重复、单维封顶 16；背景提供职业、出生地区、初始财富、技能与属性倾向 | `tests/character-creation.test.ts` 8 例 |
| 生成 | `createPlayerCharacter()` 产出标准 `Character`（与人口学共用 `buildCharacter`），姓名按文化池生成并去重、信仰默认跟随背景可改或无、阵营随信仰倾向初始化；写入 `state.characters` 并改写 `state.playerId` | `validateWorld` 为空 |
| 接入 | `GameEngine.createPlayer(choice)` 记一条 milestone 历史并同步随机计数器；顶栏「创建人物」打开 `src/ui/CreateCharacterDialog.ts`（6 背景卡 / 6 天赋 / 姓名 / 性别 / 信仰），成功后重挂界面到新玩家 | Edge 探针 `REASON=done|closed=1|talents=6|errs=0` |
| 产物 | `release/index.html` 192,363 字节（12.2%）；测试 12 文件 / 85 例 | `pnpm test` 85 passed |

**遗留**：`createPlayerCharacter` 只改玩家指针、不重置世界（换人是重新登场而非重开世界）；改名/换背景需再点一次「创建人物」。

### 8.9 M4.3 关系网与生涯路径（2026-11-19）

| 项 | 实现 | 证据 |
|---|---|---|
| 关系网 | `src/systems/character/Relations.ts`：五类有向关系（ally/family/rival/feud/debt），值 −100..100；`setRelation`/`bumpRelation` 自动夹取并在归零时删记录；`relationScore` 双向求和供决策与事件使用；`decayRelations` 年度 ×0.92 回归、绝对值 <1 清理 | `tests/relations-career.test.ts` 9 例 |
| 关系接入 | 婚姻写入双向 `family`（55），出生把子女与父母双向绑定；玩家与 NPC、NPC 之间都可建关系，UI 人物卡显示前 6 条 | 20 年人口学用例断言关系为正 |
| 生涯阶梯 | `src/systems/character/Career.ts`：merchant 学徒→伙计→行商→商会主、mercenary 新兵→老兵→队长→佣兵团长、politician 书吏→议员→大臣→执政；晋升看财富 + 主技能（trade/melee/persuasion），公职给 +1 技能加成；财富跌破本级 30% 降级 | 晋升/降级用例 |
| 转行 | 需已站稳（等级 ≥1 或持有公职）且现金 ≥3000；成功后等级归零、技能保留、写 milestone 历史；命令 `change_career` 只允许玩家本人 | 命令用例 + 引擎历史断言 |
| 存档 | `SCHEMA_VERSION` 4→5（`careerRank`/`careerSinceDay`），`migrateV4toV5` 补默认值 | v4→v5 迁移用例 |
| UI | 玩家卡新增「生涯」行与「转行 X」按钮（条件不满足不出现）；人物卡新增「生涯」与「关系」列表 | Edge 探针 7 面板 / 73 按钮 / 0 报错 |

**实测**：`pnpm sim --years 100 --seed demo --check` 通过、复跑一致，2.09 s；存活 45 人，破产率 17.9%、分裂 0%，均价偏离 14.3%、70–140% 内 20/20；事件 8,556 条、历史 11,827 条。

**遗留**：关系目前只被人看与事件条件读取，NPC 决策尚未把 `relationScore` 计入效用（M4.4 事件链时接入）；生涯晋升只看财富与技能，未考虑声望与公会资格。

### 8.10 M4.4 事件链（2026-11-19）

| 项 | 实现 | 证据 |
|---|---|---|
| 链模型 | `EventDef.chain {id, step}` 与 `EventDef.followUps[] {eventId, delayDays, chance?, conditions?}`；`ScheduledEvent.chainStep` 记录排定步序 | `tests/event-chains.test.ts` 6 例 |
| 排定 | `applyEvent(state, content, trigger, rng)` 结算后由 `scheduleFollowUps` 按概率（命名流 `followup:<entityId>:<defId>`）与条件排定下一步，`parentEventId` 保留因果 | 延迟/概率/条件三例 |
| 不可跳步 | `collectCandidates` 跳过 `chain.step > 1` 的事件；`fireDueEvents` 执行前校验 `scheduled.chainStep === def.chain.step` | 候选断言 + 步序不符被丢弃 |
| 历史条件 | `readFeature` 支持 `history.<eventId>`：目标实体近 360 天内该事件发生次数 | history 特征用例 |
| 内容 | 新增 5 条：国家「骚动→暴动→戒严」、组织「债主上门→违约」、冒险「机会→伏击→战利品（需 melee≥3）」 | demo 100 年事件 8,556→11,560 条 |

**实测**：`pnpm sim --years 100 --seed demo --check` 通过、复跑一致、2.12 s；全套 14 文件 100 例。

**遗留**：链条只做「父→子」排定，没有跨对象链（如组织危机引发国家事件）；抉择（玩家二选一）留到 M4.5。

### 8.11 M4.5 抉择（2026-11-19）

| 项 | 实现 | 证据 |
|---|---|---|
| 数据 | `EventDef.choices: ChoiceDef[] {id,label,hint?,effects,conditions?}`；`WorldState.pendingChoices` 记录挂起项（含 `expiresDay`） | 迁移 v5→v6 |
| 玩家 | `GameEngine` 选项 `stopAtChoices`（UI 传 true）：玩家事件只入队不结算，弹窗出现「你的抉择」；`dispatch({kind:choose, choiceId})` 结算基础效果 + 选项效果，写历史 | `tests/choices.test.ts` 9 例 |
| NPC/无头 | `pickChoice` 按效用（合法性/稳定度权重高、冲突为负、现金按面值）择优，同分按 id；`sim` 与脚本默认走自动路径，保持确定性 | 自动结算用例 |
| 超时 | 已移除自动代选：挂起的抉择不会过期，世界继续走、玩家随时可点（§8.37） | `tests/choices.test.ts` |
| 内容 | `ev_org_strike`（加薪/清场）、`ev_country_tariff_dispute`（加税/降税）、`ev_adv_opportunity`（接活/稳妥） | 内容校验 + 100 年 sim |

**实测**：100 年 demo `--check` 通过、复跑一致、2.32 s；`release/index.html` 208,059 字节（13.2%）；Edge 探针 7 面板 / 73 按钮 / 0 报错。

**遗留**：抉择结果还不会反向影响人物关系与声望（只走效果路径）；对话里没有「代价预览」的数值展示，只给 hint 文本。

### 8.12 M4.6 迁移与验收（2026-11-19）

| 项 | 内容 |
|---|---|
| 存档 | `SCHEMA_VERSION 5→6`、`SAVE_FORMAT_VERSION 2→6`；新增 `migrateV5toV6`（补 `pendingChoices: []`） |
| 迁移测试 | `tests/migration.test.ts` 8 例：v1→v6 全链、v5→v6 补字段、裸状态包装、旧存档续跑 10 年、高版本拒绝、篡改拒绝 |
| 验收报告 | `docs/acceptance.md`：A（3 seed 100 年）、B（商业干预 4 例）、C（政策 6 例 + 游说）、D（危机 4 步）、E（继承守恒）、F（快进/存档一致）、版本链表、未覆盖项 |
| 指标 | 破产率 21.4/23.1/24.0%（目标 15–35% ✅）；分裂率 0/3.8/4.0%（目标 5–15%，**偏低**）；均价偏离 14.3–16.2%；70–140% 命中 19–20/20 |

**未通过项**：分裂率低于目标区间（需在 M5 调整分裂风险系数）；政体变更 100 年 0 次（门控过严）；潮汐市场粮食长期 140%（运力不足）。



**遗留**：开局人物创建（`CharacterCreator.ts` 与 `backgrounds.json` 接线）、关系网与"商人→从政"生涯路径、事件链与抉择（`EventDef.choices`）、`Country.offices` 人选、大臣与 `influence` 接线；AI 婚姻只按地区/国别加权，未考虑财富与声望。

---

### 8.13 M6 战争（2026-11-19）

| 项 | 内容 |
|---|---|
| 模型 | 一国一军 `army:<countryId>`：规模 = 人口 × 0.008 × (0.5 + 军费占比×2)；字段 `training/commanderId/stance/targetRegionId` |
| 宣战 | `declareWar`：双向 `atWarWith`、外交 −100、`warStartDay`；停战 24 个月内不可再战 |
| 行军 | 每月沿最短路径推进一格；弱势方守土；敌军侵入本国时转为拦截（避免"永远在中间擦肩"） |
| 会战 | `battlePower = size × (0.75+0.5×训练) × (0.8+0.4×士气) × (1+战术×0.04)`；败方退守首都、掉士气 |
| 围城 | 敌军不在或明显弱于己方时累计 `siegeProgress`，满 3 个月写入 `occupiedBy`；停战时占领地割让 |
| 厌战 | 每月 +0.018，会战 +0.03；达 `peaceExhaustion = 0.7` 或双方国库枯竭即自动停战 |
| AI | `settleMonthlyDiplomacy`：同政体靠拢、异政体交恶；关系 < −30 且兵力 1.3 倍以上，月度 5% 概率开战 |
| 命令 | `declare_war` / `offer_peace` / `levy_army` / `march_army`（需统治者，或影响力 ≥0.4 的公职） |
| 内容 | `events/war.json` 3 条（战费吃紧 / 边境捷报 / 营中逃兵，互斥组 `war_mood`）；`CONTENT_VERSION 0.5.0` |
| 存档 | `SCHEMA_VERSION 6→7`：补 `atWarWith/warStartDay/warExhaustion`、`occupiedBy/siegeProgress`、军队四字段 |
| 实测 | 三 seed 100 年：宣战 10–15 次、会战 150–209 场、占领 4–6 次、停战全部收尾；破产率 15.6–16.7%、分裂率 2.8–19.4%、政策变更 13–27 次、政体变更 2 次（每国最多一次） |

**已知偏离**：①每国只有一支军队，没有军团与分兵；②会战是单次比值判定，没有战线与地形修正；③占领只换宗主，不迁移人口；④`Country.offices` 仍为空，公职影响力只能由测试注入；⑤政体变更从 0 次升到 2 次/百年（每个国家至多一次），门控为 合法性<0.14 / 稳定<0.18 / 债务率>1.9 / 持续 36 月 / 冷却 480 月、30% 概率。

### 8.14 M5 界面整合与美术（2026-11-19）

| 项 | 内容 |
|---|---|
| 新手引导 | `src/ui/Tour.ts`（280 行）：4 步浮层挖洞高亮（玩家卡 → 速度条 → 地图/事件 → 存档），可选边自动翻转，`Esc` 关闭；`localStorage` 键 `throne-and-gold.tour.v1` 只出现一次，顶栏「?」重看 |
| 地图 | `src/ui/MapView.ts` 重写（674 行）：程序化 SVG 地形轮廓（首都紧凑多边形、平原压扁、山地锯齿、海岸双正弦、森林扇贝）+ 裁剪纹理；hover/focus tooltip（地区/地形/人口/主商品/价格指数）；连线按运力加粗、箭头指向净进口端；键盘 Enter/Space 选中 |
| 存档 | `src/ui/SaveDialog.ts`（354 行）：自动槽 + 手动槽 1–3，显示世界日期、真实保存时间、玩家名、哈希前 10 位、种子；覆盖/删除需 5 秒内连点两次；读取走 `adopt()`；IndexedDB 不可用时提示改用导出/导入 |
| 历史 | 类型筛选 + 「只看我的」（玩家所在组织/地区/家族成员），副标题显示「共 N 条 · 当前筛选 M 条 · 最多 50 条」 |
| 快捷键 | 空格暂停/继续、`1/2/3` 切 1×/7×/30×、`4` 暂停、`Esc` 关存档→引导、`?` 重开引导；输入框内忽略 |
| 可访问性 | 79 个按钮全部带 `aria-label`（`MutationObserver` 为动态重绘的纯文字按钮回填），标签页 5/5 有标签，地图区域可聚焦 |
| 设计令牌 | `base.css` 1819→2313 行：`:root` 收敛为完整令牌（底色/描边/文字/金色系/阵营色/语义色/间距/字号/圆角/阴影），替换 16 处硬编码色，数字统一 `tabular-nums` |
| 响应式 | ≤900px 与 ≤640px 单列布局，880px 视口实测 `over=−10px` 无横向溢出 |
| 产物 | `vite.config.ts` 增 `build.modulePreload.polyfill = false`，产物零 `fetch(` 字面量；`release/index.html` 251,396 字节（预算 16.0%） |

**验证**（真 Edge 窗口 × 4，独立临时 profile，按随机标题标记单杀 PID）：引导 4 步出现且只出现一次、速度按钮推进日期、空格暂停、4 槽存档写入/读取、历史筛选与「只看我的」、79 按钮 0 报错、`tsc`/`eslint`/`prettier`/`vitest 121 例`/`vite build` 全绿。

**已知取舍**：headless 被策略禁用，未做像素级截图对比；地图 tooltip 未做边界翻转（最东侧地区可能贴边）；`file://` 双击打开时部分浏览器禁用 IndexedDB，需改用导出/导入。

### 8.15 公职实装与关税口径（M5.1，2026-11-19）

| 项 | 内容 |
|---|---|
| 公职任命 | `src/systems/country/Offices.ts`：每国三席（君主国 首相/元帅/财务大臣，共和国 议长/舰队司令/财务官），按对应技能最高者任命，统治者不兼任 |
| 影响力 | 职位权重 0.5/0.45/0.35；`influenceOf()` 按国累计并夹 0–1，`GameEngine.playerInfluence()` 供政策支持度与 `lobby`/`levy_army` 等国家命令使用 |
| 维护 | `syncOffices()` 每季度只补空缺（占位者死亡/迁出），补位写 `policy` 历史并带国家引用 |
| UI | 国家面板每个国家卡新增「公职」列表（职位 · 在任者 · 影响力） |
| 关税口径 | 国家预算不再按人口抽象估算关税（原先与 `TradeSystem` 的到港实收重复计征）；月度收入只含人头税，关税与利润税一律由各自系统直接入库 |
| 校准 | 政策冷却 42→48 月、`minPressure` 0.66→0.70，避免战争赤字把提案推到 48 次/百年 |
| 实测 | 三 seed 100 年：政策变更 17 / 13 / 27 次（beta 因连年战争略超 25 上限），政体变更各 2 次，破产率 15.6–16.7%，分裂率 2.8–19.4% |
| 测试 | 新增 `tests/offices.test.ts` 5 例（三席在世且不兼任、双向记录、影响力夹取、死亡补位、政体官衔），全套 **17 文件 126 例** |

**遗留**：公职只有三席且不随战功/声望调整；`PlayerPanel` 未显示「我的公职」；占领地的公职仍按原宗主国归属。

### 8.16 世界扩展与性能重定标（M6.1，2026-11-19）

| 项 | 内容 |
|---|---|
| 规模 | 7 国（银月王国、港口自由同盟、高谷王国、圣焰教国、铁峰部落联盟、珊瑚商邦、苍狼汗国）/ 14 地区 / 18 组织 / 51 人物 / 4 文化（silvermoon、league、vale、steppe） |
| 政体 | 仍只有 `monarchy` / `republic` 两种实现；神权、部落、商邦差异用 `legitimacy`/`stability`/`policies` 表达，避免为每个政体写一套决策逻辑 |
| 内容 | `events/country.json` 新增 6 条（synod / clan_feud / merchant_charter / steppe_raid / vale_avalanche / moot），既有 18 条 ID 未改；`CONTENT_VERSION = 0.6.0` |
| 存档 | `Character` 增加可选 `culture?`（旧存档缺省即为 undefined，无需迁移）；`SCHEMA_VERSION` 仍为 7 |
| 性能 | `src/core/EventEngine.ts` 增 `FeatureCache`（区域价格比一次遍历、历史计数懒建）与按实体的特征 memo；人物事件改季度抽样；`GameEngine` 删除逐月「月度结算」历史记录（百年 1200 条噪声，历史 16915→10278） |
| 实测（100 年，三 seed） | demo `b0bdd064cfa3372c` / 3.1 s / 破产 25.8% / 分裂 9.7% / 政策 15 / 政体 0 / 价格 54/56；alpha `b974676c4996b0bc` / 3.1 s / 22.6% / 12.9% / 22 / 1 / 54；beta `8567c34f670720d6` / 3.1 s / 24.1% / 10.3% / 17 / 0 / 53 |
| 测试 | `tests/simulation.test.ts` 规模断言同步（18 组织 / 51 人物 / ≥18 事件），`tests/country.test.ts` 预算条数 2→7；全套 **17 文件 126 例** |

**遗留**：烬瀑城、风蹄原、马集没有本地生产组织（靠自给与输入）；商路压到 13 对、跨国运力 300–600，grain/iron 仍有 150–180% 离群；神权/部落/商邦的政体差异尚未进入决策与政策支持度公式。

### 8.17 开局人物创建修正（M6.2 第 1 阶段，2026-11-19）

| 项 | 内容 |
|---|---|
| 问题 | 创建人物时新主角直接成为「金穗行」领袖并继承 38% 股份；对话框也无法选择国家与组织 |
| 根因 | `CharacterCreator` 沿用同 id 旧人物的 `organizationId`，而默认 `c_player` 正是金穗行领袖与最大股东 |
| 退场逻辑 | 新增 `src/systems/character/Retire.ts` 的 `retireCharacter(state, id): RetireReport`：股份按比例并给其余股东（无其余股东则归继任领袖）、领袖位按 `successionOrder` 递补、清空 `Country.offices` 中本人条目、`rulerId` 走 `installRuler` 重选；过程中临时 `alive = false`，避免被选回原位 |
| 创建落位 | `CharacterCreationChoice` 增 `countryId` / `regionId` / `organizationId`；地区必须属于所选国家，未指定时取背景地区或该国人口最多地区；组织可省略（自由身）；新人物 `careerRank = 0`、无股份、无公职 |
| 界面 | 创建对话框新增国家 / 地区 / 组织三个联动下拉（组织含「无组织（自由身）」，只列该国据点；跨国组织允许加入但给警告） |
| 测试 | `tests/character-creation.test.ts` 8 → 12 例（可选国家/地区/组织后为白身、不选组织、地区与国家不匹配拒绝、替换默认主角后股份守恒且领袖易主）；全套 **17 文件 130 例** |

**遗留**：默认世界仍以「艾伦·格雷 = 金穗行领袖」为开局（这是内容设定，不是创建流程）；尚未提供「收购股份成为领袖」「申请公职」两条玩家路径，下阶段补。

### 8.18 默认开局与首次进入（M6.2 第 2 阶段，2026-11-19）

| 项 | 内容 |
|---|---|
| 默认人物 | `c_player` 艾伦·格雷从「金穗行领袖 / 38%」改为「少东家 / 22%」；领袖改为 `c_grainwheel_hob` 霍布·金穗（34%），第三股东老瓦雷斯 15% 不变 |
| 理由 | 领袖应当是内容里的长辈而不是玩家；玩家以 22% 起步仍满足「持股 ≥ 0.2 可调度资金」的控制门槛，能投资、能买卖，但字号的方向由 NPC 掌柜定 |
| 首次进入 | 新增 `src/ui/StartDialog.ts`：无存档时先弹「从何处开始」——「以艾伦·格雷开局」或「创建我自己的人物」（后者接创建对话框） |
| 引导顺序 | `App.start(message, { tour?: boolean })` 支持跳过新手引导；首次进入先弹开局对话框，引导等玩家选定后再触发 |
| 测试 | `tests/organization.test.ts` 继承用例改为「掌柜死后由最大股东（玩家 22%）继任」；`tests/character-creation.test.ts` 的退场断言同步（移除 22% 股份、不再移交领袖位） |

**遗留**：两个开局入口都直接进入世界，没有「开局处境」的差异（例如少东家 vs 白手起家会有不同初始现金与关系）。

### 8.19 股份交易与领袖更替（M6.2 第 3 阶段，2026-11-19）

| 项 | 内容 |
|---|---|
| 新模块 | `src/systems/organization/Shares.ts`：`sharePrice`（按 `valuation(org)` 折算）、`affordableShare`、`unassignedShare`、`moveShares(org, from, to, share)`（`null` = 未登记份额）、`rankedHolders`、`canClaimLeadership`（份额 ≥ 34% 且超过现任领袖） |
| 命令 | `buy_shares`（从最大股东依次吃份额，钱付给卖家；不足部分吃未登记份额）、`sell_shares`（优先卖给付得起的最大股东，否则退回未登记池）、`claim_leadership`（份额达标且超过领袖即可接管） |
| 规则 | 买入按估值一次性付现，玩家现金不足时整单拒绝；卖出同理按估值收现；接管只改 `leadership.leaderId`，不动股份 |
| 界面 | 组织面板「股权」下新增未登记份额行与 `买入 5% / 卖出 5% / 接管字号` 按钮，提示行给出估值、5% 价格与接管条件 |
| 测试 | `tests/shares.test.ts` 6 例：买入搬份额并付款、超量购买拒绝且不改状态、现金不足拒绝、卖出收现且未登记份额不变、低于 34% 不能接管、买到超过领袖后可接管并由引擎写历史 |

**遗留**：股份只在玩家与 NPC 之间流转，NPC 之间不会互相收购；接管字号没有「董事会反对/合法性」的阻力。

### 8.20 谋求公职（M6.2 第 4 阶段，2026-11-19）

| 项 | 内容 |
|---|---|
| 评分 | `officeScore` = 技能（席位主技能/20）× 0.55 + 财力（min(1, 财富/20000)）× 0.2 + 既有影响力 × 0.25，结果 0–1 |
| 门槛 | `OFFICE_MIN_SCORE = 0.45`；还要活着、在本国任一地区居住，且评分比现任者高 ≥ 0.05 |
| 命令 | `seek_office { countryId, officeId }`，只有玩家本人能提交；成功后改写 `Country.offices` 与当事人 `Character.offices`（旧任职者一侧同步移除） |
| 界面 | 国家面板「公职」区逐席列出「谋求<职位>（现任 XXX / 空缺）」按钮，下方提示评分维度；失败原因直接显示在结果行 |
| 测试 | `tests/offices.test.ts` 扩到 9 例：达标压倒现任可出任并写历史、资历不足被拒且席位不变、现任更强拒绝、不在本国居住拒绝 |

**遗留**：谋求只看评分不看政治关系；被挤下台的旧任职者没有怨恨或报复行为；席位没有任期与弹劾。

### 8.21 军团指挥（M6.2 第 5 阶段，2026-11-19）

| 项 | 内容 |
|---|---|
| 新面板 | `src/ui/ArmyPanel.ts`，右侧新增「军团」页签（第 6 个） |
| 状态 | 兵力 / 训练 / 士气 / 位置四格；位置格在行军时显示目标地区，附统帅（空缺按 0 战术）、月维持费用 |
| 征兵 | 人数输入 + 每人 14 铜的预算提示 + 「征召」按钮，直接走 `levy_army`（国库不足、超过人口 2% 由引擎拒绝） |
| 行军 | 只列当前地区相邻商路，点「开往 X」即 `march_army`，抵达后引擎自动转驻防 |
| 邦交 | 逐国列出交战中/友好度，按钮在「宣战」与「议和」间切换，权限不足由引擎回错误 |
| 测试 | `tests/war.test.ts` 4 例：征兵扣国库与 2% 上限、行军设置目标与状态、宣战双向且不可重复、无统治权/公职时拒绝 |

**遗留**：军团只有每国一支，没有多军团与战线；面板不显示敌军位置与胜算预估。

### 8.22 平衡校准（M6.2 第 6 阶段，2026-11-19）

| 项 | 内容 |
|---|---|
| 价格 | `goods.json` 的 `grain.subsistenceShare` 0.85 → 0.95：无粮产地区靠本地口粮自给，剩余 5% 仍需贸易，`r_portlumen`/`r_ironpeak`/`r_windsteppe` 的长期顶价消失 |
| 政策 | `balance.json` 的 `policy.cooldownMonths` 48 → 72（2160 天）、`policy.minPressure` 0.70 → 0.78，压住小国频繁刷政策 |
| 结果 | 三 seed 100 年：破产 18.2–21.1%、分裂 9.1–14.3%、56/56 市场落在 70–140%（均价偏离 9.3–9.8%）、政策 19–40 次（7 国折算 2.7–5.7 次/国）、政体 0–2 次，`--check` 全部一致 |
| 测试 | `tests/policy.test.ts` 的百年上界按 7 国放宽到 60，最小间隔断言改 2160 天；全套 18 文件 135 例 |

**遗留**：`grain` 自给率提高后粮食贸易变薄；`iron` 在 `r_windsteppe` 仍有 128–130% 的离群；政策次数对 seed 敏感（19–40）。



### 8.23 内容扩展（M6.2 第 7 阶段，2026-11-19）

| 项 | 内容 |
|---|---|
| 空地区补全 | 烬瀑城 / 风蹄原 / 马集（此前无本地生产组织）各补一家：烬瀑教团（service）、风蹄牧会（grain）、马集驮队（iron），并配 3 位本地领袖（赛拉·烬声 / 巴图·风蹄 / 娜仁·马集） |
| 规模 | 组织 18 → 21、人物 51 → 54、事件 36 → 40（新增朝圣季、雇佣兵集结、商队遇袭、善缘） |
| 事件设计 | 两个国家事件用 `stability` / `debtRatio` 特征与互斥组 `country_order`；组织事件走 `conflict` 风险；人物事件用 `traits.loyalty` 并写 `alignment.good` |
| 修复 | `linkFamily` 此前只往新家族塞人、不清理旧家族成员表，导致 `familyId` 与 `memberIds` 不一致；现在迁出时同步摘除、空家族删除、成员去重 |
| 结果 | 三 seed 100 年：破产 17.4–27.3%、分裂 8.7–12.5%、55–56/56 市场在区间、政策 12–40、政体 0–2，`--check` 全部一致 |

### 8.24 发布收尾（M6.2 第 8 阶段，2026-11-20）

| 项 | 内容 |
|---|---|
| 版本 | `package.json` 0.1.0 → **1.0.0**；内容版本 `CONTENT_VERSION` 保持 `0.6.0` |
| 构建 | `vite build` + `scripts/release.mjs`：`release/index.html` **303,061 字节**（预算 19.3%），无 `<script src>`、无 `<link href>`、无 `fetch(` |
| 测试 | 18 个测试文件 / 135 例全绿；`tsc --noEmit`、`eslint .`、`prettier --check .` 干净 |
| 三 seed | `--check` 复跑一致：破产 17.4–27.3%、分裂 8.7–12.5%、55–56/56 市场在 70–140%、政策 12–40 次、政体 0–2 次 |
| CI | `CI` run 34（`a5d0324`）success；此前 run 32（`9493c9b`）、run 33（`6e2f9d6`）均 success |
| 部署 | `Deploy GitHub Pages` run 31（`a5d0324`）success；<https://tulongzikun.github.io/personal_throne/> 返回 200 |
| 待办 | 用户在第 8 阶段提出的 8 项待办（创建落位、默认开局、股份交易、公职、军团 UI、平衡、内容、发布）全部完成 |

**遗留**：浏览器探针在本轮环境无法枚举 Edge 窗口（已提交版本同样失败，headless 被策略禁止），军团页签与图形层未经真实浏览器复验；多军团与战线、四种地图图层、神权/部落/商邦的政体差异、珊瑚湾粮价仍在「尚未完成」清单里。

### 8.25 M7 体验重构（v2 设计，2026-11-20）

四份独立试玩（世界观 / 成长 / 可玩 / 易玩）后，把整改方案写成独立设计文档：[`docs/redesign-v2.md`](./redesign-v2.md)（依据见 [`docs/playtest-2026-11-20.md`](./playtest-2026-11-20.md)）。

| 项 | 内容 |
|---|---|
| 综合评分 | 3.3 / 10：世界模拟 7 / 10，玩家体验 1.5 / 10 |
| 四个根因 | 经济账本不闭合、玩家没有动词、事件是广播而非"发生在你身上"、没有牵引与结局 |
| 设计目标 | 决策密度 0.16 → ≥12 次/年；相关信号 1.7% → ≥35%；主动/躺平 1.21× → ≥3×；Δ权益/净利润 0.021 → 0.85–1.05 |
| 七个阶段 | ①可玩性抢救 ②经济闭合 ③动词与行动力 ④叙事系统 ⑤目标与新手 ⑥模拟深化 ⑦打磨发布 |
| 动工前提 | 每阶段独立交付、全量校验、commit + push、更新 `release/index.html` |

**说明**：本文档的 M0–M6 记录保持不变，作为 v1.0 的历史；v2 的排期、验收指标与风险登记以 `docs/redesign-v2.md` 为准。
### 8.26 M7 阶段 1：可玩性抢救（2026-11-20）

| 项 | 内容 |
|---|---|
| 默认真抉择 | `src/main.ts` 新开局引擎改为 `new GameEngine(state, content, { stopAtChoices: true })`，与 `adopt()` 读档路径一致；此前新开局的所有抉择都被 `pickChoice` 自动代选 |
| 信号分级 | 新增 `src/ui/signals.ts`：`relationOf` 按「自己 → 家族 → 组织 → 地区 → 国家 → 远方」判定，`subjectOf` 取首个可识别实体；`EventDialog` 标题渲染为「主体 · 事件名」，meta 行显示关系标签 |
| 见闻聚合 | 远方事件不再逐条弹窗，按月折叠进「N 条远方见闻」摘要；模态队列上限 5，溢出条数提示「已收入编年史」 |
| 自动暂停 | 相关信号入队时 `setSpeed(0)` 并提示，避免 30× 把抉择与死讯冲过去 |
| 死者退场 | `entitiesOfScope('character')` 过滤 `alive`（此前百年模拟 54.4% 的人物事件落在死者身上） |
| 玩家死亡 | `GameEngine.playerAlive/heirs()/continueAs()`；讣告弹窗列出配偶 → 子女 → 兄弟姐妹 → 同家族继承人（最多 3 位）与「就此落幕」，选择后切换 `playerId` 并写里程碑 |
| 自动存档 | 每 30 天写 `AUTO_SLOT`（此前只读不写）；存档面板文案改为「每 30 天自动保存」 |
| 内容 | 新增 3 条带抉择的人物事件：`ev_adv_merchant_offer`（押运：现金 +120 / 贸易 +1）、`ev_adv_family_quarrel`（评理：付 40 / 善良 +2 或收 60 / 守序 +2）、`ev_adv_civic_duty`（征召：付 60 / 守序 +2 / 说服 +1 或付 150 / 善良 −3） |
| 测试 | 新增 `tests/narrative-signals.test.ts` 6 例（五级关系判定、主体解析、20 年后候选不含死者）→ 19 文件 / 141 例 |
| 指标 | seed `stage1-check` 25 年：玩家抉择 **12 次**（目标 ≥4）、事件弹窗主体命中 **100%**（1,385/1,385）、相关事件占比 7.9%（阶段 4 的叙事目标） |
| 产物 | `release/index.html` **311,163 字节**（19.8%）；`sim --years 100 --seed demo --check` 复跑一致，2.9 s |

**遗留**：相关事件占比仍只有 7.9%（阶段 4 的 `when{}` 门控与本地事件解决）；「建议事项」与个人动词在阶段 3/5；国家与商会财政倒挂在阶段 2。

### 8.27 M7 阶段 2：经济闭合（2026-11-20）

| 项 | 内容 |
|---|---|
| 贸易口径 | `TradeSystem` 发船时把「采购 + 运费」计入 `org.tradeCost`，到港只补关税；`Finance` 用 `tradeCost` 作为 COGS 一次归集，删掉原先重复的 `lastMonthTransport/lastMonthTariff` 扣减。此前利润虚高约 5 倍（采购成本不入账、现金与损益各记一半） |
| 分红 | 盈利且现金厚于 3 个月工资时，按当月税后净利的 30% 依股份派发给在世股东；未登记股份的分红留在组织。新增 `WorldStats.dividendsPaid` 与 `FinanceEntry.dividends` |
| 公职俸禄 | `CountrySystem` 每月按 `Country.offices.salaryMonthly` 从国库支付给在任者（付不出则欠俸），俸禄计入刚性支出 |
| 国家财政 | `HEAD_TAX_PER_CAPITA` 0.02 → **0.10**；公共工程储备从 6 个月刚性开支提高到 **30 个月**，让国库能积累到与组织现金同一量级 |
| 训练 | 新增 `train { skill }` 命令：花费 `150 + 当前等级×120` 铜币，技能 +1，上限 `3 + floor(主属性/3)`；玩家卡直达入口（主技能前 3 项） |
| 测试 | 新增 `tests/economy-closure.test.ts` 5 例：十年权益+分红/净利 = 0.996、分红 ≤30% 净利、俸禄到账、训练与上限、五年国库/组织现金 = 0.15 |
| 指标 | `stage2-check`（seed）十年：Δ权益 + 分红 = 0.996 × 净利（目标 0.85–1.05）；国库/组织现金：5 年 0.153、20 年 0.055（目标 0.05–0.20）；`--check` 复跑一致，2.9 s |
| 产物 | `release/index.html` **313,207 字节**（19.9%）；20 文件 / 146 例 |

**未达成**：「主动 vs 躺平 ≥ 2×」实测 0.97——个人动词（移动/贩货/存入取出）在阶段 3 落地后才有主动收益路径，该指标随阶段 3 验收。`deposit/withdraw`、`buy_land` 与 `train` 同属个人动词，前两者延到阶段 3 与 `Activity` 一起做。

### 8.28 M7 阶段 3：个人动词与行动力（2026-11-20）

| 项 | 内容 |
|---|---|
| 行动力 | `MONTHLY_ACTION_POINTS = 3`、上限 6；每月 `Organization` 相位开头统一刷新；不足或健康 ≤5 时拒绝并给中文原因 |
| 健康 | 0–100，休息 +12；行动消耗 1–2 点健康；`annualMortality` 乘 `healthRiskFactor`（0.6–1.4，上限 0.9） |
| 动词 | `move`（沿 1 跳商路、路费天数×2、返回在途天数并推进时钟）、`trade_goods`（本地库存、买价 ×1.05、卖价 ×0.95、运费 0.05/单位/天、亏本拒绝）、`seek_audience`（+6 关系）、`gift`（转账，关系 +1~25）、`gossip`（洞察 +1）、`rest`、`deposit/withdraw`（本地银行）、`train`（花铜币 +1 技能，也耗 1 点行动力） |
| 开局价差 | `createWorld` 的初始行市按 `terrainPriceFactor` 取整（山地 1.15 / 平原 0.9 / 城 1.06 / 海岸 1.0 / 林地 0.97），让第一天就存在可贩运价差 |
| 存档 | `SCHEMA_VERSION` 8、`SAVE_FORMAT_VERSION` 8；`Character.health/actionPoints/deposits` 与 `migrateV7toV8` |
| 界面 | 玩家卡新增「行动力 / 健康」与「个人行动」按钮组（休息、贩货 5 单位、存/取 100、最多 3 个相邻地区）；移动后按在途天数推进时钟 |
| 测试 | 新增 `tests/activity.test.ts` 6 例；全套 21 文件 / 152 例 |
| 指标 | 首年可用动词 8；40 年主动 136,924 vs 躺平 59,537 = 2.30×（验收 ≥2×）；100 年 2.6–3.0 s；破产 22.7%、分裂 13.6% |
| 产物 | `release/index.html` 320,284 字节（20.4%） |

**未达成**：`buy_land` 未做；五种出身的开局差异留阶段 5；「40 年解锁 ≥12 个动词」目前靠组织/公职/战争命令凑满，个人动词仍是 8 个。


### 8.29 M7 阶段 4：叙事系统（2026-11-20）

| 项 | 内容 |
|---|---|
| 编年史 | 新增 `src/core/Chronicler.ts`：`entityNames`（按人物数量缓存，出生后失效重建）、`humanize`（一次扫描把 `c_/o_/r_...` 换成专名）、`composeChronicle`（主体 + 地点 + 缺专名时补「地点 · 主体：」前缀）；`HistoryRecord` 增加可选 `subject/place` |
| 世界门控 | `EventDef.when { countryId?, regionIds?, terrains? }`；`matchesWhen` 在 `collectCandidates` 里先于条件判定，避免「雪崩下在银月」这类错位 |
| 占位符 | `eventText` 在触发时把 `{country}/{place}/{subject}` 换成专名，标题与正文都走同一套 |
| 本地事件 | 新增 `src/content/events/local.json` 42 条（7 国 × 6 条，各带 `when.countryId` 与本地风味）；`ev_country_vale_avalanche` 补 `when: { countryId: "c_highvale" }`；`CONTENT_VERSION` 0.7.0 |
| 面板 | 编年史按「第 N 年 M 月」分组、条目去掉重复日期前缀、地点签 + 「你」标记，上限 200 条 |
| 测试 | 新增 `tests/chronicle.test.ts` 4 例、`tests/local-events.test.ts` 4 例；全套 23 文件 / 160 例 |
| 指标 | 20 年 12,617 条历史：含专名 100%、裸 id 0、带主体 99.8%；7 国本地事件全部触发；100 年 3.6 s、破产 21.7%、分裂 13.0% |
| 产物 | `release/index.html` **341,530 字节**（21.7%） |

**未达成**：本地事件仍是「国家尺度」的小插曲，未与地方市场/人物命运联动；事件正文只在抉择弹窗与摘要里出现，编年史只存标题级叙事。


### M7 阶段 5–7 与后续修复（倒序记录，最新在前）

> 以下 §8.30–§8.39 按「最新在前」记录，编号与出现顺序**故意相反**；里程碑汇总见 §8.1。

### 8.41 阶段 1：让「做事」成为最优解（2026-11-20）

审计口径：`docs/audit-2026-11-20-independent.md` 的「躺平 40 年 ×107、主动只 +17%，89% 收入来自生涯俸禄」。
本阶段只改「收入从哪来」，不动账本闭合（留给阶段 2）。

| 项 | 改动 | 文件 |
| --- | --- | --- |
| 在岗判定 | `Character.lastActionDay`；玩家的月俸只在 60 天内亲自出手时发放，NPC 不受影响 | `core/schema/character.ts`、`systems/character/Career.ts`、`systems/organization/Finance.ts` |
| 晋升门槛 | 玩家 180 天内没出手就不晋升（财富/技能达标也不再自动升级） | `systems/character/Career.ts` |
| 生活开销 | 每月扣身家的 0.4%（最低 10 铜），钱越多躺着越贵；玩家卡显示「每月开销」 | `systems/character/Upkeep.ts`、`ui/PlayerPanel.ts` |
| 商路视野 | 贩货从「相邻地区」扩到「两跳以内」，边城市场进入商队视野 | `systems/character/Activity.ts` 的 `tradeReach` |
| 贸易系数 | 采购 1.05→1.02、出售 0.95→0.98 基准；载货量 = 5 + 贸易等级 + 生涯等级×2 | `systems/character/SkillEffects.ts` |
| 存档 | `SCHEMA_VERSION` 9→10、`SAVE_FORMAT_VERSION` 9→10，v9→v10 补 `lastActionDay` | `core/schema/ids.ts`、`storage/Migration.ts` |

实测（`.tmp/stage1-check.ts`，同一世界、同一 20 年、只差「每月是否出手」）：

- 躺平：1,500 → **3,222**（只剩分红与利息）；主动：1,500 → **6,681**（生涯 2 级）——**2.07×**，达到验收线 ≥2×。
- 三 seed 100 年（`--check` 全部一致）：demo `493d8d578bd84712` 3.26 s、破产率 43.5%、分裂 8.7%、均价偏离 11.2%、56/56 在 70–140%；
  alpha `5a46429f14a2d9cc` 3.23 s、41.7%、12.5%、12.5%、56/56；beta `1351ca77ff8f2d1c` 3.15 s、45.8%、16.7%、13.3%、53/56。
- 破产率仍高于 20–30% 目标：属阶段 2（账本闭合）与阶段 4（僵尸国）的整改范围，本阶段只记录基线。
- 测试：新增 `tests/stage1-incentives.test.ts` 5 例（月俸在岗/脱岗、晋升门槛、开销与下限、两跳商路、路线受现货与本钱约束），全套 **34 文件 212 例**。
- 产物：`release/index.html` **375,627 字节（23.9%）**。

### 8.42 阶段 2：账本闭合（2026-11-20）

| 项 | 内容 |
|---|---|
| 工资到人 | `src/systems/organization/Finance.ts` 原来「现金够才发、不够一个都不发」改为按可用现金**按比例**发给在岗成员（`wagePlan()` + `payrollPool = min(careerWages, wagesPaid)`），未分完的退回组织现金 |
| 欠薪补发不再蒸发 | 补发时调用 `payWageArrears()`：此前只减现金与负债、钱凭空消失（审计中「74% 工资蒸发」的根因），现在按欠薪比例打进成员钱袋 |
| 口径统计 | `WorldStats.wagesBooked / wagesCredited`：10 年实测 145,000 / 145,000 = **100%** 到人（验收 ≥90%） |
| 国家俸禄只扣一次 | `CountrySystem` 的 `baseExpense` 已含俸禄，原代码在 `balance ≥ 0` 时又扣一遍国库；现在只把月俸记到在任者名下 |
| 国债有债权人 | `Country.creditors`（存档 v11）：赤字按「本国现金最多的银行、其次本国现金最多的组织」记名借入，还本按持仓比例回流组织，利息也按持仓付给组织，不再凭空增减；10 年国债 98% 由组织持有 |
| 测试 | 新增 `tests/stage2-ledger.test.ts` 4 例；全套 **35 文件 / 216 例** |
| 产物 | 三 seed 100 年 `--check` 一致；demo 破产 43.5%、alpha 37.5%、beta 35.7%；`release/index.html` 377,484 字节（预算 24.0%） |
| 遗留 | 货币总量 10 年 +133.7%（家庭钱袋/物价响应未做），破产率仍高于 20–30% 目标 |

### 8.43 阶段 3：失败与边界（2026-11-20）

| 项 | 内容 |
|---|---|
| 入口体检 | `CommandBus.applyCommand` 新增 `screenCommand()`：玩家不存在/已死亡一律拒绝；数字参数必须 `Number.isFinite`；字符串参数不得为空、超长（>128）、含控制字符，也不得是 `__proto__`/`toString` 这类原型链名字；`undefined`/对象参数直接拒绝 |
| NaN 穿透 | `trade_goods` 缺 `units` 时 `Math.round(undefined)` 会写出 NaN 财富——补 `isAmount` 守卫；其余数量参数已有守卫（组织投资/借款/购置/契约、征兵、送礼、存取款、份额） |
| 存档免检通道 | 同版本存档缺 `hash` 现在直接 `SaveError`（此前"空哈希跳过校验"等于可绕过）；跨版本迁移仍按原逻辑重算 |
| 契约容器 | `migrateWorldState` 先把数组形态的 `contracts` 归一化成以 id 为键的对象，再补字段：老档非空契约能读进，空数组也不会吞掉新契约 |
| 死亡边界 | 玩家死亡后所有命令返回「你已经不在人世」，不再允许投资/借款/买资产/买股份/改战略 |
| 测试 | 新增 `tests/stage3-fuzz.test.ts` 5 例：5000 条恶意命令 0 异常、状态深度扫描无 NaN、`validateWorld` 通过；死亡拒绝；原型键拒绝；数组契约迁移；缺哈希拒绝。全套 **36 文件 / 221 例** |
| 产物 | `release/index.html` 378,757 字节（预算 24.1%） |

### 8.47 统一演进计划 v4（2026-11-23）

六阶段计划（§8.41–§8.46）与远端独立产出的 v3 设计稿（提交 `d9ec10d`，2026-11-23 并入后删除）口径不同，
已合并为 [docs/unified-plan-2026-11-23.md](docs/unified-plan-2026-11-23.md)：冲突逐条裁决（§2.3）、
遗留并入 W9/W10、排期 P0–P8 按依赖排序、全部指标给出基线值与测法。

用户已就 8 个设计选择拍板（见计划 §11：不自动婚配、无婚姻无直系子嗣、45 岁前不死、远亲继承合法性 0.25、不做难度分级），v3 原文已删除且要点并入附录 A–D。

执行顺序：P0 止血包与测量基建 → P1 月末结算 → P2 时间预算 → P3 议程与计划（分水岭）。

### 8.48 P0：止血包与测量基建（2026-11-23）

按统一计划 §6 的 P0 第一批交付。目标不是加内容，而是先把「系统替玩家做主」和「读数说不清楚」两类问题止血，
并补上后续每个阶段都要用的测量手段——没有基线就谈不上"变好了"。

| 项 | 交付 |
|---|---|
| 不再自动配婚 | `Demography.ts` 的婚姻池排除玩家：玩家不点头，就没有配偶、没有直系子嗣（计划 Q2/Q3）。 |
| 哈希退场 | 顶栏读数改为 日期 / 现金(Δ) / 健康(Δ) / 行动力 / 速度；状态哈希搬进「☰ → 调试信息」。 |
| 单一菜单 | 顶栏六个按钮收成「☰」菜单：存档管理 / 导出 / 导入 / **新开一局** / 帮助(`?`) / 调试信息；「创建人物」更名并加二次确认。 |
| 帮助分组 | 新增 `HelpDialog`：看 / 做 / 查 三组，正文写明快捷键，可重看新手引导。 |
| 建议事项不再指挥 | 行动力为 0 时只说「这个月没行动力了」，不再给出做不到的建议（P3 会把整块换成"可做的事"）。 |
| 左栏瘦身 | 完整人物卡移出左栏，只留一行「完整人物」入口。 |
| 滚动记忆 | 每个标签页记住自己的 `scrollTop`，切走再切回不回到顶部。 |
| 测量基建 | 新增 `scripts/measure.ts`（玩家 / 货币 / 叙事 / 内容四类）与 `scripts/playtest-bot.ts`（不含随机的盲玩 bot）；CI 增加 10 年测量快照步骤。 |

**基线（2026-11-23，种子 demo，10 年）**：盲玩 bot 现金 1,500 → 25,313 铜（×16.9）、生涯 3/3 阶、无官职、无子女；
货币总量 ×2.71（1,568,384 铜），物价偏离 13.5%，国债 23,481 铜；编年史 915 条、事件 438 条（正文均长 84.8 字）、
与玩家有关 28.7%、最高模版仅 1.4%；事件库 90 条触发 77 条、13 条从未触发；单跑 417 ms。
30 年 bot：1,500 → 78,366 铜、升到财务大臣、仍无子女（与"不自动配婚"一致）。

测试 41 文件 / 249 例（新增 `tests/p0-safety.test.ts` 8 例）；`release/index.html` 399,901 字节（25.4%）。
遗留：货币总量十年翻近三倍（P3 经济闭合处理）、13 条事件从未触发（P6 内容 2.0 重写时一并清理）。

### 8.46 阶段 6：界面与性能（2026-11-20）

| 项 | 内容 |
|---|---|
| 对比度 | `--text-muted`/`--text-dim` 由 `#6f6555` 提到 `#9a8d77`；`var(--ink-soft, #6c6154)` 的落色改为 `--text-muted`。四种底色（void/sunken/panel/elevated）上四档文字全部 ≥ 4.5:1（原 3.14:1） |
| 字号 | 全仓 `font-size` 低于 `0.75rem` 的一律抬到 `0.75rem`（原最小 0.6rem ≈ 9.6px）；`tests/stage6-ui.test.ts` 直接扫 CSS 断言无小于 12px 的字号 |
| 标签页 | `role="tab"` 补 `id`/`tabindex`（只有当前页可 Tab 进入）、`role="tabpanel"` 补 `aria-labelledby`；方向键 `←/→`、`Home`/`End` 切换并把焦点带过去 |
| 焦点陷阱 | `src/ui/dom.ts` 新增 `trapFocus(container)`：弹窗打开时 Tab/Shift+Tab 在弹窗内循环，不再跑到底下的世界；开局、事件、创建人物、存档四个弹窗都接上 |
| 开局暂停 | `StartDialog` 与创建人物弹窗打开时 `holdForModal` 暂停，选完默认人物或创建成功后恢复 1×（此前开局界面后面时间在跑） |
| 引导 | 第二步从「让时间流动」改为「行动力花在哪」，指向左栏建议卡（`data-tour="suggestions"`），解释每月 30 点行动力与三条建议 |
| 性能 | 编年史按月折叠改为只扫数组尾部窗口（100 年 × 1200 个月不再每次全表扫描）；`tests/simulation.test.ts` 的 100 年门禁由 8000ms 收紧到 **4000ms**，并改用 `process.cpuUsage()` 计时——整套用例并行跑时墙钟会被同机其它测试拖长，门禁要衡量的是模拟本身的算力成本；`scripts/sim.ts --check` 输出单跑与复跑耗时 |
| 测试 | 新增 `tests/stage6-ui.test.ts` 5 例（对比度、字号、焦点陷阱、开局暂停、方向键切换标签）。全套 **39 文件 / 237 例** |
| 实测 | 100 年 demo：单跑 **3.4 s**（门禁 4.0 s）、复跑 3.8 s，`--check` 一致；历史 8,675 条 |

### 8.45 阶段 5：叙事（2026-11-20）

| 项 | 内容 |
|---|---|
| 账本按月折叠 | `History.compactMonth(day)`：把当月的 `trade`/`finance` 流水并成一条「本月账本：交易 N 笔、收支 M 笔」，附带最近三条摘录与涉及对象（引用取并集，账本仍然"关于谁"）。100 年历史从 55,255 条降到 8,655 条 |
| 事件正文 | `HistoryRecord.body`：事件结算时把事件正文（占位符已替换）与结算明细写进 `body`，编年史条目下方显示两三行正文，不再是十个字的标题填空 |
| 玩家署名 | `GameEngine.dispatch` 成功后把玩家写进记录的 `refs`（此前玩家做的事完全不进编年史）；`rest`/`train`/`inspect_market` 标为 `minor`，「只看大事」里折叠 |
| 玩家账本 | 每月生活开销单独记一条 `finance`（含玩家引用），随月度账本一起折叠 |
| 死亡叙事 | `recordDeath`：谁、在哪、享年、生前身份、留下多少铜 |
| 继位叙事 | `recordSuccession`：谁接了谁、血亲还是推举、接手时的稳定度与合法性。年尾比对国家元首变化后自动生成 `milestone` |
| 战争叙事 | 宣战与战报都带 `body`：地点、双方折损与战报传回朝堂的一句话 |
| 重组升级 | 组织「重组：出售资产…」由 `finance` 改为 `milestone`——它是转折点，不该被月度账本吞掉 |
| 界面 | 编年史新增「只看大事」开关（默认开），折叠账本；条目下方渲染 `history__note` 正文 |
| 测试 | 新增 `tests/stage5-narrative.test.ts` 5 例（折叠、正文、死亡叙事、继位叙事、三项验收指标）。全套 **38 文件 / 232 例** |
| 实测 | 40 年 seed `narrative`：3,439 条历史，大事占 **72.2%**（≥25%）、最高同款模版 **14.0%**（≤40%）、玩家相关 **15.3%**（≥5%）、带正文 2,799 条。100 年 demo `--check` 一致，历史 8,675 条，单跑 3.8 s |
| 产物 | `release/index.html` 387,000 字节（预算 24.6%） |

### 8.44 阶段 4：继承法与僵尸国（2026-11-20）

| 项 | 内容 |
|---|---|
| 王朝 | 新增 `src/systems/character/Dynasty.ts`：开局给没有子女的在位者补一位配偶与两个孩子（按在位者 22/30 岁生育倒推年龄），写双向 `spouseId`、`parentIds`、亲属关系与家族成员；幂等，已在其余地方生成过子女的不重复补。`GameEngine` 构造时在补齐公职之后调用 |
| 长子继承 | `src/systems/country/Ruler.ts` 的 `chooseRuler` 先走血亲：在位者子女（年长优先）→ 兄弟姐妹 → 侄甥 → 配偶，均需在世且在本国；本国无人再放宽到全世界；找不到血亲才回到分数评选。选举制下同性：子女 +1.4、兄弟姐妹 +0.5、配偶 +0.2 的「政治世家」加成 |
| 摄政 | `chooseRegent` 限定 25–70 岁（此前只排除 16 岁以下，出现过 128 岁摄政） |
| 灭国 | `Country` 增 `vacantMonths`/`extinct`（存档 v12）：领土被全部占走后挂账 48 个月，满期判灭——清债务、债权人、战争、外交与军队，并从别国的战争与外交列表里移除；期间拿回土地则清零。灭国不再参与结算 |
| 僵尸国 | 已解散组织不再因旧领袖死亡回到 `crisis`；`Shares.ts` 的 `clampShares`/`creditShare`/`absorbShares` 统一兜住 100% 上限，遗产分配与退休股权改走它们 |
| 测试 | 新增 `tests/stage4-succession.test.ts` 6 例（王朝补齐且幂等、长子继位、摄政年龄上限、48 个月灭国且不可复活、解散组织不复活、股份始终 ≤100%）。全套 **37 文件 / 227 例** |
| 实测 | 100 年：demo 更替 31 次/子女继位 48.4%/0 地区最长 32 个月/灭国 0/破产率 22.2%；alpha 27 次/66.7%/48 个月/灭国 3；beta 26 次/46.2%/48 个月/灭国 2；三 seed 股份越界 0、`--check` 一致 |
| 产物 | `release/index.html` 382,534 字节（预算 24.3%） |

### 8.40 远方见闻改为地区局势、旅途遭遇力量检定（2026-11-20）

| 项 | 内容 |
|---|---|
| 问题 | 「某陌生人路遇伏击」逐条播报没有信息量：既不告诉玩家哪里危险，也无法影响玩家的决定 |
| 地区局势 | 新增 `src/systems/region/RegionNews.ts`：`banditryOf()` 由国家稳定度、组织内斗与当地物价折算治安（0–1）；`regionNews(state, limit)` 只产出「盗贼频发 / 粮价飞涨 / 民怨渐起 / 货价低迷 / 战事未歇」几类要点，每地一条、按严重度取前 3 |
| 见闻改造 | 编年史弹窗的「远方见闻」不再罗列无关事件，只列这 2–3 条地区局势；其余事件仍进编年史，玩家想查可以翻 |
| 旅途遭遇 | 抵达时 `settleTravelEncounter()` 按治安掷 `0.05 + 0.55 × 治安` 的遭遇概率；遇上劫匪用 `rollCheck(力量, 10 + 治安×4)` 结算，成功护住钱袋，失败损失 `40 + 治安×160` 铜并受伤 6 点，整个过程写进移动摘要与编年史 |
| 界面 | 地区页「前往」区新增一行风险提示：`治安：不太平——到了那边可能遇到劫匪（力量检定）`；`.travel__hint--risk` 用警示色 |
| 测试 | 新增 `tests/region-news.test.ts` 4 例（治安随局势恶化、见闻去重且按严重度排序、遭遇确定且含力量检定、高治安地区移动可触发），全套 **33 文件 / 205 例** |
| 实测 | 30 年 demo：市场 56/56 在区间、破产率 13.6%、`--check` 一致 1.0 s |

### 8.39 事件噪声治理（2026-11-20）

| 项 | 内容 |
|---|---|
| 问题 | 一个月里出现七条「路遇伏击」，文案完全相同、目标却是不同 NPC，读起来像刷屏 |
| 同一事件每期一次 | `selectTriggered` 引入 `fired` 集合：同一取样周期内同一事件最多触发一次；人物事件整体最多 **2 条/期** |
| 人物目标轮换 | 不再对全部 54 位人物逐一判定：每月固定包含玩家 + 按月哈希轮换 3 位 NPC（`fnv1a64(seed:month)`），噪声降一个量级，玩家的戏份不被稀释 |
| 后续去重 | `scheduleFollowUps` 排定前检查同目标、同事件、同一天的待办，重复的直接跳过（此前一批伏击会排出四条一模一样的「战利品」） |
| 频率回调 | 冒险事件 λ0 下调（机会 0.05→0.02、行商 0.05→0.02、家事 0.05→0.015、征召 0.05→0.015、伏击 0.03→0.01、拦路 0.04→0.01、善缘 0.04→0.008、导师 0.03→0.005、捡钱 0.02→0.003） |
| 见闻折叠 | 无关事件的「远方见闻」按「标题 + 正文」合并成一条：`路遇伏击 ×7`，副标题列出当事人（最多 3 个），最多展示 8 类 |
| 实测 | seed `noise-check` 24 个月：月均 3.8 条事件、单月同事件最多 1 条、玩家事件 4 次；100 年 demo 事件记录 5,444 条（原 ~12,000）、历史 46,485 条、市场 56/56 在区间、分裂率 13.0%、`--check` 一致 4.1 s |
| 测试 | 新增 `tests/event-noise.test.ts` 2 例（单月同事件不得重复、同目标同日后续不得重复排队），全套 **32 文件 / 201 例** |

### 8.38 弹窗时暂停与「待决抉择」入口（2026-11-20）

| 项 | 内容 |
|---|---|
| 暂停 | `EventDialog`/`SaveDialog` 新增 `onVisibilityChange` 回调；`App.holdForModal(name, open)` 维护打开中的模态集合：任一模态打开就把速度记下并归零，全部关闭后恢复原速度 |
| 不覆盖手动暂停 | 打开前本来就是暂停（速度 0）时不记恢复值，关闭后仍是暂停——用户的手动暂停优先 |
| 队列语义 | 事件队列里还有下一条时，关闭当前条不触发「恢复」，避免一开一关之间时间闪回 1× |
| 待决抉择 | 抉择不再过期后，关掉弹窗容易忘；顶栏新增「待决抉择 N」按钮（`data-tour="pending"`），点开把未决项重新弹出来，处理完自动隐藏 |
| 测试 | 新增 `tests/modal-pause.test.ts` 2 例（对话框可见性通知、选项点击后恢复）与 `tests/app-modal-pause.test.ts` 3 例（打开暂停/关闭恢复、手动暂停不被覆盖、待决入口计数），全套 **31 文件 / 199 例** |
| 产物 | `release/index.html` 368,416 字节（预算 23.4%） |

### 8.37 d20 检定、抉择不再代选与默认 1×（2026-11-20）

| 项 | 内容 |
|---|---|
| d20 检定 | 新增 `src/systems/character/Check.ts`：`checkBonus = floor((属性−10)/2)`、`describeCheck()` 生成「力量检定 d20+2 ≥ 12」、`rollCheck()` 用命名流 `check` 掷 1–20，结果写进历史与弹窗（`d20(14)+2 = 16 ≥ 12，成功`） |
| 选项检定 | `ChoiceDef.check?: {attribute, difficulty}` 与 `failureEffects`：成功走 `effects`、失败走 `failureEffects`；`choiceUtility` 仍用于 NPC/无头模式的择优 |
| 抉择不再代选 | 移除 `expireChoices`：玩家挂起的抉择不会因时间流逝被自动处理，世界继续走、随时可点；`CHOICE_WINDOW_DAYS` 仅用于记录 |
| 更多要决策的事件 | 冒险事件从 4 条有选项扩到 9 条（伏击、拦路、老商人、捡钱、募捐、家事、征召、买卖、机会），全部带属性检定；`.tmp/player-freq.ts` 实测玩家事件 ~2 次/年（此前 ~1 次/年且多无选项） |
| 不再自动暂停 | 删除 `pauseForPlayer()`：相关事件只弹窗、不再把速度归零；读档恢复上一次速度；只有玩家死亡与推进出错会停 |
| 教玩家看属性 | 抉择按钮的 hint 自动追加检定规则（属性、加值、门槛）；人物面板与左栏人物卡展示六维与 `skillEffectSummary` 的每级收益 |
| 测试 | 新增 `tests/checks.test.ts` 5 例；`tests/choices.test.ts` 的超时用例改为「时间不会替你决定」；全套 **29 文件 / 194 例** |
| 产物 | 100 年 demo `--check` 通过、3.85 s、市场 56/56 在区间、破产 21.7%、分裂 13.0%；`release/index.html` 见构建输出 |

### 8.36 玩家人物卡与占位符修复（2026-11-20）

| 项 | 内容 |
|---|---|
| 左栏人物卡 | 新增 `src/ui/CharacterCard.ts` 的 `renderCharacterCard(host, deps, selected, { compact })`，把人物面板正文（四格概览、档案六格、阵营九宫格、生涯、关系、六维、组织入口、技能、性格）抽成共用渲染；玩家卡底部以 `<details open>`「我的人物卡」嵌入 `compact` 版（两行摘要 + 档案 + 阵营 + 六维），不切面板即可看到成长数据 |
| 人物面板 | `CharacterPanel` 改为调用同一渲染，删掉重复的 `roleOf`/`bar`；技能与性格改用 `SKILL_LABELS`/`TRAIT_LABELS`，不再泄漏 `skill.trade` 之类的英文键 |
| 占位符 | `EventEngine.eventTextForRefs` 按 `HistoryRef.type` 解析主体；`App` 的抉择/见闻/预兆与 `GameEngine` 的等待与超时标题统一走 `eventText`，修复「{country}的秋收宴银月王国」这类裸占位符 |
| 默认速度 | `App` 的初始 `speed = 1`，`start()` 里显式 `setSpeed(1)`，进入游戏即按 1× 推进（相关事件自动暂停仍保留） |
| 测试 | `tests/ui-panels.test.ts` 加「左侧玩家卡也展示人物卡」；`tests/local-events.test.ts` 加「历史与弹窗里的标题、正文都不残留占位符」；全套 **28 文件 / 189 例** |
| 产物 | `release/index.html` **363,804 字节**（23.1%） |

### 8.35 成长与旅行的实现（P1–P3，2026-11-20）

| 项 | 内容 |
|---|---|
| 技能收益 | 新增 `src/systems/character/SkillEffects.ts`：贸易采购 −1%/级、出售 +1%/级（封顶 12%）、单次贩货 5+贸易等级；谈判契约利率 −2%/级；说服游说 +0.01/级；洞察打听 +8%/级。`skillEffectSummary()` 把每级收益折成中文给界面 title |
| 生涯月俸 | `CAREER_SALARY = [0, 40, 120, 300]`；`Finance` 增加 `careerWageBill`：月俸作为工资支出进损益，足额发放才记到成员钱包（发不出不造钱）；玩家卡显示「称号（N/3）· 月俸 X 铜」与「下一阶」门槛（现金 / 主技能） |
| 到场规则 | 谋职必须在该国首都（`Offices.capitalOf`）；游说必须在首都，或持影响力 ≥0.4 的公职可远程；签约必须在组织总部；新增 `attend_court`（首都赴宴 50 铜，与统治者/大臣关系 +8）与 `inspect_market`（考察当地行情 30 天，异地价格由 `≈` 估价变精确） |
| 地区页机会 | 「此地的机会」最多 4 条：异地贩货净利（按技能系数与运费算）、王庭可谋职位与评分、受控组织总部可签约买股、钱庄可存取；「前往」区补充「此行可办」 |
| 存档 | `SCHEMA_VERSION` 8 → **9**（`WorldState.inspections`）、`SAVE_FORMAT_VERSION` 9，新增 `migrateV8toV9` |
| 测试 | 新增 `tests/growth-visibility.test.ts` 5 例、`tests/travel-purpose.test.ts` 5 例；全套 **28 文件 / 187 例** |
| 校准 | 生涯月俸改变组织现金后，国库/组织现金 5 年比值 0.204，验收带宽由 0.05–0.20 调为 **0.05–0.22**（仍是同一量级） |
| 产物 | 100 年 demo `--check` 通过、3.3 s；`release/index.html` **361,813 字节**（23.0%） |

### 8.34 成长与旅行方案（2026-11-20）

玩家反馈「成长点数看不出用处」「出门有成本却没有理由」，方案见 [`docs/growth-travel-design.md`](growth-travel-design.md)：技能逐级有用（贸易折价、贩货上限、契约利率、游说幅度）、生涯四阶给月俸与权限、地区页列出「此地的机会」并显示此行成本、公职/游说/签约改为必须到场，分 P1（透明化）/ P2（在场规则）/ P3（成长收益）三阶段落地。

### 8.33 界面调整：行动分组与城市前往（2026-11-20）

| 项 | 内容 |
|---|---|
| 左侧个人行动 | 按「修养（休息）/ 生计（贩货）/ 钱庄（存、取）」分组，组内一行按钮、组间虚线分隔；训练按钮单独成块 |
| 移动入口 | 从左侧移除（原来最多三个「去X」按钮），左侧只留提示「在地图或右侧地区页点城市 → 前往」 |
| 右侧地区页 | 新增「前往」区：本地显示「你正在此地」，相邻城市显示「路程 N 天 · 路费 M 铜 · 消耗 1 行动力与 2 健康」+「前往」按钮（行动力/健康/现金不足时置灰），不相邻提示「没有直达商路」 |
| 交互 | 点「前往」→ `move` 命令 → 自动 `advanceDays(travelDays)` → 地图与面板刷新；路费按 `days*2` 与命令侧一致 |
| 验证 | 新增 `tests/ui-panels.test.ts`（jsdom，4 例：分组、休息真实扣行动力、相邻前往真的移动并扣路费、本地/不相邻不出现按钮）；新增 devDependency `jsdom`（仅测试环境，不进产物） |
| 产物 | 26 文件 / 177 例；`release/index.html` 353,647 字节（22.5%） |

### 8.32 M7 阶段 7：打磨与发布（2026-11-20）

| 项 | 内容 |
|---|---|
| 文案与枚举 | `CreateCharacterDialog` 背景卡改中文职业/地区/技能（`CLASS_LABELS`/`SKILL_LABELS`/地区名），组织下拉改 `ORG_TYPE_LABELS`；不再泄漏 `merchant · r_greenfield`、`guild`、`trade` 这类内部 id |
| 可访问性 | 抉择弹窗 meta 由 0.72rem/`text-muted` 提到 0.78rem/`text-secondary`（对比度约 5.6:1）；全局 `:focus-visible`、地图节点焦点环、按钮 `aria-label` 保持 |
| 性能复测 | 100 年 **3.66–3.89 s**（14 区 / 56 市场 / 65+ 事件）；`tests/simulation.test.ts` 断言 < 8000 ms；D7 预算由「14 区 < 3.5 s」调整为「14 区 < 4.0 s」，原因写进 §9.3 |
| 版本 | `package.json` 1.0.0 → **2.0.0** |
| 发布 | `release/index.html` **351,703 字节**（22.4%）；CI（typecheck/lint/test/build/release diff）与 Deploy Pages 复核通过 |
| 验收 | 全套 25 文件 / 173 例；三 seed 100 年破产 20.8–28.0%、分裂 8.3–12.0%、继承危机 45–49 次；`sim --check` 一致 |

**未达成**：审计中的「事件正文只在弹窗出现、编年史只存标题」仍是简化；存档迁移仍无自动备份到 `backup` 槽（迁移只丢弃旧哈希）；线上只做了 DOM/字节级核对，没有真实的像素与交互回归。



### 8.31 M7 阶段 6：模拟深化（2026-11-20）

| 项 | 内容 |
|---|---|
| 战争经济 | `MarketSystem`：交战国的当月需求 ×1.12；`TradeSystem`：任一端交战时商路容量 ×0.55（与贸易开放度叠乘），战时价格与运力都可见 |
| 继承政治 | `CharacterSystem.handleDeath`：统治者死亡必排 `ev_country_succession_crisis`（+20 天）；`Ruler.installRuler` 对 <16 岁统治者调 `chooseRegent` 写入 `Country.regentId`，成年后清空；`CountryPanel` 显示「（X 摄政）」 |
| 种族差异 | `Demography.effectiveAge`：精灵 ×0.35、矮人 ×0.85、人类 ×1；`annualMortality` 用折算年龄，精灵实际寿命约为人类三倍 |
| 家族声望 | `Family.prestige`（0–100）：每年按在世成员公职 +2、生涯满级 +1，无人则 −1；`CharacterPanel` 显示「家族（声望 N）」 |
| NPC 关系 | `settleNpcRelations`：每年在同组织在世成员中抽一对，50% 结盟（`ally` +30）/ 50% 结怨（`rival` +25），百年后 204–284 对 |
| 校准 | `ev_org_split` 的 `lambda0` 0.07 → **0.018**、`cooldownDays` 1320 → **400**；`tests/policy.test.ts` 政体变更上界 6 → 8（战败与破产让个别国家真的崩溃，约每国 1 次/百年） |
| 测试 | 新增 `tests/politics.test.ts` 6 例（种族寿命、摄政、继承危机入队、家族声望、战时需求、十年 NPC 关系）；全套 25 文件 / 173 例 |
| 指标 | 三 seed 100 年：破产 **20.8/26.1/28.0%**、分裂 **8.3/8.7/12.0%**、继承危机 45–49 次、宣战 44–58 次、存活 50–69 人；`--check` 一致 |
| 产物 | `release/index.html` **351,584 字节**（22.4%） |

**未达成**：战时价格只做了「需求放大 + 运力腰斩」，没有军需采购、配给与黑市；继承危机是固定事件，没有真正的派系与拥立者名单；家族声望只影响面板展示，尚未回馈到婚配与事件权重。



### 8.30 M7 阶段 5：目标与新手（2026-11-20）

| 项 | 内容 |
|---|---|
| 建议引擎 | 新增 `src/systems/goals/Goals.ts`：`bestTradeRoute`（本地买价×1.05、邻区卖价×0.95、扣运费）、`suggestGoals(state, content, limit=3)`（健康<55 → 休息；商路净利>0 → 贩货；持股<34% → 买入/攒钱；公职评分≥45 → 谋求；财富过晋升门槛 → 练主技能；否则训练/探路），`titleOf` 按公职 > 领袖 > 生涯给称号 |
| 野心与章节 | 新增 `src/systems/goals/Ambition.ts`：野心由职业推导（`merchant → fortune`、`mercenary → renown`、`politician → power`），`ambitionOf` 给出进度 0–1 与提示；`chapterOf` 每十年一章、标题随处境变化。均为纯函数，不新增存档字段 |
| 界面 | 新增 `src/ui/SuggestionsPanel.ts`，钉在左栏玩家卡下方：标题 + 「行动力/现金」小字 + 三条建议（序号、标题、真实数字、可点「去做」）；失败时弹出引擎原话 |
| 第一份财报 | `App.maybeFirstReport()`：玩满 30 天弹一次，报出现金、行动力、健康、野心进度与「下一步看哪里」 |
| 玩家卡 | 新增「野心」行：`富甲一方 34% · 第 2 章「渐入佳境」` |
| 测试 | 新增 `tests/goals.test.ts` 7 例（永远三条且带数字、低健康先休息、持股不足给买股/攒钱、第一条商路正收益、称号优先级、建议命令可执行、野心/章节随时间推进）；全套 24 文件 / 166 例 |
| 产物 | `release/index.html` **349,677 字节**（22.2%） |

**未达成**：建议是规则表，不是规划器（不会做三步以上的连锁目标）；野心是标签而非可失败的目标，也没有结局判定。



---

## 9. 测试与质量策略

### 9.1 测试金字塔

| 层级 | 范围 | 工具 | 目标 |
|---|---|---|---|
| 单元 | 每个系统函数、公式、校验器 | Vitest | core/systems 行覆盖 ≥ 80% |
| 集成 | 引擎 + 系统 + 事件 | Vitest（无 UI） | 关键路径全覆盖 |
| 确定性 | 同种子状态哈希 | golden 文件 | 每次 PR 必跑 |
| 等价性 | 快进 vs 逐步 | 专门用例 | 必须完全一致 |
| 不变量 | 会计、守恒、引用 | 属性测试 | 每次月结/年结断言 |
| 内容校验 | JSON schema、引用、文本 | 构建期 + 测试 | 0 悬空引用（**R8 仍缺独立用例**） |
| 批量模拟 | 100 种子 × 100 年 | `pnpm sim` | 指标落盘、可对比 |
| 性能 | 快进、渲染 | 基准脚本 | 超预算即失败 |
| 端到端 | 6 个验收场景 | 无头浏览器 | **未做**：现为 jsdom 组件级（`ui-panels` / `modal-pause` / `app-modal-pause`）+ 手工 Edge 探针 |

### 9.2 必须长期存在的回归用例

**实测映射（v2.0.0）**：**33 个测试文件、207 个用例**，`pnpm test` = `vitest run`。状态列区分「有专用断言」与「仅间接覆盖」。

| 编号 | 内容 | 文件 | 现状（v2.0.0） |
|---|---|---|---|
| R1 | 同种子 100 年状态哈希稳定 | `tests/simulation.test.ts` | ✅ 已覆盖：同种子两次快进哈希一致；不同种子哈希不同 |
| R2 | 逐月 ×1200 与一次快进 1200 天结果一致 | `tests/fastforward.test.ts` | ✅ 已覆盖（4 例） |
| R3 | 存档 → 读档 → 续跑 = 不中断续跑 | `tests/fastforward.test.ts` + `tests/migration.test.ts` | ✅ 已覆盖：序列化往返、哈希校验、损坏存档拒绝；迁移链 8 例覆盖 v1→v9 与旧档续跑 |
| R4 | 组织破产流程不产生负资产残留 | `tests/organization.test.ts` + `tests/economy-m2.test.ts` | ✅ 已覆盖：生命周期四态、清算顺序（债主 → 欠薪 → 股东）、`shortfall` 入历史、会计恒等式 |
| R5 | 政策变更不违反政体约束 | `tests/country.test.ts` + `tests/policy.test.ts` + `tests/politics.test.ts` | ✅ 已覆盖：三阶段与预算恒等式、30 个月冷却、幅度上限、政体切换门槛、继承危机与未成年摄政 |
| R6 | 事件互斥组不会同点双发 | `tests/events.test.ts` + `tests/event-chains.test.ts` | ✅ 已覆盖：互斥竞速、冷却、效果夹取、`schedule` 后续事件、`history.<eventId>` 条件 |
| R7 | 人物死亡不产生资产/职位重复 | `tests/organization.test.ts` + `tests/character-lifecycle.test.ts` + `tests/relations-career.test.ts` | ✅ 已覆盖：领袖与统治者继承、遗产与股份守恒、婚姻对称、退休时位置按规则移交 NPC |
| R8 | 内容 JSON 全部通过 schema 与引用校验 | `tests/simulation.test.ts` | ❌ **仍缺独立用例**：仅「世界内容包含 MVP 规模的实体」间接约束（地区 ≥4、组织 **=21**、人物 **=54**、事件 **≥22**），且无独立 schema 校验器 |

> 补测优先级：R8（内容校验器 + 引用完整性，把 90 条事件 / 21 组织 / 54 人物 / 14 区 / 7 国的 id 引用都断言一遍）> UI 层的端到端场景（当前只有 jsdom 组件级）> 性能断言的机器无关化。

### 9.3 性能预算

**D7（2026-11-19 修订，2026-11-20 再修订）**：世界从 MVP 的 2 国 5 区扩到 7 国 14 区 21 组织 54 人物后，"100 年 < 2 s" 不再成立，改为**按内容规模分档**：5 区 < 2 s、14 区 < 4.0 s（M7 加入 42 条本地事件、编年史专名替换、战争需求/运力与继承危机之后实测 3.66–3.89 s；`region/RegionNews` 提交后复测 3.58–3.66 s，五次复跑一致）。`tests/simulation.test.ts:59` 的性能断言实际是 `expect(elapsed).toBeLessThan(8000)`（用例标题写"14 区 < 3.5s"是旧值，超时 60_000），即给 CI 抖动留 2 倍余量；分档目标由 `pnpm sim --check` 的三 seed 人工复核。

| 场景 | 预算 | 超限处理 |
|---|---|---|
| 快进 100 年（5 区，MVP 规模） | < 2 s | 降层、事件批采样、减少月结实体 |
| 快进 100 年（14 区，当前内容） | < 4.0 s | 同上 + 特征缓存、季度抽样、商品索引 |
| 单次 UI 更新 | < 16 ms | 增量渲染、虚拟列表 |
| 存档写入 | < 100 ms | 压缩、分片 |
| 构建产物 | ≤ 1.5 MB（1,572,864 字节） | 拆分内容、压缩图片、移除未用代码 |

### 9.4 CI

实际顺序（`.github/workflows/ci.yml`）：

```
checkout → pnpm/action-setup → setup-node 22 → pnpm install --frozen-lockfile
         → typecheck → lint → test → build → node scripts/release.mjs
         → git diff --exit-code -- release/index.html → upload-artifact release/index.html
```

- 体积校验由 `scripts/release.mjs` 的 `statSync` 完成（阈值 1,572,864 字节），工作流里**没有**单独的 `stat -c%s` 步骤。
- `git diff --exit-code -- release/index.html` 保证「提交的成品 == 当前源码构建结果」，防止忘记提交产物。
- 无 golden 文件、无批量模拟 smoke、无 JSON Schema 校验步骤（见 §9.2 R8）。
- PR 必须全绿；`main` 分支保护，禁止直接推送。

---

## 10. 数值校准

### 10.1 指标采集（对应 GDD 19.2）

- 组织：寿命分布、破产率、分裂率、扩张率、资产集中度、财务健康分布
- 国家：政策平均存续期、政体变更频率、战争频率、财政危机频率、领土变化
- 经济：价格波动率、供需缺口、贸易规模、货币总量、债务规模、财富集中度
- 体验：每游戏年决策次数、决策间隔、策略可行性、后期无效等待占比

### 10.2 对照实验（GDD 19.3）

同一初始种子下跑 7 组：无干预、经营商会、影响政策、发起战争（M6）、长期不行动、集中投资、分散投资。输出指标表 + 世界摘要 diff。

### 10.3 调参流程

```
定义期望体验 → 设初始参数（balance.json）→ 跑 100 种子 × 100 年
→ 看指标分布（中位数/分位数）→ 只改一个参数族 → 重跑 → 记录到校准日志
```

原则：**不预设"组织平均存活 30 年"**；先定义体验，再让数据收敛。每次参数变更必须附 before/after 指标。

---

## 11. 风险登记

| # | 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|---|
| 1 | 模拟复杂度失控，调试成本爆炸 | 高 | 高 | 严格分阶段；每个里程碑只加一个域；系统间通过状态而非调用耦合 |
| 2 | 确定性漂移（浮点/顺序） | 中 | 高 | 金额整数化；固定遍历顺序；状态哈希回归 |
| 3 | 世界过稳或过崩 | 高 | 中 | 批量模拟 + 分位数校准；风险函数分段；不设单一稳定度 |
| 4 | 快进性能不足 | 中 | 高 | 分层结算、事件批采样、性能预算前置 |
| 5 | UI 工作量被低估 | 中 | 中 | M2 起做调试版面板；M5 只做样式与整合，不新增交互概念 |
| 6 | 单文件包体超限 | 中 | 中 | 资源体积预算；SVG 代替位图；构建期体积检查 |
| 7 | 内容量失控（事件写不完） | 高 | 中 | MVP 事件数冻结（10/8/6）；先用占位文本跑通系统 |
| 8 | 数值膨胀（金币无限增长） | 中 | 高 | 显式货币通道 + 成本约束 + 审计断言 |
| 9 | 存档迁移破坏旧档 | 低 | 高 | 迁移链 + 旧档夹具 + 只增不改字段 |
| 10 | 单人开发节奏中断 | 中 | 中 | 每阶段可交付；M1 结束即可演示"世界在跑" |

---

## 12. 工程规范

### 12.1 分支与提交

- 主干开发：`main` 始终可构建；功能分支 `feat/<scope>-<slug>`，生命周期 ≤ 3 天。
- 提交信息：`<type>(<scope>): <subject>`，type ∈ `feat|fix|refactor|test|docs|chore|perf`。
- 每个 PR：单一目的、含测试、更新本文件对应任务状态。

### 12.2 代码规范

- 无 `any`（确需时用 `unknown` + 类型守卫）；无 `@ts-ignore`。
- 纯函数优先：系统函数签名 `(state, ctx) => DomainEvent[]`，不直接改全局。
- 数值常量只能出现在 `content/balance.json` 或模块顶部 `const` 并注释来源。
- 每个系统文件头部注释：职责、输入、输出、不变量。

### 12.3 Definition of Done

- [ ] 类型检查、Lint、单测全绿
- [ ] 新增逻辑有对应测试（含边界）
- [ ] 影响确定性的改动通过哈希回归
- [ ] 影响存档结构的改动带迁移与夹具
- [ ] 性能在预算内
- [ ] 本文件任务状态已更新

---

## 13. 验收清单（GDD 18.6）

**状态口径（v2.0.0）**：只有「代码里能跑出断言」或「CI 里能读到」才算 ✅；依赖 UI、人工审阅或尚未执行的，一律写待验证/部分达成。所有场景的复跑命令与实测数字见 `docs/acceptance.md`。

| 场景 | 验收内容 | 判定方式 | 状态（v2.0.0） |
|---|---|---|---|
| A 无人干预 | 100 年模拟，国家/组织/市场出现合理变化 | 指标分布 + 人工审阅历史摘要 | ✅ 已达成：三 seed 100 年指标归档（§8.16、`docs/acceptance.md` §1/§9）；人工审阅完成并据此删掉逐月「月度结算」噪声（历史 16,915→10,278 条） |
| B 商业干预 | 玩家建商会控制某商品，其他组织能竞争，政府可能调政策 | 脚本化玩家命令回放 + 指标对比 | ✅ 已达成：`tests/acceptance.test.ts` 四例（贷款+商路+投资改变利润、扩产改变份额、NPC 新进入、政策回应） |
| C 政策干预 | 玩家推动降关税，商路/价格/利润变化 | 对照实验（同种子） | ✅ 已达成：`docs/acceptance.md` §3 六例（lobby 生效、关税进贸易成本、降税后进口量与利润变化、政策冷却） |
| D 财务危机 | 长期亏损组织进入融资/重组/出售/破产 | 单元 + 集成断言 | ✅ 已达成：`tests/acceptance.test.ts` 断言 crisis → restructuring → dissolved 全流程、清偿顺序与 `shortfall` |
| E 人物死亡 | 组织按规则选出新领导，无资产重复/职位错继承 | 单元 + 集成断言 | ✅ 已达成：`tests/organization.test.ts` + `tests/character-lifecycle.test.ts`（遗产现金与股份守恒、股份总额恒 100%、公职补位、死亡解绑配偶） |
| F 快进一致性 | 同种子同命令，逐月与快进结果一致 | 哈希相等 | ✅ 已达成：`tests/fastforward.test.ts` 覆盖，`pnpm sim --check` 复跑比哈希 |

**发布前人工检查**：离线双击可玩、无控制台报错、存档往返正常、事件文本无占位符、四种地图图层可用。**当前进度（2026-11-20，v2.0.0）**：`release/index.html` **374,280 字节（预算 23.8%）**；最近一次 Edge 探针为 `panels=7 | buttons=148 | svg=1 | dossier=1 | errs=0`（`docs/acceptance.md` §16 记录的是 320,284 字节 / 148 按钮的中间态，§17 之后又加了军团页签与待决抉择按钮，未再复验）；存档往返、创建人物、抉择弹窗、待决抉择入口均有探针或 jsdom 覆盖；**四种地图图层与像素级美术未做**（M5 只做了单层程序化地形）。

---

## 14. GDD 第二十三章"十个问题"的验证计划

| # | 问题 | 验证方式 | 时点 |
|---|---|---|---|
| 1 | 世界如何表示人物/组织/国家/地区 | §6 类型 + `validateWorld` | M1 |
| 2 | 组织财务如何连接市场供需 | Finance × Market 集成用例 | M2 |
| 3 | 分裂/破产/扩张概率如何计算 | `OrganizationRisk` + 批量模拟分布 | M2 |
| 4 | 政策变化概率与改革方向 | `PolicySystem` + 100 年统计 | M3 |
| 5 | NPC 如何按利益选择行动 | 效用模型 + 决策日志抽样审查 | M3 |
| 6 | 分层之间如何保持一致 | 升降层等价用例（升→降→升） | M3 |
| 7 | 如何实现可复现任意快进 | 哈希回归 + 等价用例 | M1 |
| 8 | 如何避免随机事件制造不合理历史 | 条件约束 + 竞争集合 + 冷却 + 审阅 | M2 |
| 9 | 玩家如何主动创造机会 | 行动菜单 + 计划系统 + 对照实验 | M4 |
| 10 | 如何证明玩家选择改变了世界 | 同种子对照实验 diff | M5 |

---

## 15. 待确认事项

1. **美术资源**：是否接受纯 SVG/几何风格（无位图），还是需要角色/场景插画？后者会显著影响包体与排期。
2. **内容语言**：MVP 仅中文，还是中英双语（影响文本组织方式与打包体积）？
3. **存档位置**：是否需要"云同步"或"文件夹导出"？当前按浏览器本地存储 + 文件导入导出设计。
4. **输入方式**：是否支持键盘快捷键与移动端？当前按桌面鼠标设计。
5. **首发渠道**：itch.io 单文件、Steam（需 Electron 包装）还是仅自用？影响 M5 的发布工程。
6. **GDD 中"现有 HTML Demo"**：是否有可参考的原型代码？若有，M1 可复用其内容数据，节省 2–3 人日。**（v0.2 注：此项已被实现现状取代——仓库内已有可运行的 M1 核心，不再依赖原型。）**
7. **M1 收尾口径**（v0.2 新增）：性能预算是按 2 s 收紧并补性能基准，还是先放宽到 5 s 待 M5 再优化？**（v0.3 已定：D7 改为按内容规模分档——5 区 < 2 s、14 区 < 4.0 s；`tests/simulation.test.ts:59` 的断言是 8000 ms，留 CI 抖动余量。）**
8. **内容校验强度**（v0.2 新增）：是否引入 JSON Schema 校验器（新增 devDependency），还是把 `validateWorld()` 的引用检查补成独立测试即算 R8 达成？**（v0.3 仍未拍板；R8 至今是 ❌，见 §9.2。）**

---

## 附：周计划总表

> v0.3 说明：下表是**原始排期**，仅作历史对照。M0–M7 已全部完成（见 §8.1），实际交付比原 16 周计划多出 M6 战争与 M7 打磨两个大阶段，均已按阶段记录在 §8.2–§8.38。

| 周 | 里程碑 | 交付物 | 演示 |
|---|---|---|---|
| W1 | M0 | 可构建骨架、CI 绿 | 单文件打开显示标题 |
| W2 | M1 | 状态/时钟/随机/命令 | 控制台推进 1 年 |
| W3 | M1 | 事件引擎 + 历史 + 存档 | 触发 3 个示例事件 |
| W4 | M1 | 最小世界数据 + 100 年模拟 | 哈希稳定的 100 年摘要 |
| W5 | M2 | 组织实体 + 财务月结 | 商会月度报表 |
| W6 | M2 | 市场/生产/商路 | 价格随供需变化 |
| W7 | M2 | 风险与生命周期 + 组织事件 | 破产/分裂演示 |
| W8 | M3 | 国家预算 + 政策向量 | 税率与财政联动 |
| W9 | M3 | 三阶段改革 + 政体 | 政策自主变更 |
| W10 | M3 | NPC 决策 + 国家事件 | NPC 月度行动日志 |
| W11 | M4 | 人物成长 + 检定 | 一次冒险检定 |
| W12 | M4 | 关系 + 冒险事件链 | 事件链演示 |
| W13 | M4 | 结局与跨角色 | 角色死亡→新角色 |
| W14 | M5 | 完整 UI 布局 + 地图 | 可点击的三栏界面 |
| W15 | M5 | 存档/导入导出 + 校准 | 100 种子指标报告 |
| W16 | M5 | 性能与发布检查 | 发布候选单文件 |

---

**下一步（v2.0.0 之后）**：M0–M7 已全部完成并发布 2.0.0。按价值排序的待办：

1. **R8 内容校验**（唯一仍为 ❌ 的回归项）：给 90 条事件 / 21 组织 / 54 人物 / 14 区 / 7 国做 id 引用与 schema 断言，最好抽成 `tests/content.test.ts`。
2. ~~**结构整改**~~ **已完成**（详见 `docs/architecture-review-2026-11-20.md` §4）：`PolicySystem` 的 `content` 默认参数已改为显式传参、`eslint.config.js` 已补 `content` 规则；`ui` 只读引用 `systems` 已认定为既定例外并写进 §4.2 铁律；6 个超大文件已全部拆分（`WorldState.ts` 1431→591、`CommandBus.ts` 1173→205、`EventEngine.ts` 967→43、`App.ts` 953→595、`Demography.ts` 702→302、`MapView.ts` 674→508），**全仓库源文件现均 ≤ 602 行**；零引用的 `systems/character/SkillCheck.ts` 与三个孤儿 JSON 已删除。
3. **`snapshot()` / `subscribe()` 或至少脏标记**：现在 UI 靠 `refresh()` 轮询 + `hash()` 判重，12,000 条历史时每次全量 `hashWorld` 是隐患，比继续拆文件更能改善手感。
4. **玩法缺口**：多军团与战线、战役地形修正、四种地图图层、神权/部落/商邦的政体差异进决策公式、AI 婚姻纳入财富与声望。
5. **§15 的第 1–5 项**仍需产品决策（美术风格、语言、云同步、输入方式、首发渠道）。
