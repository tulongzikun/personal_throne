/* 存档辅助：自动存档节流、导出、导入文件。 */

import { formatDate } from '../../core/GameClock';
import type { WorldState } from '../../core/WorldState';
import { AUTO_SLOT, downloadSave, readSaveFile, writeSlot } from '../../storage/SaveManager';
import type { NoticeTone } from '../context';
import { messageOf } from '../dom';

export interface AutoSaveState {
  lastDay: number;
  busy: boolean;
}

/** 每 30 天写一次自动存档；失败只提示一次，不阻塞推进。 */
export function maybeAutoSave(
  state: WorldState,
  tracker: AutoSaveState,
  notify: (message: string, tone?: NoticeTone) => void,
): void {
  const day = state.clock.day;
  if (tracker.busy || day - tracker.lastDay < 30) return;
  tracker.lastDay = day;
  tracker.busy = true;
  void writeSlot(AUTO_SLOT, state, '自动存档', Date.now())
    .then(() => {
      tracker.busy = false;
    })
    .catch((error: unknown) => {
      tracker.busy = false;
      notify(`自动存档失败：${messageOf(error)}`, 'error');
    });
}

export function exportGame(
  state: WorldState,
  notify: (message: string, tone?: NoticeTone) => void,
): void {
  try {
    downloadSave(state, 'throne-and-gold-save.json');
    notify('已导出存档文件', 'ok');
  } catch (error) {
    notify(`导出失败：${messageOf(error)}`, 'error');
  }
}

export async function importFile(
  file: File,
  adopt: (state: WorldState, message: string) => void,
  notify: (message: string, tone?: NoticeTone) => void,
): Promise<void> {
  try {
    const envelope = await readSaveFile(file);
    adopt(envelope.state, `已导入存档（${formatDate(envelope.day)}）`);
  } catch (error) {
    notify(`导入失败：${messageOf(error)}`, 'error');
  }
}
