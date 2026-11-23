/* 时间条：速度分段按钮 + 跳到下一事件 + 快捷键提示。 */

import { button, el } from '../dom';
import { SPEED_KEYS, type Speed, type TimebarRefs } from './appTypes';

export interface TimebarHost {
  setSpeed(speed: Speed): void;
  jumpToNextEvent(): void;
}

export function buildTimebar(
  shell: HTMLElement,
  host: TimebarHost,
  speedButtons: Map<Speed, HTMLButtonElement>,
): TimebarRefs {
  const timebar = el('footer', 'timebar');
  const segmented = el('div', 'segmented');
  segmented.setAttribute('role', 'group');
  segmented.setAttribute('aria-label', '时间速度');
  segmented.dataset.tour = 'speed';
  for (const speed of [0, 1, 7, 30] as const) {
    const node = el('button', 'segmented__btn', speed === 0 ? '暂停' : `${speed}×`);
    node.type = 'button';
    node.setAttribute(
      'aria-label',
      speed === 0 ? '暂停时间（快捷键 4）' : `速度 ${speed}×（快捷键 ${SPEED_KEYS[speed]}）`,
    );
    node.title =
      speed === 0
        ? '暂停 / 继续（空格，或数字键 4）'
        : `${speed}× 速度（数字键 ${SPEED_KEYS[speed]}）`;
    if (speed === 0) node.classList.add('is-active');
    // 角标：键盘按得动的按钮就把键位写在上面（空格暂停另有提示，不重复角标）。
    node.append(el('kbd', 'kbd segmented__kbd', speed === 0 ? '4' : SPEED_KEYS[speed]));
    node.addEventListener('click', () => host.setSpeed(speed));
    speedButtons.set(speed, node);
    segmented.append(node);
  }

  const jump = button('跳到下一事件', () => host.jumpToNextEvent(), 'ghost');
  jump.classList.add('timebar__jump');

  const hint = el('span', 'timebar__hint');
  hint.title = '空格暂停 / 继续 · 1 2 3 切速度 · 4 暂停 · ? 看引导 · Esc 关闭弹窗';
  const saveHint = el('span', 'timebar__hint timebar__hint--right', '存档仅写入本地浏览器');
  timebar.append(segmented, jump, hint, saveHint);
  shell.append(timebar);
  return { element: timebar, hint };
}
