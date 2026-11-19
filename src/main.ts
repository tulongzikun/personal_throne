import './ui/styles/base.css';

import { GameEngine } from './core/GameEngine';
import { createWorld, type WorldState } from './core/WorldState';
import { content } from './content';
import { AUTO_SLOT, readSlot, storageAvailable } from './storage/SaveManager';
import { App } from './ui/App';

/** 新世界的固定种子：同一版本下可复现，方便对照调试。 */
const FIXED_SEED = 'throne-and-gold';

interface InitialWorld {
  readonly state: WorldState;
  readonly restored: boolean;
}

async function initialState(): Promise<InitialWorld> {
  if (storageAvailable()) {
    try {
      const envelope = await readSlot(AUTO_SLOT);
      if (envelope) return { state: envelope.state, restored: true };
    } catch {
      // 首次启动、隐私模式或 file:// 禁用 IndexedDB 时退回新世界。
    }
  }
  return { state: createWorld(content, { seed: FIXED_SEED }), restored: false };
}

async function main(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('挂载点 #app 不存在');

  const { state, restored } = await initialState();
  const app = new App(root, new GameEngine(state, content));
  app.start(restored ? '已载入浏览器存档' : `新世界已铸成 · 种子 ${FIXED_SEED}`);
}

void main().catch((error: unknown) => {
  console.error(error);
  const root = document.getElementById('app');
  if (root) {
    root.innerHTML =
      '<main class="boot"><h1>王座与黄金</h1><p>世界生成失败</p><p class="boot__hint"></p></main>';
    const hint = root.querySelector('.boot__hint');
    if (hint) hint.textContent = error instanceof Error ? error.message : String(error);
  }
});
