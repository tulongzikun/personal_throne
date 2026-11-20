/**
 * 界面层与外壳之间的最小契约。
 *
 * 面板不持有 `GameEngine` 引用，只通过 `UiDeps` 读取快照、提交命令；
 * 这样读档替换引擎后，所有面板会自动读取新状态，无需重建 DOM。
 */

import type { Command, CommandResult } from '../core/CommandBus';
import type { WorldContent, WorldState } from '../core/WorldState';

export type NoticeTone = 'info' | 'ok' | 'error';

export interface UiDeps {
  /** 当前权威状态（只读使用，禁止直接修改）。 */
  state(): WorldState;
  content(): WorldContent;
  /** 唯一写入口，内部会调用 GameEngine.dispatch。 */
  dispatch(command: Command): CommandResult;
  /** 推进若干天（移动等带在途时间的命令用）。 */
  advanceDays(days: number): void;
  /** 请求外壳刷新（顶栏、地图、当前面板）。 */
  refresh(): void;
  notify(message: string, tone?: NoticeTone): void;
  openRegion(regionId: string): void;
  openOrganization(orgId: string): void;
  openCharacter(characterId: string): void;
}
