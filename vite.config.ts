import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  plugins: [viteSingleFile()],
  resolve: {
    alias: {
      '@': srcDir,
    },
  },
  build: {
    target: 'es2022',
    // 单文件发布：图片、字体全部内联，CSS 不拆分
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    // 单文件里没有 modulepreload 链接，关掉 polyfill 让产物零 fetch 字面量
    modulePreload: { polyfill: false },
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    passWithNoTests: true,
    // 多个 100 年模拟用例并行跑会在 2 核 CI 机器上互相拖死（本地 24 核看不出来），
    // 因此测试文件串行执行，并给单例放宽默认 5 s 的上限。
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
