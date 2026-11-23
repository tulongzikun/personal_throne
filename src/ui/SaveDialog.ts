/**
 * 存档对话框：自动槽 + 三个手动槽，列出世界日期、真实保存时间、玩家与哈希。
 *
 * 写入/读取/删除全部走 `storage/SaveManager`，界面只负责展示与二次确认；
 * 删除与覆盖都需要连点两次，避免误触。
 */

import { formatDate } from '../core/GameClock';
import type { WorldState } from '../core/WorldState';
import {
  AUTO_SLOT,
  deleteSlot,
  readSlot,
  storageAvailable,
  writeSlot,
  type SaveEnvelope,
} from '../storage/SaveManager';
import type { NoticeTone } from './context';
import { clear, el, messageOf, trapFocus } from './dom';

interface SaveSlotSpec {
  readonly slot: string;
  readonly label: string;
  readonly note: string;
  readonly auto: boolean;
}

export const SAVE_SLOTS: readonly SaveSlotSpec[] = [
  { slot: AUTO_SLOT, label: '自动存档', note: '每 30 天自动保存', auto: true },
  { slot: 'manual-1', label: '手动槽 1', note: '关键决策前留一份', auto: false },
  { slot: 'manual-2', label: '手动槽 2', note: '', auto: false },
  { slot: 'manual-3', label: '手动槽 3', note: '', auto: false },
];

export interface SaveDialogHooks {
  readonly state: () => WorldState;
  readonly onLoad: (state: WorldState, message: string) => void;
  readonly notify: (message: string, tone?: NoticeTone) => void;
  /** 存档界面打开/关闭：App 用它暂停/恢复时间。 */
  readonly onVisibilityChange?: (visible: boolean) => void;
}

type SlotAction = 'write' | 'delete';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 真实时间的相对描述；不构造 Date，避免与游戏内时间混淆。 */
function relativeAge(savedAt: number): string {
  if (savedAt <= 0) return '时间未知';
  const diff = Math.max(0, Date.now() - savedAt);
  if (diff < MINUTE) return '刚刚';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`;
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)} 天前`;
  return `${Math.floor(diff / (30 * DAY))} 个月前`;
}

export class SaveDialog {
  private readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private readonly body: HTMLElement;
  private readonly warning: HTMLElement;
  private readonly loaded = new Map<string, SaveEnvelope | null>();
  private readonly failed = new Map<string, string>();
  private pending: { readonly slot: string; readonly action: SlotAction } | null = null;
  private pendingTimer: number | null = null;
  private busy = false;
  private opened = false;

  constructor(
    parent: HTMLElement,
    private readonly hooks: SaveDialogHooks,
  ) {
    this.root = el('div', 'modal');
    this.root.hidden = true;
    this.root.setAttribute('aria-hidden', 'true');

    this.card = el('div', 'modal__card modal__card--wide save-dialog__card');
    this.card.tabIndex = -1;
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-modal', 'true');
    this.card.setAttribute('aria-labelledby', 'save-dialog-title');
    this.card.setAttribute('aria-describedby', 'save-dialog-note');

    const head = el('div', 'modal__head');
    const title = el('h2', 'modal__title', '存档管理');
    title.id = 'save-dialog-title';
    head.append(el('span', 'modal__badge', '存档'), title);

    const meta = el(
      'p',
      'modal__meta',
      '浏览器 IndexedDB：自动槽 + 三个手动槽，仅保存在本机；「导出 / 导入」用于跨机器迁移。',
    );

    this.warning = el(
      'p',
      'result result--error save-dialog__warning',
      '此环境不支持 IndexedDB（可能是隐私模式或 file:// 限制），请改用「导出」保存到文件。',
    );
    this.warning.hidden = true;

    this.body = el('div', 'save-dialog__body');

    const foot = el('div', 'save-dialog__foot');
    const note = el(
      'p',
      'panel__note',
      '覆盖或删除需要连点两次确认；清除站点数据会连同存档一起删除。',
    );
    note.id = 'save-dialog-note';
    const close = el('button', 'btn', '关闭');
    close.type = 'button';
    close.setAttribute('aria-label', '关闭存档对话框');
    close.addEventListener('click', () => this.close());
    const actions = el('div', 'save-dialog__foot-actions');
    actions.append(close);
    foot.append(note, actions);

    this.card.append(head, meta, this.warning, this.body, foot);
    this.root.append(this.card);
    this.root.addEventListener('click', (event) => {
      if (event.target === this.root) this.close();
    });
    parent.append(this.root);
    trapFocus(this.root);
  }

  get isOpen(): boolean {
    return this.opened;
  }

  open(): void {
    if (this.opened) return;
    this.opened = true;
    this.pending = null;
    this.card.scrollTop = 0;
    this.root.hidden = false;
    this.root.setAttribute('aria-hidden', 'false');
    this.hooks.onVisibilityChange?.(true);
    window.requestAnimationFrame(() => this.root.classList.add('is-open'));
    this.render();
    this.card.focus({ preventScroll: true });
    void this.load();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.clearPendingTimer();
    this.pending = null;
    this.root.classList.remove('is-open');
    this.root.hidden = true;
    this.root.setAttribute('aria-hidden', 'true');
    this.hooks.onVisibilityChange?.(false);
  }

  private async load(): Promise<void> {
    this.busy = true;
    this.loaded.clear();
    this.failed.clear();
    this.render();
    if (!storageAvailable()) {
      this.busy = false;
      this.render();
      return;
    }
    await Promise.all(
      SAVE_SLOTS.map(async (spec) => {
        try {
          this.loaded.set(spec.slot, await readSlot(spec.slot));
        } catch (error) {
          this.loaded.set(spec.slot, null);
          this.failed.set(spec.slot, messageOf(error));
        }
      }),
    );
    this.busy = false;
    this.render();
  }

  private async run(slot: string, action: SlotAction): Promise<void> {
    const spec = SAVE_SLOTS.find((entry) => entry.slot === slot);
    if (!spec) return;
    this.busy = true;
    this.render();
    try {
      if (action === 'write') {
        await writeSlot(slot, this.hooks.state(), spec.label, Date.now());
        this.hooks.notify(`已写入「${spec.label}」`, 'ok');
      } else {
        await deleteSlot(slot);
        this.hooks.notify(`已删除「${spec.label}」`, 'ok');
      }
    } catch (error) {
      this.hooks.notify(
        `${action === 'write' ? '保存' : '删除'}失败：${messageOf(error)}`,
        'error',
      );
    } finally {
      this.busy = false;
      await this.reloadSlot(slot);
    }
  }

  private async reloadSlot(slot: string): Promise<void> {
    if (!storageAvailable()) {
      this.render();
      return;
    }
    try {
      this.loaded.set(slot, await readSlot(slot));
      this.failed.delete(slot);
    } catch (error) {
      this.loaded.set(slot, null);
      this.failed.set(slot, messageOf(error));
    }
    this.render();
  }

  private loadSlot(spec: SaveSlotSpec): void {
    const envelope = this.loaded.get(spec.slot);
    if (!envelope) return;
    this.close();
    this.hooks.onLoad(envelope.state, `已读取「${spec.label}」（${formatDate(envelope.day)}）`);
  }

  private arm(slot: string, action: SlotAction): void {
    if (this.pending && this.pending.slot === slot && this.pending.action === action) {
      this.pending = null;
      this.clearPendingTimer();
      void this.run(slot, action);
      return;
    }
    this.pending = { slot, action };
    this.clearPendingTimer();
    this.pendingTimer = window.setTimeout(() => {
      this.pending = null;
      this.pendingTimer = null;
      this.render();
    }, 5000);
    this.render();
  }

  private clearPendingTimer(): void {
    if (this.pendingTimer !== null) {
      window.clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  private isArmed(slot: string, action: SlotAction): boolean {
    return this.pending?.slot === slot && this.pending.action === action;
  }

  private render(): void {
    clear(this.body);
    const available = storageAvailable();
    this.warning.hidden = available;

    for (const spec of SAVE_SLOTS) this.body.append(this.slotRow(spec, available));
    if (this.busy) {
      this.body.append(el('p', 'panel__hint save-dialog__busy', '正在与浏览器存档同步…'));
    }
  }

  private slotRow(spec: SaveSlotSpec, available: boolean): HTMLElement {
    const known = this.loaded.has(spec.slot);
    const envelope = this.loaded.get(spec.slot) ?? null;
    const failure = this.failed.get(spec.slot);

    const row = el('section', 'save-slot');
    row.dataset.slot = spec.slot;
    row.dataset.state = !known ? 'loading' : envelope ? 'filled' : failure ? 'error' : 'empty';

    const head = el('div', 'save-slot__head');
    const name = el('div', 'save-slot__name');
    name.append(el('h3', 'save-slot__label', spec.label));
    if (spec.auto) name.append(el('span', 'badge badge--gold', '自动'));
    if (spec.note) name.append(el('span', 'save-slot__note', spec.note));

    const when = el('span', 'save-slot__when');
    if (!known) {
      when.textContent = '读取中…';
    } else if (envelope) {
      when.textContent = `${formatDate(envelope.day)} · ${relativeAge(envelope.savedAt)}`;
    } else {
      when.textContent = failure ? '槽位损坏' : '空槽';
    }
    head.append(name, when);

    const meta = el('p', 'save-slot__meta');
    if (!known) {
      meta.textContent = '正在读取槽位…';
    } else if (envelope) {
      const player = envelope.state.characters[envelope.state.playerId];
      meta.textContent = `玩家 ${player?.name ?? '未知'} · 哈希 #${envelope.hash.slice(0, 10)} · 种子 ${envelope.seed}`;
      if (failure) meta.textContent = `读取失败：${failure}`;
    } else if (failure) {
      meta.textContent = `读取失败：${failure}`;
    } else {
      meta.textContent = '尚未写入 · 保存后在此列出世界日期、玩家与哈希';
    }

    const actions = el('div', 'save-slot__actions');
    const disabled = !available || this.busy || !known;

    const write = el(
      'button',
      `btn btn--small${envelope ? '' : ' btn--gold'}`,
      this.isArmed(spec.slot, 'write') ? '确认覆盖' : envelope ? '覆盖' : '写入',
    );
    write.type = 'button';
    write.dataset.action = 'write';
    write.disabled = disabled;
    write.setAttribute(
      'aria-label',
      `${spec.label}：${this.isArmed(spec.slot, 'write') ? '确认覆盖' : envelope ? '覆盖' : '写入'}`,
    );
    // 空槽直接写入；已占用槽位保留「再点一次确认覆盖」的防误触。
    write.addEventListener('click', () => {
      if (envelope) this.arm(spec.slot, 'write');
      else void this.run(spec.slot, 'write');
    });
    if (this.isArmed(spec.slot, 'write')) write.classList.add('is-armed');

    const read = el('button', 'btn btn--small', '读取');
    read.type = 'button';
    read.dataset.action = 'read';
    read.disabled = disabled || !envelope;
    read.setAttribute('aria-label', `${spec.label}：读取`);
    read.addEventListener('click', () => this.loadSlot(spec));

    const remove = el(
      'button',
      'btn btn--small btn--danger',
      this.isArmed(spec.slot, 'delete') ? '确认删除' : '删除',
    );
    remove.type = 'button';
    remove.dataset.action = 'delete';
    remove.disabled = disabled || !envelope;
    remove.setAttribute(
      'aria-label',
      `${spec.label}：${this.isArmed(spec.slot, 'delete') ? '确认删除' : '删除'}`,
    );
    remove.addEventListener('click', () => this.arm(spec.slot, 'delete'));
    if (this.isArmed(spec.slot, 'delete')) remove.classList.add('is-armed');

    actions.append(write, read, remove);
    row.append(head, meta, actions);

    if (this.pending?.slot === spec.slot) {
      row.append(el('p', 'save-slot__confirm', '再次点击同一按钮确认，5 秒后自动取消。'));
    }
    return row;
  }
}
