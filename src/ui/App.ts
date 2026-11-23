/**
 * 单页外壳：顶栏 + 地图 + 标签面板 + 时间控制。
 *
 * 只读 `GameEngine.state`，所有写入都经由 `deps.dispatch`（唯一写入口）。
 * 时间推进使用 `setInterval` 分片，每次 tick 最多推进 3 天，避免阻塞输入。
 *
 * 顶栏 / 时间条 / 快捷键 / 信号收集 / 玩家生命周期 / 自动存档分别落在
 * `ui/app/` 下的独立模块里，这里只做装配与时间推进。
 */

import { describeCommand, type Command, type CommandResult } from '../core/CommandBus';
import { formatDate, nextBoundary, Phase, toDateParts } from '../core/GameClock';
import { GameEngine } from '../core/GameEngine';
import type { WorldState } from '../core/WorldState';
import { CharacterPanel } from './CharacterPanel';
import { ConfirmDialog } from './ConfirmDialog';
import { DebugDialog } from './DebugDialog';
import { HelpDialog } from './HelpDialog';
import type { NoticeTone, UiDeps } from './context';
import { ArmyPanel } from './ArmyPanel';
import { CountryPanel } from './CountryPanel';
import { CreateCharacterDialog, creationErrorText } from './CreateCharacterDialog';
import { StartDialog } from './StartDialog';
import { SuggestionsPanel } from './SuggestionsPanel';
import { EventDialog } from './EventDialog';
import { HistoryPanel } from './HistoryPanel';
import { MonthReportPanel } from './MonthReportPanel';
import { MapView } from './MapView';
import { OrganizationPanel } from './OrganizationPanel';
import { PlayerPanel } from './PlayerPanel';
import { RegionPanel } from './RegionPanel';
import { SaveDialog } from './SaveDialog';
import { Tour } from './Tour';
import { el, fmtMoney, messageOf } from './dom';
import { eventText } from '../core/EventEngine';

import {
  choiceHint,
  SPEED_CONFIG,
  TABS,
  type Speed,
  type TabId,
  type TimebarRefs,
  type TopbarRefs,
} from './app/appTypes';
import { exportGame, importFile, maybeAutoSave, type AutoSaveState } from './app/autosave';
import { installShortcuts, labelButtons, observeButtons } from './app/keyboard';
import { maybeFirstReport, checkPlayerDeath, type LifecycleDeps } from './app/lifecycle';
import { collectSignals, newSignalTracker, type SignalTracker } from './app/signalsFeed';
import { buildTimebar } from './app/timebar';
import { buildLegend, buildTopbar, closeTopbarMenu } from './app/topbar';

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
  private readonly armyPanel: ArmyPanel;
  private readonly historyPanel: HistoryPanel;
  private readonly eventDialog: EventDialog;
  private readonly createDialog: CreateCharacterDialog;
  private readonly startDialog: StartDialog;
  private readonly saveDialog: SaveDialog;
  private readonly helpDialog: HelpDialog;
  private readonly debugDialog: DebugDialog;
  private readonly confirmDialog: ConfirmDialog;
  private readonly tour: Tour;
  private readonly monthReport: MonthReportPanel;
  private readonly tabs = new Map<TabId, HTMLButtonElement>();
  private readonly sections = new Map<TabId, HTMLElement>();
  private readonly speedButtons = new Map<Speed, HTMLButtonElement>();

  private activeTab: TabId = 'region';
  private selectedRegionId: string | null = null;
  private speed: Speed = 1;
  /** 打开中的模态框（事件、存档）；有任一打开就暂停时间。 */
  private readonly openModals = new Set<string>();
  /** 打开模态框前的速度；全部关闭后恢复，手动暂停过则为 null。 */
  private modalResume: Speed | null = null;
  private lastSpeed: Speed = 1;
  private timer: number | null = null;
  private toastTimer: number | null = null;
  private signals: SignalTracker;
  private shownChoices = new Set<string>();
  private pendingButton!: HTMLButtonElement;
  private deathShown = { value: false };
  private autoSave: AutoSaveState = { lastDay: 0, busy: false };
  private suggestionsPanel!: SuggestionsPanel;
  private firstReport = { value: false };
  /** 读数基准：每 30 天记一次，顶栏的 Δ 就是「这个月的变化」。 */
  private snapshot = { day: 0, cash: 0, health: 0, renown: 0 };
  /** 每个标签页各自的滚动位置：切回来时回到原处。 */
  private readonly scrollTops = new Map<TabId, number>();

  constructor(root: HTMLElement, engine: GameEngine) {
    this.root = root;
    this.engine = engine;
    this.signals = newSignalTracker(engine.state);
    this.root.replaceChildren();

    this.shell = el('div', 'app');
    const topbar = buildTopbar(this.shell, {
      openSave: () => this.saveDialog.open(),
      reopenChoices: () => this.reopenChoices(),
      restartTour: () => this.tour.restart(),
      exportGame: () => this.exportGame(),
      openCreator: () => this.confirmNewGame(),
      openHelp: () => this.helpDialog.open(),
      openDebug: () => this.debugDialog.open(),
      importFile: (file) => void this.importFile(file),
    });
    this.topbar = topbar.refs;
    this.pendingButton = topbar.pending;

    const workspace = el('main', 'workspace');
    const playerRail = el('aside', 'player-rail');
    playerRail.dataset.panel = 'player';
    playerRail.setAttribute('aria-label', '玩家概览');
    const mapSection = el('section', 'panel map-panel');
    mapSection.dataset.panel = 'map';
    const mapHead = el('div', 'panel__head');
    mapHead.append(
      el('h2', 'panel__title', '世界地图'),
      el(
        'p',
        'panel__subtitle',
        '悬停看市场摘要，点击进入地区；线条越粗运力越大，箭头指向净进口地区',
      ),
    );
    const mapHost = el('div', 'map-canvas');
    mapSection.append(mapHead, mapHost);
    mapSection.append(buildLegend(engine.state));

    const inspector = el('aside', 'inspector');
    const tabbar = el('nav', 'tabs');
    tabbar.setAttribute('role', 'tablist');
    tabbar.setAttribute('aria-label', '世界面板');
    for (const tab of TABS) {
      const node = el('button', 'tab', tab.label);
      node.type = 'button';
      node.setAttribute('role', 'tab');
      node.id = `tab-${tab.id}`;
      node.tabIndex = tab.id === this.activeTab ? 0 : -1;
      node.setAttribute('aria-selected', String(tab.id === this.activeTab));
      if (tab.id === this.activeTab) node.classList.add('is-active');
      node.addEventListener('click', () => this.switchTab(tab.id));
      this.tabs.set(tab.id, node);
      tabbar.append(node);
    }
    // 方向键在标签之间移动：键盘用户只需 Tab 一次进到标签栏。
    tabbar.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = TABS.findIndex((item) => item.id === this.activeTab);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? TABS.length - 1
            : (index + (event.key === 'ArrowLeft' ? TABS.length - 1 : 1)) % TABS.length;
      const target = TABS[next];
      if (!target) return;
      this.switchTab(target.id);
      this.tabs.get(target.id)?.focus();
    });

    const panels = el('div', 'panels');
    for (const tab of TABS) {
      const section = el('section', 'panel');
      section.dataset.panel = tab.id;
      section.setAttribute('role', 'tabpanel');
      section.id = `panel-${tab.id}`;
      section.setAttribute('aria-labelledby', `tab-${tab.id}`);
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
      advanceDays: (days) => this.advanceToDay(this.engine.state.clock.day + days),
      refresh: () => this.refresh(),
      notify: (message, tone) => this.notify(message, tone),
      openRegion: (regionId) => this.openRegion(regionId),
      openOrganization: (orgId) => this.openOrganization(orgId),
      openCharacter: (characterId) => this.openCharacter(characterId),
    };
    const playerSlot = el('div', 'player-rail__player');
    const suggestSlot = el('div', 'player-rail__suggestions');
    suggestSlot.dataset.tour = 'suggestions';
    playerRail.append(playerSlot, suggestSlot);
    this.playerPanel = new PlayerPanel(playerSlot, this.deps);
    this.suggestionsPanel = new SuggestionsPanel(suggestSlot, this.deps);
    this.regionPanel = new RegionPanel(this.sectionOf('region'), this.deps);
    this.characterPanel = new CharacterPanel(this.sectionOf('character'), this.deps);
    this.organizationPanel = new OrganizationPanel(this.sectionOf('organization'), this.deps);
    this.countryPanel = new CountryPanel(this.sectionOf('country'), this.deps);
    this.armyPanel = new ArmyPanel(this.sectionOf('army'), this.deps);
    this.historyPanel = new HistoryPanel(this.sectionOf('history'), this.deps);

    const timebar: TimebarRefs = buildTimebar(
      this.shell,
      {
        setSpeed: (speed) => this.setSpeed(speed),
        jumpToNextEvent: () => this.jumpToNextEvent(),
        endMonth: () => this.endMonthNow(),
      },
      this.speedButtons,
    );
    this.timeHint = timebar.hint;
    this.shell.append(timebar.element);

    this.eventDialog = new EventDialog(this.shell, {
      onVisibilityChange: (visible) => this.holdForModal('event', visible),
    });
    this.createDialog = new CreateCharacterDialog(this.shell);
    this.startDialog = new StartDialog(this.shell);
    this.saveDialog = new SaveDialog(this.shell, {
      state: () => this.engine.state,
      onLoad: (state, message) => this.adopt(state, message),
      notify: (message, tone) => this.notify(message, tone),
      onVisibilityChange: (visible) => this.holdForModal('save', visible),
    });
    this.helpDialog = new HelpDialog(
      this.shell,
      { restartTour: () => this.tour.restart() },
      (visible) => this.holdForModal('help', visible),
    );
    this.debugDialog = new DebugDialog(
      this.shell,
      () => this.engine,
      (visible) => this.holdForModal('debug', visible),
    );
    this.confirmDialog = new ConfirmDialog(this.shell, (visible) =>
      this.holdForModal('confirm', visible),
    );
    this.monthReport = new MonthReportPanel(this.shell);
    this.tour = new Tour(this.shell);
    installShortcuts({
      shell: this.shell,
      closeOverlay: () => this.closeOverlay(),
      restartTour: () => this.tour.restart(),
      togglePause: () => this.togglePause(),
      setSpeed: (speed) => this.setSpeed(speed),
    });
    this.root.append(this.shell);
  }

  start(message?: string, options: { tour?: boolean } = {}): void {
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
    this.armyPanel.update();
    this.historyPanel.update();

    this.signals = newSignalTracker(state);
    this.shownChoices = new Set();
    this.deathShown = { value: false };
    this.autoSave = { lastDay: state.clock.day, busy: false };
    this.snapshot = {
      day: state.clock.day,
      cash: player?.wealth ?? 0,
      health: Math.round(player?.health ?? 0),
      renown: 0,
    };
    this.scrollTops.clear();

    this.switchTab('region');
    // 开局弹窗期间时间停着；关掉之后再让世界走起来。
    this.holdForModal('create', false);
    this.holdForModal('start', false);
    if (this.openModals.size === 0) this.setSpeed(1);
    this.refresh(true);
    if (message) this.notify(message, 'ok');
    if (options.tour !== false) this.tour.maybeStart();
    labelButtons(this.shell);
    observeButtons(this.shell);
  }

  /** 首次开局：在有存档时跳过，由玩家决定沿用默认人物还是自建。 */
  offerStart(): void {
    this.holdForModal('start', true);
    this.startDialog.open({
      onDefault: () => this.start('你是金穗行的少东家：持股 22%，掌柜是叔父霍布·金穗。'),
      onCreate: () => this.openCreator(),
    });
  }

  /* ------------------------------------------------------------------ */
  /* 状态刷新                                                             */
  /* ------------------------------------------------------------------ */

  private refresh(forceHash = false): void {
    const state = this.engine.state;
    const parts = toDateParts(state.clock.day);
    this.topbar.date.textContent = `第 ${parts.year} 年 ${parts.month} 月 ${parts.dayOfMonth} 日`;
    const player = state.characters[state.playerId];
    const cash = player?.wealth ?? 0;
    const health = player ? Math.round(player.health) : 0;
    this.topbar.cash.textContent = player ? fmtMoney(cash) : '—';
    this.topbar.health.textContent = player ? String(health) : '—';
    this.topbar.actionPoints.textContent = player ? String(player.actionPoints) : '—';
    this.topbar.speed.textContent = this.speed === 0 ? '暂停' : `${this.speed}×`;

    // Δ 是「和 30 天前相比」：基准每隔一个月挪一次，跨日刷新不会把变化抹掉。
    if (
      forceHash ||
      state.clock.day < this.snapshot.day ||
      state.clock.day - this.snapshot.day >= 30
    ) {
      this.snapshot = { day: state.clock.day, cash, health, renown: 0 };
      this.setDelta(this.topbar.cashDelta, 0);
      this.setDelta(this.topbar.healthDelta, 0);
    } else {
      this.setDelta(this.topbar.cashDelta, cash - this.snapshot.cash);
      this.setDelta(this.topbar.healthDelta, health - this.snapshot.health);
    }

    const pendingCount = state.pendingChoices.length;
    this.pendingButton.hidden = pendingCount === 0;
    this.pendingButton.textContent = pendingCount > 0 ? `待决抉择 ${pendingCount}` : '待决抉择';

    const report = this.engine.consumeMonthReport();
    if (report) this.monthReport.show(report);

    this.mapView.update(state);
    this.playerPanel.update();
    this.suggestionsPanel.render();
    this.panelFor(this.activeTab).update();
    this.timeHint.textContent = `第 ${state.clock.day} 天 · 每周市场 / 每月组织·国家·事件 / 每年人口`;
    for (const [speed, node] of this.speedButtons) {
      node.classList.toggle('is-active', speed === this.speed);
    }
  }

  /** 结束本月：剩下的日子当休养，推进到月末并弹月报。 */
  private endMonthNow(): void {
    const result = this.engine.dispatch({ kind: 'end_month' });
    if (!result.ok) this.notify(result.summary ?? '这个月已经到底了', 'info');
    this.refresh(true);
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
      case 'army':
        return this.armyPanel;
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
    // 记下离开时的滚动位置：面板是各自独立的滚动容器。
    const previous = this.sections.get(this.activeTab);
    if (previous && !previous.hidden) this.scrollTops.set(this.activeTab, previous.scrollTop);
    this.activeTab = tab;
    for (const [id, section] of this.sections) section.hidden = id !== tab;
    for (const [id, node] of this.tabs) {
      node.classList.toggle('is-active', id === tab);
      node.setAttribute('aria-selected', String(id === tab));
      node.tabIndex = id === tab ? 0 : -1;
    }
    this.panelFor(tab).update();
    const section = this.sections.get(tab);
    if (section) section.scrollTop = this.scrollTops.get(tab) ?? 0;
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

  /** 顶栏的 Δ：0 不显示，正负用箭头与颜色双编码。 */
  private setDelta(node: HTMLElement, delta: number): void {
    if (delta === 0) {
      node.textContent = '';
      node.className = 'topbar__delta';
      return;
    }
    node.textContent = `${delta > 0 ? '↑' : '↓'}${fmtMoney(Math.abs(delta))}`;
    node.className = `topbar__delta ${delta > 0 ? 'is-up' : 'is-down'}`;
  }

  /** 新开一局：会盖掉当前进度，所以先问一句。 */
  private confirmNewGame(): void {
    this.confirmDialog.open({
      title: '新开一局？',
      body: '当前这局会停在这里（自动存档不会被删除，随时能在存档里读回来），然后进入人物创建。',
      confirmLabel: '新开一局',
      onConfirm: () => this.openCreator(),
    });
  }

  /** 打开开局人物创建；成功后重挂界面到新玩家。 */
  private openCreator(): void {
    this.holdForModal('start', false);
    this.holdForModal('create', true);
    this.createDialog.open(this.engine.content, (choice) => {
      try {
        const result = this.engine.createPlayer(choice);
        this.start(`你以「${result.character.name}」的身份登场`);
        for (const warning of result.warnings) this.notify(warning, 'info');
        return { ok: true };
      } catch (error) {
        return { ok: false, error: creationErrorText(error) };
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* 时间                                                                 */
  /* ------------------------------------------------------------------ */

  private setSpeed(speed: Speed): void {
    this.speed = speed;
    if (speed !== 0) this.lastSpeed = speed;
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

  /**
   * 看弹窗时暂停时间：任一模态框打开就把速度归零，记下原速度；
   * 全部关闭后恢复到打开前的速度（默认 1×）。手动暂停时不恢复。
   */
  private holdForModal(name: string, open: boolean): void {
    if (open) this.openModals.add(name);
    else this.openModals.delete(name);
    if (this.openModals.size > 0) {
      if (this.speed !== 0) {
        this.modalResume = this.speed;
        this.setSpeed(0);
      }
      return;
    }
    const resume = this.modalResume;
    this.modalResume = null;
    if (resume !== null) this.setSpeed(resume);
  }

  /** 空格暂停 / 继续；恢复时回到上一次非零速度。 */
  private togglePause(): void {
    if (this.speed === 0) {
      this.setSpeed(this.lastSpeed === 0 ? 1 : this.lastSpeed);
      return;
    }
    this.setSpeed(0);
  }

  /** Esc：先关存档，再关引导；都没开就交给事件弹窗自己处理。 */
  private closeOverlay(): boolean {
    if (closeTopbarMenu()) {
      // 菜单是轻浮层：关掉就算处理，但不该吞掉后续的 Esc（这里没有后续动作）。
      return true;
    }
    if (this.saveDialog.isOpen) {
      this.saveDialog.close();
      return true;
    }
    if (this.helpDialog.isOpen) {
      this.helpDialog.close();
      return true;
    }
    if (this.debugDialog.isOpen) {
      this.debugDialog.close();
      return true;
    }
    if (this.confirmDialog.isOpen) {
      this.confirmDialog.close();
      return true;
    }
    if (this.tour.isOpen) {
      this.tour.close();
      return true;
    }
    return false;
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
    this.pumpChoices();
    this.afterAdvance();
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
    this.pumpChoices();
    this.afterAdvance();
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

  /** 重新打开挂起的抉择（关掉弹窗后还能回来处理）。 */
  private reopenChoices(): void {
    for (const pending of this.engine.state.pendingChoices) this.shownChoices.delete(pending.id);
    this.pumpChoices();
    this.refresh(true);
  }

  /** 把等待中的玩家抉择弹出来；同一条只弹一次。 */
  private pumpChoices(): void {
    const state = this.engine.state;
    const pending = state.pendingChoices.find((item) => !this.shownChoices.has(item.id));
    if (!pending) return;
    this.shownChoices.add(pending.id);
    const def = this.engine.content.events.find((event) => event.id === pending.eventId);
    if (!def?.choices) return;

    const choiceText = eventText(state, def, {
      scope: pending.scope,
      entityId: pending.entityId,
    });
    this.eventDialog.pushMany([
      {
        title: choiceText.title,
        body: choiceText.body,
        meta: `${formatDate(pending.day)} · 这一步由你决定（世界继续走，想好了随时点）`,
        tone: 'choice',
        options: def.choices.map((choice) => ({
          id: choice.id,
          label: choice.label,
          hint: choiceHint(state, choice),
        })),
        onPick: (choiceId) => {
          const result = this.engine.dispatch({ kind: 'choose', choiceId });
          this.refresh(true);
          this.notify(
            result.ok ? (result.summary ?? '已做出抉择') : (result.error ?? '抉择失败'),
            result.ok ? 'ok' : 'error',
          );
        },
      },
    ]);
  }

  private drainSignals(): void {
    const signals = collectSignals({
      state: this.engine.state,
      content: this.engine.content,
      tracker: this.signals,
    });
    if (signals.length === 0) return;
    const dropped = this.eventDialog.pushMany(signals);
    if (dropped > 0) this.notify(`另有 ${dropped} 条已收入编年史`, 'info');
  }

  /** 每次推进后检查死讯与自动存档。 */
  private afterAdvance(): void {
    const deps = this.lifecycleDeps();
    checkPlayerDeath(deps, this.deathShown);
    maybeAutoSave(this.engine.state, this.autoSave, (message, tone) => this.notify(message, tone));
    maybeFirstReport(deps, this.firstReport);
  }

  private lifecycleDeps(): LifecycleDeps {
    return {
      engine: () => this.engine,
      dialog: () => this.eventDialog,
      notify: (message, tone) => this.notify(message, tone),
      refresh: (forceHash) => this.refresh(forceHash),
      pause: () => this.setSpeed(0),
      afterInherit: () => {
        this.signals.lastHistoryId =
          this.engine.state.history.at(-1)?.id ?? this.signals.lastHistoryId;
      },
    };
  }

  private exportGame(): void {
    exportGame(this.engine.state, (message, tone) => this.notify(message, tone));
  }

  private async importFile(file: File): Promise<void> {
    await importFile(
      file,
      (state, message) => this.adopt(state, message),
      (message, tone) => this.notify(message, tone),
    );
  }

  private adopt(state: WorldState, message: string): void {
    this.setSpeed(this.lastSpeed === 0 ? 1 : this.lastSpeed);
    this.engine = new GameEngine(state, this.engine.content, { stopAtChoices: true });
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

    this.signals = newSignalTracker(state);
    this.deathShown = { value: false };
    this.autoSave = { lastDay: state.clock.day, busy: false };
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
