/* 顶栏与图例：品牌、读数、待决事项、☰ 菜单、toast 容器。 */

import type { WorldState } from '../../core/WorldState';
import { countryPalette } from '../MapView';
import { button, el } from '../dom';
import type { TopbarRefs } from './appTypes';

/** 顶栏要回调外壳的地方，避免把整个 App 传进来。 */
export interface TopbarHost {
  openSave(): void;
  reopenChoices(): void;
  restartTour(): void;
  openHelp(): void;
  openDebug(): void;
  exportGame(): void;
  openCreator(): void;
  importFile(file: File): void;
}

export interface TopbarBuild {
  readonly refs: TopbarRefs;
  readonly pending: HTMLButtonElement;
  readonly menu: HTMLElement;
}

export function buildTopbar(shell: HTMLElement, host: TopbarHost): TopbarBuild {
  const header = el('header', 'topbar');
  const brand = el('div', 'brand');
  brand.append(el('span', 'brand__crown', '♛'), el('span', 'brand__name', '王座与黄金'));
  header.append(brand);

  const date = el('span', 'topbar__value topbar__value--date');
  date.dataset.day = '';
  const cash = el('span', 'topbar__value topbar__value--cash');
  const cashDelta = el('span', 'topbar__delta');
  const health = el('span', 'topbar__value');
  const healthDelta = el('span', 'topbar__delta');
  const daysLeft = el('span', 'topbar__value');
  const speed = el('span', 'topbar__value');

  header.append(
    topbarStat('日期', date),
    topbarStat('现金', cash, cashDelta),
    topbarStat('健康', health, healthDelta),
    topbarStat('本月剩', daysLeft),
    topbarStat('速度', speed),
  );

  const actions = el('div', 'topbar__actions');
  const importInput = el('input', 'sr-only');
  importInput.type = 'file';
  importInput.accept = '.json,application/json';
  importInput.setAttribute('aria-label', '导入存档文件');
  importInput.addEventListener('change', () => {
    const file = importInput.files?.item(0);
    if (file) host.importFile(file);
    importInput.value = '';
  });

  const pending = button('待决抉择', () => host.reopenChoices(), 'small');
  pending.hidden = true;
  pending.title = '你还没决定的抉择；点开可以继续处理';
  pending.dataset.tour = 'pending';

  const menuButton = button('☰', () => toggleMenu(), 'small');
  menuButton.classList.add('topbar__menu-btn');
  menuButton.setAttribute('aria-label', '菜单：存档、新开一局、帮助');
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-controls', 'topbar-menu');

  const menu = el('div', 'topbar__menu');
  menu.id = 'topbar-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', '游戏菜单');

  const items: readonly (readonly [string, string, () => void])[] = [
    ['存档管理', '', () => host.openSave()],
    ['导出存档', '', () => host.exportGame()],
    ['导入存档', '', () => importInput.click()],
    ['新开一局', '', () => host.openCreator()],
    ['帮助', '?', () => host.openHelp()],
    ['调试信息', '', () => host.openDebug()],
  ];
  for (const [label, kbd, action] of items) {
    const item = el('button', 'topbar__menu-item', label);
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    if (kbd !== '') item.append(el('kbd', 'kbd', kbd));
    item.addEventListener('click', () => {
      closeMenu();
      action();
    });
    menu.append(item);
  }

  const toggleMenu = (): void => {
    const open = menu.hidden;
    menu.hidden = !open;
    menuButton.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector<HTMLButtonElement>('button')?.focus();
  };
  const closeMenu = (): void => {
    if (menu.hidden) return;
    menu.hidden = true;
    menuButton.setAttribute('aria-expanded', 'false');
  };
  menuCloser = closeMenu;

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Node ? event.target : null;
    if (target === null || header.contains(target)) return;
    closeMenu();
  });

  actions.append(pending, menuButton, importInput);
  header.append(actions, menu);

  const toast = el('div', 'toast');
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  header.append(toast);

  shell.append(header);
  return {
    refs: { date, cash, cashDelta, health, healthDelta, daysLeft, speed, toast },
    pending,
    menu,
  };
}

/** 当前打开的菜单关闭器：Esc 由外壳调用。 */
let menuCloser: (() => void) | null = null;

export function closeTopbarMenu(): boolean {
  if (menuCloser === null) return false;
  const had = menuCloser;
  had();
  return true;
}

export function topbarStat(label: string, value: HTMLElement, delta?: HTMLElement): HTMLElement {
  const node = el('div', 'topbar__stat');
  const line = el('span', 'topbar__line');
  line.append(value);
  if (delta) line.append(delta);
  node.append(el('span', 'topbar__label', label), line);
  return node;
}

export function buildLegend(state: WorldState): HTMLElement {
  const legend = el('ul', 'legend');
  const palette = countryPalette(state);
  for (const country of Object.values(state.countries).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const item = el('li', 'legend__item');
    const dot = el('span', 'legend__dot');
    dot.style.background = palette.get(country.id) ?? '#d9b45b';
    item.append(dot, el('span', 'legend__label', country.name));
    legend.append(item);
  }
  legend.append(el('li', 'legend__hint', '地区轮廓 = 地形 · 连线粗细 = 运力 · 箭头 = 货流方向'));
  return legend;
}
