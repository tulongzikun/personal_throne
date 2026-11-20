/* 全局快捷键与按钮可访问名：Esc 关弹窗、空格暂停、1234 切速度、? 看引导。 */

import { KEY_SPEEDS, type Speed } from './appTypes';

export interface ShortcutHost {
  readonly shell: HTMLElement;
  /** Esc：按优先级关掉存档 / 引导，返回是否已处理。 */
  closeOverlay(): boolean;
  restartTour(): void;
  togglePause(): void;
  setSpeed(speed: Speed): void;
}

const observed = new WeakSet<HTMLElement>();

function isTyping(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  return (
    element !== null &&
    (element.isContentEditable ||
      element.tagName === 'INPUT' ||
      element.tagName === 'TEXTAREA' ||
      element.tagName === 'SELECT')
  );
}

/** 给没有显式 aria-label 的纯文字按钮补上可访问名（面板与对话框会动态重绘）。 */
export function labelButtons(shell: HTMLElement): void {
  for (const node of shell.querySelectorAll('button:not([aria-label])')) {
    const text = (node.textContent ?? '').trim();
    if (text.length > 0) node.setAttribute('aria-label', text);
  }
}

/** 监听整棵外壳的 DOM 变动，重绘后自动补 aria-label（同一元素只装一次观察器）。 */
export function observeButtons(shell: HTMLElement): void {
  if (observed.has(shell)) return;
  observed.add(shell);
  let scheduled = 0;
  const observer = new MutationObserver(() => {
    if (scheduled !== 0) return;
    scheduled = window.requestAnimationFrame(() => {
      scheduled = 0;
      labelButtons(shell);
    });
  });
  observer.observe(shell, { childList: true, subtree: true });
}

/**
 * 全局快捷键在捕获阶段处理：Esc 优先关存档/引导并截断事件，
 * 避免和事件弹窗自己的 Esc 监听互相抢焦点。
 */
export function installShortcuts(host: ShortcutHost): (event: KeyboardEvent) => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    const element = event.target instanceof HTMLElement ? event.target : null;

    if (event.key === 'Escape') {
      if (host.closeOverlay()) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;

    if (event.key === '?') {
      event.preventDefault();
      event.stopPropagation();
      host.restartTour();
      return;
    }

    if (event.key === ' ' || event.key === 'Spacebar') {
      const interactive =
        element !== null &&
        (element.tagName === 'BUTTON' ||
          element.tagName === 'A' ||
          element.getAttribute('role') === 'button');
      if (interactive) return;
      event.preventDefault();
      host.togglePause();
      return;
    }

    const shortcut = KEY_SPEEDS[event.key];
    if (shortcut !== undefined) {
      event.preventDefault();
      host.setSpeed(shortcut);
    }
  };
  document.addEventListener('keydown', onKeyDown, true);
  return onKeyDown;
}
