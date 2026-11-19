# personal_throne

《王座与黄金》（Throne & Gold）——单机奇幻角色扮演 / 经营策略 / 动态世界模拟。

## 文档

- 玩法与世界观：[design.md](design.md)（GDD v1.0）
- 工程计划与排期：[development-plan.md](development-plan.md)
- 后续路线（M4 及以后）：[docs/roadmap-m4-plus.md](docs/roadmap-m4-plus.md)（世代更替、生涯与抉择、完整 UI 与校准、战争与七国）（v0.2，含 §5.2 实现偏差记录、§8.1 当前进度、§8.2–8.4 各阶段记录）

## 当前状态

**M0 工程基线：完成。** TypeScript 严格模式、单文件构建、ESLint 架构约束、Vitest 与 GitHub Actions CI 均已就绪。

**M1 模拟核心：完成。** `src/core/` 8 个模块（世界状态、历法、随机、命令、事件、历史、分层、引擎）+
`src/systems/` 16 个结算文件；`pnpm sim --years 100 --seed demo --check` 实测 1.4–1.7 s、哈希稳定。

**M2 组织与经济：完成。** 组织生命周期（active → crisis → restructuring → dissolved，清算顺序 债主 → 欠薪 → 股东）、
契约（供货 / 运输 / 贷款 / 雇佣）、市场份额竞争、在途货运与关税、四类风险系数表、10 条组织事件；
验收 B（商业干预）与 D（财务危机）已由 `tests/acceptance.test.ts` 断言。三 seed 100 年实测：
破产率 22.2–31.6%、分裂率 5.6–10.5%（目标区间 15–35% / 5–15%）。

**薄 UI：可用。** `src/ui/` 12 个文件——SVG 地图、人物 / 组织 / 国家面板、事件弹窗、历史、暂停 / 1× / 7× / 30× /
跳下一事件、存档（IndexedDB 槽位 + 导出导入）。原生 DOM，零依赖。

**M3 国家与政策：完成。** 政策三阶段（压力 → 提案 → 按政体决策，30 个月冷却、单次幅度上限）、政策传导经济（关税进贸易成本、`tradeFreedom` 影响运力与损耗、`regulation` 压价、`taxRate` 进组织税率）、政体不变式（统治者必须在世，君主死亡即选定继承人或摄政；政体变更需连续 24 个月崩溃且距上次 ≥240 个月）、国家事件 10 条、统治者内阁决策（增税 / 裁军 / 借债）、存档 v3 迁移。验收 C（关税对照实验）已断言。三 seed 100 年实测：政策变更 17 / 18 / 25 次（目标 8–25）、同政策最小间隔 900 天、均价偏离 12.8–16.3%、20 个市场 100% 落在 70–140% 区间。

**M4 角色与叙事：完成（M4.1–M4.6）。** 人物档案（六维 1–20、阵营双轴 −100..100 + 九宫格、信仰可无、七种地点、家系与代际）与人口学
（年度衰老/死亡、遗产与股份守恒、婚姻建族、出生继承、具名人口下限补员）已落地；存档升至 v4 并带迁移。
人物面板新增「档案 / 阵营九宫格 / 六维」，玩家卡显示性别、信仰与阵营。
顶栏「创建人物」可选 6 种出身 + 3 个天赋标签（每 +2、单维上限 16）、填姓名或按文化随机、选性别与信仰，登场后自动挂到玩家卡。
关系网（亲族/盟友/对手/世仇/债务，双向不对称、年度回归）与三段生涯阶梯（学徒→伙计→行商→商会主等，按财富+技能+公职晋升，破产降级）已落地，玩家可一键转行；事件链（父事件按延迟/概率/条件排定后续，后续事件不参与随机抽选，可用 `history.<eventId>` 作条件）已落地；抉择（`EventDef.choices` + `choose` 命令 + 45 天等待窗，超时按效用自动处理，NPC 直接择优）。

**M6 战争：MVP 完成。** 常备军（规模随人口与军费占比、训练/士气/统帅）、宣战（双向交战列表、外交暴跌、24 个月停战冷却）、
行军（每月推进一格，弱势方守土，敌军入境则拦截）、会战（战力比 + 伤亡 + 撤退）、围城与占领（3 个月易主，停战割让）、
厌战（每月累积，达阈值或国库枯竭自动停战）、AI 宣战（关系 < −30 且兵力 1.3 倍时月度 5%）。玩家命令：
`declare_war` / `offer_peace` / `levy_army` / `march_army`（需统治者，或影响力 ≥0.4 的公职）。三 seed 100 年：宣战 10–15 次、
会战 150–209 场、占领 4–6 次、破产率 15.6–16.7%、分裂率 2.8–19.4%。

**M5 整合与美术：完成。** 新手引导（4 步浮层高亮，只出现一次，顶栏「?」重看）、程序化 SVG 地形地图（hover tooltip、
运力连线、键盘选中）、存档对话框（自动槽 + 手动槽 1–3，覆盖需连点两次）、历史筛选与「只看我的」、快捷键（空格/1/2/3/4/Esc/?）、
79 个按钮全带 `aria-label`、设计令牌统一、≤900px 单列适配；`build.modulePreload.polyfill=false` 让产物零 `fetch(` 字面量。

**在线试玩**：<https://tulongzikun.github.io/personal_throne/>（GitHub Pages，发布 `release/index.html）。
离线也可以直接双击 `release/index.html`。

**M6.1 世界扩展：完成。** 世界从 2 国 5 区扩到 **7 国 / 14 地区 / 18 组织 / 51 人物 / 4 文化**，新增 6 条国家事件
（宗教会议、氏族冲突、商会特许、草原劫掠、山谷雪崩、部族大会），政体仍只有君主/共和两套实现，神权/部落/商邦差异用
合法性、稳定性与政策初值表达。为腾出性能预算，事件抽样加了区域价格比与历史计数的特征缓存、人物事件改季度抽样，
并删掉逐月「月度结算」历史噪声（历史 16,915→10,278 条）。三 seed 100 年 2.8–3.1 s。

**测试与产物**：17 个测试文件 / 126 个用例；单文件 `release/index.html` 280,172 字节（体积预算 17.8%），
无 `<script src>`、无 `<link href>`，`file://` 下可运行（Edge 探针 7 面板 / 79 按钮 / 档案区块可见 / 创建对话框与存档对话框可用 / 0 控制台错误）。

**验收**：场景 A–F、存档版本链（v1→v7）与战争段见 `docs/acceptance.md`。

**尚未完成**：多军团与战线、战役地形修正；四种地图图层（M5 只做了单层地形）；神权/部落/商邦的政体差异未进入决策公式；
烬瀑城、风蹄原、马集没有本地生产组织。已知问题：AI 婚姻只按地区/国别加权，未考虑财富与声望；占领只换宗主、不迁移人口；
grain/iron 在少数地区仍有 150–180% 离群价。详见 [development-plan.md §8](development-plan.md)。

## 环境要求

- Node.js ≥ 22
- pnpm 11（`packageManager: pnpm@11.28.5`；`corepack enable pnpm` 或 `npm i -g pnpm`）

## 命令

```bash
pnpm install        # 安装依赖
pnpm dev            # 本地开发（Vite HMR）
pnpm build          # 类型检查 + 产出单文件 dist/index.html
pnpm release        # build + 校验（无外链 / ≤ 1,572,864 字节）+ 复制到 release/index.html
pnpm preview        # 预览构建产物
pnpm typecheck      # 仅类型检查
pnpm lint           # ESLint（架构依赖方向、Math.random 与 new Date 禁令）
pnpm test           # vitest run：16 个文件 / 121 个用例
pnpm test:watch     # 监听模式
pnpm format         # Prettier
pnpm sim --years 100 --seed demo-seed            # 无界面快进，打印哈希 / 耗时 / 破产率 / 分裂率 / 价格偏离 / 关税
pnpm sim --years 100 --seed demo-seed --check    # 复跑并比对状态哈希，不一致则退出码 1
```

`pnpm sim` 由 `tsx` 直接执行 `scripts/sim.ts`（开发期依赖，不进产物）；默认 `--years 100 --seed demo-seed`。

## 测试

| 文件                                | 用例 | 覆盖                                                 |
| ----------------------------------- | ---- | ---------------------------------------------------- |
| `tests/simulation.test.ts`          | 6    | R1 确定性/状态哈希、世界规模、100 年稳定性与性能预算 |
| `tests/fastforward.test.ts`         | 4    | R2 快进等价性、R3 存档往返与损坏拒绝                 |
| `tests/organization.test.ts`        | 8    | R4/R7 会计恒等式、投资与权限、领袖与统治者继承       |
| `tests/country.test.ts`             | 7    | R5 预算恒等式、政策三阶段、游说命令                  |
| `tests/events.test.ts`              | 9    | R6 互斥竞速、冷却、效果夹取、后续事件、人物分层      |
| `tests/policy.test.ts`              | 6    | 政策压力、提案成本、冷却、政体不变式                 |
| `tests/economy-m2.test.ts`          | 14   | 生命周期清算、契约、市场竞争、运价与关税             |
| `tests/acceptance.test.ts`          | 6    | 验收 B（商业干预）与 D（财务危机）                   |
| `tests/migration.test.ts`           | 5    | 存档 v1→v4 迁移、版本上限拒绝、迁移后哈希失效        |
| `tests/character-model.test.ts`     | 6    | 六维/阵营/信仰/地点、生成规则、v3→v4 迁移            |
| `tests/character-lifecycle.test.ts` | 6    | 婚姻对称、遗产与股份守恒、出生继承、人口学可复现     |

`tests/helpers/index.ts` 提供 `makeWorld(seed)` / `makeEngine(seed)`，所有用例使用固定内容 + 固定种子。

## 发布

`pnpm release` = `pnpm build` + `node scripts/release.mjs`。脚本逐项校验：文件存在且非空、
无 `<script src>` / 外部 `<link href>` / `@import url(http…)` / `url(http…)`、≤ **1,572,864 字节**，
通过后才复制为 `release/index.html`；任何一项失败都不会产生半成品。

- `release/index.html` 是**仓库内可下载的成品**，每个阶段完成、验证通过后更新并提交；CI 用
  `git diff --exit-code -- release/index.html` 校验「提交的产物 == 当前源码构建结果」；
- `dist/` 只是构建缓存，不进仓库；
- 版本对齐 `package.json` 的 `version`，HTML 里写入 `<title>` 与页脚版本号。

## 架构速览

```text
src/core/     世界模拟内核（纯逻辑，不依赖 UI）
src/systems/  角色 / 组织 / 国家 / 经济 / NPC / 军事 六类业务系统（14 个文件）
src/content/  静态内容与数值配置（JSON）+ index.ts 唯一装配器
src/storage/  存档信封、迁移、IndexedDB 槽位、导入导出
src/ui/       原生 DOM 组件 + SVG 地图（M5，当前仅 styles/base.css）
scripts/      sim.ts（快进 CLI）、release.mjs（发布校验）
tests/        5 个回归用例文件 + helpers
release/      仓库内发布的成品单文件
```

五条铁律见 [development-plan.md §4](development-plan.md)：core/systems 不依赖 UI 与存储、单一写入口
`GameEngine.dispatch`、随机唯一来源、遍历按稳定 ID 排序、时间唯一入口 `GameClock`。
