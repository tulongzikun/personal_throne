# personal_throne

《王座与黄金》（Throne & Gold）——单机奇幻角色扮演 / 经营策略 / 动态世界模拟。

## 文档

- 玩法与世界观：[design.md](design.md)（GDD v1.0）
- 工程计划与排期：[development-plan.md](development-plan.md)（v0.2，含 §5.2 实现偏差记录与 §8.1 当前进度）

## 当前状态

**M0 工程基线：完成（v0.1.0）。** TypeScript 严格模式、单文件构建、ESLint 架构约束、
Vitest 与 GitHub Actions CI 均已就绪；`release/index.html` 已入仓，当前 2,730 字节（体积预算占用 0.17%）。

**M1 模拟核心：完成（v0.1.0）。** 已落地：

- `src/core/` 8 个模块：`WorldState` / `GameClock` / `Random` / `CommandBus` / `EventEngine` / `History` / `SimulationTier` / `GameEngine`；
- `src/systems/` 14 个文件（角色 3、组织 4、国家 2、经济 3、NPC 1、军事 1），均已接入月度结算；
- 内容装配：2 国、5 区、20 人、10 组织、4 商品、**14 条事件**（组织 4 / 国家 4 / 经济 3 / 冒险 3）；
- 存档：信封 + 哈希校验 + IndexedDB 槽位 + 文件导入导出（`SaveManager` / `Migration`）；
- 开发期 CLI `pnpm sim` 与 5 个测试文件 / 34 个用例；`pnpm sim --years 100 --seed demo --check` 实测 1.3 s、哈希稳定。

**尚未完成**：`src/ui/` 只有 `styles/base.css`，`src/main.ts` 仍是引导页；人口世代更替未实现（100 年后 20 位 NPC 全部死亡）；
M2–M4 只有代码骨架，验收 A–E 均未达成。详见 [development-plan.md §8.1](development-plan.md)。

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
pnpm test           # vitest run：5 个文件 / 33 个用例
pnpm test:watch     # 监听模式
pnpm format         # Prettier
pnpm sim --years 100 --seed demo-seed            # 无界面快进，打印哈希 / 耗时 / 实体统计
pnpm sim --years 100 --seed demo-seed --check    # 复跑并比对状态哈希，不一致则退出码 1
```

`pnpm sim` 由 `tsx` 直接执行 `scripts/sim.ts`（开发期依赖，不进产物）；默认 `--years 100 --seed demo-seed`。

## 测试

| 文件                         | 用例 | 覆盖                                           |
| ---------------------------- | ---- | ---------------------------------------------- |
| `tests/simulation.test.ts`   | 6    | R1 确定性/状态哈希、世界规模、100 年稳定性     |
| `tests/fastforward.test.ts`  | 4    | R2 快进等价性、R3 存档往返与损坏拒绝           |
| `tests/organization.test.ts` | 8    | R4/R7 会计恒等式、投资与权限、领袖与统治者继承 |
| `tests/country.test.ts`      | 7    | R5 预算恒等式、政策三阶段、游说命令            |
| `tests/events.test.ts`       | 8    | R6 互斥竞速、冷却、效果夹取、后续事件          |

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
