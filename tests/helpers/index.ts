import { content } from '../../src/content/index';
import { GameEngine } from '../../src/core/GameEngine';
import { createWorld, type WorldState } from '../../src/core/WorldState';

export { content };

/** 固定内容 + 固定种子的世界，供测试复用。 */
export function makeWorld(seed = 'test-seed'): WorldState {
  return createWorld(content, { seed, createdAt: 0 });
}

export function makeEngine(
  seed = 'test-seed',
  options: { stopAtChoices?: boolean } = {},
): GameEngine {
  return new GameEngine(makeWorld(seed), content, options);
}
