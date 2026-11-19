import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.tools/**', '.tmp/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        indexedDB: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        requestAnimationFrame: 'readonly',
      },
    },
  },
  {
    // 架构铁律：core 与 systems 不得依赖 UI / 存储
    files: ['src/core/**/*.ts', 'src/systems/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/ui/*', '@/storage/*', '**/ui/*', '**/storage/*'],
              message: '核心模拟层不得依赖界面或存档层，请通过 GameEngine 暴露的能力反向注入。',
            },
          ],
        },
      ],
    },
  },
  {
    // 可复现性铁律：随机与时间必须走 core/Random 与 core/GameClock
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message: '禁止 Math.random，随机数必须来自 core/Random 的命名流。',
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message: '游戏内时间只能来自 core/GameClock；真实时间戳请集中在 storage 层并显式豁免。',
        },
      ],
    },
  },
  prettier,
);
