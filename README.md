# personal_throne

《王座与黄金》（Throne & Gold）——单机奇幻角色扮演 / 经营策略 / 动态世界模拟。

## 文档

- 玩法与世界观：[design.md](design.md)（GDD v1.0）
- 工程计划与排期：[development-plan.md](development-plan.md)

## 当前状态

M0「工程基线」已完成（v0.1.0）：TypeScript 严格模式、单文件构建、ESLint 架构约束、
Vitest 与 GitHub Actions CI 均已就绪，`dist/index.html` 为唯一发布物（当前 3 KB 骨架）。

M1「模拟核心」进行中，对应 `src/core` 与 `tests/{fastforward,simulation}.test.ts`。

## 环境要求

- Node.js ≥ 22
- pnpm 11（`corepack enable pnpm` 或 `npm i -g pnpm`）

## 命令

```bash
pnpm install        # 安装依赖
pnpm dev            # 本地开发（Vite HMR）
pnpm build          # 类型检查 + 产出单文件 dist/index.html
pnpm preview        # 预览构建产物
pnpm typecheck      # 仅类型检查
pnpm lint           # ESLint（含架构依赖方向与 Math.random 禁令）
pnpm test           # 单元测试与确定性回归
pnpm test:watch     # 监听模式
pnpm sim            # 无界面快进仿真（tests/simulation.test.ts）
pnpm format         # Prettier
```

## 发布

`pnpm build` 生成 `dist/index.html`，所有 JS/CSS/图片内联为单文件，离线双击即可游玩，
体积预算 ≤ 1.5 MiB（CI 会校验）。

## 架构速览

```text
src/core/     世界模拟内核（纯逻辑，不依赖 UI）
src/systems/  角色 / 组织 / 国家 / 经济 / NPC / 军事 六类业务系统
src/content/  静态内容与数值配置（JSON）
src/ui/       原生 DOM 组件 + SVG 地图
src/storage/  存档、迁移与回放
```

五条铁律见 [development-plan.md §4](development-plan.md)：core 不依赖 UI、单一写入口
`GameEngine.dispatch`、随机唯一来源、遍历按稳定 ID 排序、时间唯一入口 `GameClock`。
