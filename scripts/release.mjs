#!/usr/bin/env node
/**
 * 发布：把 `dist/index.html` 复制成仓库内的 `release/index.html`。
 *
 * `dist/` 是构建目录（.gitignore 忽略），`release/` 是唯一的发布产物目录，
 * 随每次阶段完成一起提交，方便直接从仓库下载双击运行。
 *
 * 同时做三道检查，任何一道不过就失败退出（不产生半成品）：
 * 1. 文件存在且非空；
 * 2. 没有任何外部引用（`<script src>` / `<link href>` / `@import` / `url(http…)`）；
 * 3. 体积不超过 1.5 MiB（发布预算，见开发计划 §1）。
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 1_572_864; // 1.5 MiB

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'dist/index.html');
const targetDir = resolve(root, 'release');
const target = resolve(targetDir, 'index.html');

function fail(message) {
  console.error(`[release] ✗ ${message}`);
  process.exit(1);
}

if (!existsSync(source)) {
  fail('找不到 dist/index.html，请先运行 pnpm build');
}

const html = readFileSync(source, 'utf8');
if (html.trim().length === 0) fail('dist/index.html 是空文件');

const externalPatterns = [
  [/<script[^>]+\bsrc\s*=/i, '外部 <script src>'],
  [/<link[^>]+\bhref\s*=\s*["']https?:/i, '外部 <link href>'],
  [/@import\s+url\(\s*["']?https?:/i, '外部 @import'],
  [/url\(\s*["']?https?:/i, '外部 url(http…)'],
];
for (const [pattern, label] of externalPatterns) {
  if (pattern.test(html)) fail(`产物仍含${label}，违反单文件约束`);
}

const bytes = statSync(source).size;
if (bytes > MAX_BYTES) {
  fail(`产物 ${bytes} 字节，超过预算 ${MAX_BYTES} 字节`);
}

mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);

const budget = ((bytes / MAX_BYTES) * 100).toFixed(1);
console.log(
  `[release] ✓ release/index.html  ${bytes.toLocaleString()} 字节（预算占用 ${budget}%）`,
);
