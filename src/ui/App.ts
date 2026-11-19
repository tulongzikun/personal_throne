/**
 * 单页外壳：顶栏 + 地图 + 标签面板 + 时间控制。
 *
 * 只读 `GameEngine.state`，所有写入都经由 `deps.dispatch`（唯一写入口）。
 * 时间推进使用 `setInterval` 分片，每次 tick 最多推进 3 天，避免阻塞输入。
 */

import { describeCommand, type Command, type CommandResult } from '../core/CommandBus';
import { formatDate, nextBoundary, Phase, toDateParts } from '../core/GameClock';
import { GameEngine } from '../core/GameEngine';
import type { ScheduledEvent, WorldState } from '../core/WorldState';
import {
  AUTO_SLOT,
  downloadSave,
  readSaveFile,
  readSlot,
  storageAvailable,
  writeSlot,
} from '../storage/SaveManager';
import { CharacterPanel } from './CharacterPanel';
import type { NoticeTone, UiDeps } from './context';
import { CountryPanel } from './CountryPanel';
import { EventDialog, type WorldSignal } from './EventDialog';
import { HistoryPanel } from './HistoryPanel';
import { MapView, countryPalette } from './MapView';
import { OrganizationPanel } from './OrganizationPanel';
import { PlayerPanel } from './PlayerPanel';
import { RegionPanel } from './RegionPanel';
import { button, el, fmtMoney, messageOf } from './dom';

type TabId = 'region' | 'character' | 'organization' | 'country' | 'history';
type Speed = 0 | 1 | 7 | 30;

const TABS: readonly { readonly id: TabId; readonly label: string }[] = [
  { id: 'region', label: '地区' },
  { id: 'character', label: '人物' },
  { id: 'organization', label: '组织' },
  { id: 'country', label: '国家' },
  { id: 'history', label: '历史' },
];

const SPEED_CONFIG: Record<1 | 7 | 30, { readonly interval: number; readonly days: number }> = {
  1: { interval: 1000, days: 1 },
  7: { interval: 250, days: 1 },
  30: { interval: 100, days: 3 },
};

interface TopbarRefs {
  readonly date: HTMLElement;
  readonly player: HTMLElement;
  readonly cash: HTMLElement;
  readonly speed: HTMLElement;
  readonly hash: HTMLElement;
  readonly toast: HTMLElement;
}

interface TimebarRefs {
  readonly element: HTMLElement;
  readonly hint: HTMLElement;
}

function signalKey(event: ScheduledEvent): string {
  return `${event.day}:${event.seq}:${event.refId}`;
}

export class App {
  private engine: GameEngine;
  private readonly root: HTMLElement;
  private readonly shell: HTMLElement;
  private readonly deps: UiDeps;
  private readonly topbar: TopbarRefs;
  private readonly timeHint: HTMLElement;
  private readonly playerPanel: PlayerPanel;
  private readonly mapView: MapView;
  private readonly regionPanel: RegionPanel;
  private readonly characterPanel: CharacterPanel;
  private readonly organizationPanel: OrganizationPanel;
  private readonly countryPanel: CountryPanel;
  private readonly historyPanel: HistoryPanel;
  private readonly eventDialog: EventDialog;
  private readonly tabs = new Map<TabId, HTMLButtonElement>();
  private readonly sections = new Map<TabId, HTMLElement>();
  private readonly speedButtons = new Map<Speed, HTMLButtonElement>();

  private activeTab: TabId = 'region';
  private selectedRegionId: string | null = null;
  private speed: Speed = 0;
  private timer: number | null = null;
  private toastTimer: number | null = null;
  private lastHistoryId = 0;
  private seenPending = new Set<string>();
  private lastHashDay = 0;

  constructor(root: HTMLElement, engine: GameEngine) {
    this.root = root;
    this.engine = engine;
    this.root.replaceChildren();

    this.shell = el('div', 'app');
    this.topbar = this.buildTopbar(this.shell);

    const workspace = el('main', 'workspace');
    const playerRail = el('aside', 'player-rail');
    playerRail.dataset.panel = 'player';
    playerRail.setAttribute('aria-label', '玩家概览');
    const mapSection = el('section', 'panel map-panel');
    mapSection.dataset.panel = 'map';
    const mapHead = el('div', 'panel__head');
    mapHead.append(
      el('h2', 'panel__title', '世界地图'),
      el('p', 'panel__subtitle', '点击地区查看市场，虚线为可通商路线'),
    );
    const mapHost = el('div', 'map-canvas');
    mapSection.append(mapHead, mapHost);
    mapSection.append(this.buildLegend(engine.state));

    const inspector = el('aside', 'inspector');
    const tabbar = el('nav', 'tabs');
    tabbar.setAttribute('role', 'tablist');
    tabbar.setAttribute('aria-label', '世界面板');
    for (const tab of TABS) {
      const node = el('button', 'tab', tab.label);
      node.type = 'button';
      node.setAttribute('role', 'tab');
      node.setAttribute('aria-selected', String(tab.id === this.activeTab));
      if (tab.id === this.activeTab) node.classList.add('is-active');
      node.addEventListener('click', () => this.switchTab(tab.id));
      this.tabs.set(tab.id, node);
      tabbar.append(node);
    }
    const panels = el('div', 'panels');
    for (const tab of TABS) {
      const section = el('section', 'panel');
      section.dataset.panel = tab.id;
      section.setAttribute('role', 'tabpanel');
      section.hidden = tab.id !== this.activeTab;
      this.sections.set(tab.id, section);
      panels.append(section);
    }
    inspector.append(tabbar, panels);
    workspace.append(playerRail, mapSection, inspector);
    this.shell.append(workspace);

    this.mapView = new MapView(mapHost, engine.state, (regionId) => this.openRegion(regionId));
    this.deps = {
      state: () => this.engine.state,
      content: () => this.engine.content,
      dispatch: (command) => this.dispatch(command),
      refresh: () => this.refresh(),
      notify: (message, tone) => this.notify(message, tone),
      openRegion: (regionId) => this.openRegion(regionId),
      openOrganization: (orgId) => this.openOrganization(orgId),
      openCharacter: (characterId) => this.openCharacter(characterId),
    };
    this.playerPanel = new PlayerPanel(playerRail, this.deps);
    this.regionPanel = new RegionPanel(this.sectionOf('region'), this.deps);
    this.characterPanel = new CharacterPanel(this.sectionOf('character'), this.deps);
    this.organizationPanel = new OrganizationPanel(this.sectionOf('organization'), this.deps);
    this.countryPanel = new CountryPanel(this.sectionOf('country'), this.deps);
    this.historyPanel = new HistoryPanel(this.sectionOf('history'), this.deps);

    const timebar = this.buildTimebar(this.shell);
    this.timeHint = timebar.hint;
    this.shell.append(timebar.element);

    this.eventDialog = new EventDialog(this.shell);
    this.root.append(this.shell);
  }

  start(message?: string): void {
    const state = this.engine.state;
    const player = state.characters[state.playerId];
    this.selectedRegionId = player?.regionId ?? Object.keys(state.regions).sort()[0] ?? null;
    if (this.selectedRegionId) {
      this.regionPanel.show(this.selectedRegionId);
      this.mapView.select(this.selectedRegionId);
    }
    if (player?.organizationId) this.organizationPanel.select(player.organizationId);

    this.characterPanel.update();
    this.countryPanel.update();
    this.historyPanel.update();

    this.lastHistoryId = state.history.at(-1)?.id ?? 0;
    this.seenPending = new Set(state.pendingEvents.map(signalKey));
    this.lastHashDay = 0;

    this.switchTab('region');
    this.refresh(true);
    if (message) this.notify(message, 'ok');
  }

  /* ------------------------------------------------------------------ */
  /* 顶栏与时间控制                                                       */
  /* ------------------------------------------------------------------ */

  private buildTopbar(shell: HTMLElement): TopbarRefs {
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
      this.topbarStat('日期', date),
      this.topbarStat('玩家', player),
      this.topbarStat('现金', cash),
      this.topbarStat('速度', speed),
      this.topbarStat('哈希', hash),
    );

    const actions = el('div', 'topbar__actions');
    const importInput = el('input', 'sr-only');
    importInput.type = 'file';
    importInput.accept = '.json,application/json';
    importInput.setAttribute('aria-label', '导入存档文件');
    importInput.addEventListener('change', () => {
      const file = importInput.files?.item(0);
      if (file) void this.importFile(file);
      importInput.value = '';
    });
    actions.append(
      button('保存', () => void this.saveGame(), 'small'),
      button('读取', () => void this.loadGame(), 'small'),
      button('导出', () => this.exportGame(), 'small'),
      button('导入', () => importInput.click(), 'small'),
      importInput,
    );
    header.append(actions);

    const toast = el('div', 'toast');
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    header.append(toast);

    shell.append(header);
    return { date, player, cash, speed, hash, toast };
  }

  private topbarStat(label: string, value: HTMLElement): HTMLElement {
    const node = el('div', 'topbar__stat');
    node.append(el('span', 'topbar__label', label), value);
    return node;
  }

  private buildLegend(state: WorldState): HTMLElement {
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
    legend.append(el('li', 'legend__hint', '虚线 = 商路 · 圆点大小 = 人口'));
    return legend;
  }

  private buildTimebar(shell: HTMLElement): TimebarRefs {
    const timebar = el('footer', 'timebar');
    const segmented = el('div', 'segmented');
    segmented.setAttribute('role', 'group');
    segmented.setAttribute('aria-label', '时间速度');
    for (const speed of [0, 1, 7, 30] as const) {
      const node = el('button', 'segmented__btn', speed === 0 ? '暂停' : `${speed}×`);
      node.type = 'button';
      if (speed === 0) node.classList.add('is-active');
      node.addEventListener('click', () => this.setSpeed(speed));
      this.speedButtons.set(speed, node);
      segmented.append(node);
    }

    const jump = button('跳到下一事件', () => this.jumpToNextEvent(), 'ghost');
    jump.classList.add('timebar__jump');

    const hint = el('span', 'timebar__hint');
    const saveHint = el('span', 'timebar__hint timebar__hint--right', '存档仅写入本地浏览器');
    timebar.append(segmented, jump, hint, saveHint);
    shell.append(timebar);
    return { element: timebar, hint };
  }

  /* ------------------------------------------------------------------ */
  /* 状态刷新                                                             */
  /* ------------------------------------------------------------------ */

  private refresh(forceHash = false): void {
    const state = this.engine.state;
    const parts = toDateParts(state.clock.day);
    this.topbar.date.textContent = `第 ${parts.year} 年 ${parts.month} 月 ${parts.dayOfMonth} 日`;
    const player = state.characters[state.playerId];
    this.topbar.player.textContent = player?.name ?? '未知';
    this.topbar.cash.textContent = player ? fmtMoney(player.wealth) : '—';
    this.topbar.speed.textContent = this.speed === 0 ? '暂停' : `${this.speed}×`;

    if (
      forceHash ||
      state.clock.day < this.lastHashDay ||
      state.clock.day - this.lastHashDay >= 30
    ) {
      const hash = this.engine.hash();
      this.topbar.hash.textContent = `#${hash.slice(0, 12)}`;
      this.topbar.hash.title = `状态哈希 ${hash}`;
      this.lastHashDay = state.clock.day;
    }

    this.mapView.update(state);
    this.playerPanel.update();
    this.panelFor(this.activeTab).update();
    this.timeHint.textContent = `第 ${state.clock.day} 天 · 每周市场 / 每月组织·国家·事件 / 每年人口`;
    for (const [speed, node] of this.speedButtons) {
      node.classList.toggle('is-active', speed === this.speed);
    }
  }

  private panelFor(tab: TabId): { update(): void } {
    switch (tab) {
      case 'region':
        return this.regionPanel;
      case 'character':
        return this.characterPanel;
      case 'organization':
        return this.organizationPanel;
      case 'country':
        return this.countryPanel;
      case 'history':
        return this.historyPanel;
    }
  }

  private sectionOf(tab: TabId): HTMLElement {
    const section = this.sections.get(tab);
    if (!section) throw new Error(`面板 ${tab} 未创建`);
    return section;
  }

  /* ------------------------------------------------------------------ */
  /* 导航                                                                 */
  /* ------------------------------------------------------------------ */

  private switchTab(tab: TabId): void {
    this.activeTab = tab;
    for (const [id, section] of this.sections) section.hidden = id !== tab;
    for (const [id, node] of this.tabs) {
      node.classList.toggle('is-active', id === tab);
      node.setAttribute('aria-selected', String(id === tab));
    }
    this.panelFor(tab).update();
  }

  private openRegion(regionId: string): void {
    if (!this.engine.state.regions[regionId]) return;
    this.selectedRegionId = regionId;
    this.regionPanel.show(regionId);
    this.mapView.select(regionId);
    this.switchTab('region');
  }

  private openOrganization(orgId: string): void {
    this.organizationPanel.select(orgId);
    this.switchTab('organization');
  }

  private openCharacter(characterId: string): void {
    this.characterPanel.select(characterId);
    this.switchTab('character');
  }

  /* ------------------------------------------------------------------ */
  /* 时间                                                                 */
  /* ------------------------------------------------------------------ */

  private setSpeed(speed: Speed): void {
    this.speed = speed;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    if (speed !== 0) {
      const config = SPEED_CONFIG[speed];
      this.timer = window.setInterval(() => this.tick(config.days), config.interval);
    }
    this.refresh();
  }

  private tick(days: number): void {
    try {
      this.engine.advanceDays(days);
    } catch (error) {
      this.setSpeed(0);
      this.notify(`时间推进出错：${messageOf(error)}`, 'error');
      return;
    }
    this.refresh();
    this.drainSignals();
  }

  private advanceToDay(day: number): void {
    if (day < this.engine.state.clock.day) return;
    try {
      this.engine.advanceTo(day);
    } catch (error) {
      this.notify(`时间推进出错：${messageOf(error)}`, 'error');
      return;
    }
    this.refresh();
    this.drainSignals();
  }

  private jumpToNextEvent(): void {
    this.setSpeed(0);
    const state = this.engine.state;
    const upcoming = state.pendingEvents
      .filter((event) => event.kind === 'event' && event.day > state.clock.day)
      .sort((a, b) => (a.day === b.day ? a.seq - b.seq : a.day - b.day))[0];
    if (upcoming) {
      this.advanceToDay(upcoming.day);
      this.notify(`推进至 ${formatDate(upcoming.day)}`, 'info');
      return;
    }
    const target = nextBoundary(state.clock.day + 1, Phase.Event);
    this.advanceToDay(target);
    this.notify(`暂无已排定事件，推进至 ${formatDate(target)}`, 'info');
  }

  /* ------------------------------------------------------------------ */
  /* 命令、事件、存档                                                     */
  /* ------------------------------------------------------------------ */

  private dispatch(command: Command): CommandResult {
    const result = this.engine.dispatch(command);
    this.refresh(true);
    if (result.ok) {
      this.notify(result.summary ?? describeCommand(command), 'ok');
    } else {
      this.notify(result.error ?? '命令失败', 'error');
    }
    return result;
  }

  private drainSignals(): void {
    const state = this.engine.state;
    const signals: WorldSignal[] = [];

    for (const record of state.history) {
      if (record.id <= this.lastHistoryId || record.kind !== 'event') continue;
      const def = record.causeEventId
        ? this.engine.content.events.find((event) => event.id === record.causeEventId)
        : undefined;
      signals.push({
        title: def?.text.title ?? '世界事件',
        body: def?.text.body ?? record.summary,
        meta: `${formatDate(record.day)} · ${record.summary}`,
        tone: 'event',
      });
    }
    const latest = state.history.at(-1);
    if (latest) this.lastHistoryId = Math.max(this.lastHistoryId, latest.id);

    for (const scheduled of state.pendingEvents) {
      if (scheduled.kind !== 'event') continue;
      const key = signalKey(scheduled);
      if (this.seenPending.has(key)) continue;
      this.seenPending.add(key);
      if (scheduled.day <= state.clock.day) continue;
      const def = this.engine.content.events.find((event) => event.id === scheduled.refId);
      signals.push({
        title: `预兆 · ${def?.text.title ?? '未明之事'}`,
        body: `风声正在流传：这件事预计在 ${formatDate(scheduled.day)} 前后见分晓，没有人知道它会以何种面目到来。`,
        meta: `待办 ${formatDate(scheduled.day)} · ${this.entityLabel(scheduled.targetScope, scheduled.targetEntityId)}`,
        tone: 'omen',
      });
    }

    if (signals.length > 0) this.eventDialog.pushMany(signals);
  }

  private entityLabel(scope: string | null, entityId: string | null): string {
    if (!entityId) return '未知对象';
    const state = this.engine.state;
    switch (scope) {
      case 'character':
        return state.characters[entityId]?.name ?? entityId;
      case 'organization':
        return state.organizations[entityId]?.name ?? entityId;
      case 'country':
        return state.countries[entityId]?.name ?? entityId;
      case 'region':
        return state.regions[entityId]?.name ?? entityId;
      default:
        return entityId;
    }
  }

  private async saveGame(): Promise<void> {
    if (!storageAvailable()) {
      this.notify('浏览器存档不可用，请改用「导出」', 'error');
      return;
    }
    try {
      await writeSlot(AUTO_SLOT, this.engine.state, '自动存档', Date.now());
      this.notify('已保存到浏览器存档', 'ok');
    } catch (error) {
      this.notify(`保存失败：${messageOf(error)}`, 'error');
    }
  }

  private async loadGame(): Promise<void> {
    if (!storageAvailable()) {
      this.notify('浏览器存档不可用，请改用「导入」', 'error');
      return;
    }
    try {
      const envelope = await readSlot(AUTO_SLOT);
      if (!envelope) {
        this.notify('没有找到浏览器存档', 'error');
        return;
      }
      this.adopt(envelope.state, '已载入浏览器存档');
    } catch (error) {
      this.notify(`读取失败：${messageOf(error)}`, 'error');
    }
  }

  private exportGame(): void {
    try {
      downloadSave(this.engine.state, 'throne-and-gold-save.json');
      this.notify('已导出存档文件', 'ok');
    } catch (error) {
      this.notify(`导出失败：${messageOf(error)}`, 'error');
    }
  }

  private async importFile(file: File): Promise<void> {
    try {
      const envelope = await readSaveFile(file);
      this.adopt(envelope.state, `已导入存档（${formatDate(envelope.day)}）`);
    } catch (error) {
      this.notify(`导入失败：${messageOf(error)}`, 'error');
    }
  }

  private adopt(state: WorldState, message: string): void {
    this.setSpeed(0);
    this.engine = new GameEngine(state, this.engine.content);
    const player = state.characters[state.playerId];
    this.selectedRegionId = player?.regionId ?? Object.keys(state.regions).sort()[0] ?? null;
    if (this.selectedRegionId) {
      this.regionPanel.show(this.selectedRegionId);
      this.mapView.select(this.selectedRegionId);
    }
    this.characterPanel.reset();
    this.historyPanel.reset();
    const orgId = player?.organizationId ?? Object.keys(state.organizations).sort()[0];
    if (orgId) this.organizationPanel.select(orgId);

    this.lastHistoryId = state.history.at(-1)?.id ?? 0;
    this.seenPending = new Set(state.pendingEvents.map(signalKey));
    this.lastHashDay = 0;
    this.refresh(true);
    this.notify(message, 'ok');
  }

  private notify(message: string, tone: NoticeTone = 'info'): void {
    const toast = this.topbar.toast;
    toast.textContent = message;
    toast.className = `toast toast--${tone} is-visible`;
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      toast.classList.remove('is-visible');
    }, 4200);
  }
}
