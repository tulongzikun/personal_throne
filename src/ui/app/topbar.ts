/* 顶栏与图例：品牌、五个读数、动作按钮、toast 容器。 */

import type { WorldState } from '../../core/WorldState';
import { countryPalette } from '../MapView';
import { button, el } from '../dom';
import type { TopbarRefs } from './appTypes';

/** 顶栏要回调外壳的地方，避免把整个 App 传进来。 */
export interface TopbarHost {
  openSave(): void;
  reopenChoices(): void;
  restartTour(): void;
  exportGame(): void;
  openCreator(): void;
  importFile(file: File): void;
}

export interface TopbarBuild {
  readonly refs: TopbarRefs;
  readonly pending: HTMLButtonElement;
}

export function buildTopbar(shell: HTMLElement, host: TopbarHost): TopbarBuild {
  const header = el('header', 'topbar');
  const brand = el('div', 'brand');
  brand.append(el('span', 'brand__crown', '♛'), el('span', 'brand__name', '王座与黄金'));
  header.append(brand);

  const date = el('span', 'topbar__value topbar__value--date');
  date.dataset.day = '';
  const player = el('span', 'topbar__value');
  const cash = el('span', 'topbar__value topbar__value--cash');
  const speed = el('span', 'topbar__value');
  const hash = el('span', 'topbar__value topbar__value--mono');

  header.append(
    topbarStat('日期', date),
    topbarStat('玩家', player),
    topbarStat('现金', cash),
    topbarStat('速度', speed),
    topbarStat('哈希', hash),
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
  const saveButton = button('存档', () => host.openSave(), 'small');
  saveButton.dataset.tour = 'save';
  saveButton.title = '存档管理（自动槽 + 三个手动槽）';
  const pending = button('待决抉择', () => host.reopenChoices(), 'small');
  pending.hidden = true;
  pending.title = '你还没决定的抉择；点开可以继续处理';
  pending.dataset.tour = 'pending';
  const helpButton = button('?', () => host.restartTour(), 'small');
  helpButton.title = '重新查看新手引导（快捷键 ?）';
  helpButton.setAttribute('aria-label', '打开新手引导');
  helpButton.classList.add('topbar__help');
  actions.append(
    pending,
    saveButton,
    button('导出', () => host.exportGame(), 'small'),
    button('创建人物', () => host.openCreator(), 'small'),
    button('导入', () => importInput.click(), 'small'),
    helpButton,
    importInput,
  );
  header.append(actions);

  const toast = el('div', 'toast');
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  header.append(toast);

  shell.append(header);
  return { refs: { date, player, cash, speed, hash, toast }, pending };
}

function topbarStat(label: string, value: HTMLElement): HTMLElement {
  const node = el('div', 'topbar__stat');
  node.append(el('span', 'topbar__label', label), value);
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
