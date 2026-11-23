/**
 * 世界模拟入口（铁律 2 与 5 的守门人）。
 *
 * 对外只有三个动作：
 *   - `dispatch(command)`：唯一的写入口，拒绝非法命令，成功则记入历史；
 *   - `advanceDays(n)` / `advanceTo(day)`：唯一的时间推进入口；
 *   - `hash()`：状态指纹，用于确定性回归（R1/R2）与回放校验。
 *
 * 每日按相位推进（开发计划 §4.4）：
 *   0 Action → 1 Market → 2 Organization → 3 Country → 4 Event → 5 WrapUp
 * 相位是否在今天发生由 `settlementPoints(day)` 决定（周/月/季/年边界）。
 */

import { applyCommand, type Command, type CommandResult } from './CommandBus';
import {
  applyBaseEffects,
  applyEvent,
  evaluate,
  eventText,
  readFeature,
  CHOICE_WINDOW_DAYS,
  collectCandidates,
  pickChoice,
  resolveChoice,
  selectTriggered,
  type EventTarget,
} from './EventEngine';
import {
  DAYS_PER_MONTH,
  formatDate,
  GameClock,
  Phase,
  settlementPoints,
  toDateParts,
  type SettlementPoint,
} from './GameClock';
import { History } from './History';
import { buildMonthlyReport, type MonthlyReport } from './MonthlyReport';
import { composeChronicle } from './Chronicler';
import { Random } from './Random';
import { applyTiers, computeTiers } from './SimulationTier';
import {
  hashWorld,
  monthKeyOf,
  type CharacterId,
  type EventDef,
  type SettleContext,
  type WorldContent,
  type WorldState,
} from './WorldState';
import { isMonthEnd, isQuarterEnd, isYearEnd } from './GameClock';
import { settleMonthlyDecisions, settleCountryDecisions } from '../systems/npc/DecisionSystem';
import { monthlyOrganizationSettlement } from '../systems/organization/OrganizationSystem';
import { settleMonthlyProduction } from '../systems/economy/ProductionSystem';
import { settleMonthlyMarket } from '../systems/economy/MarketSystem';
import { settleMonthlyTrade } from '../systems/economy/TradeSystem';
import { settleMonthlyCharacters } from '../systems/character/CharacterSystem';
import { refreshMonthlyActions } from '../systems/character/Activity';
import { settleMonthlyUpkeep } from '../systems/character/Upkeep';
import { settleYearlyDemography } from '../systems/character/Demography';
import { settleYearlyCareer } from '../systems/character/Career';
import { decayRelations } from '../systems/character/Relations';
import {
  createPlayerCharacter,
  type CharacterCreationChoice,
  type CharacterCreationResult,
} from '../systems/character/CharacterCreator';
import { settleMonthlyCountry } from '../systems/country/CountrySystem';
import { seedRulerDynasties } from '../systems/character/Dynasty';
import { assignOffices, influenceOf, syncOffices } from '../systems/country/Offices';
import { runPolicyRound } from '../systems/country/PolicySystem';
import {
  settleMonthlyDiplomacy,
  settleMonthlyMilitary,
  settleMonthlyWar,
} from '../systems/military/WarSystem';

/** 日常琐事：记进编年史但在"只看大事"里折叠起来。 */
const ROUTINE_COMMANDS = new Set<string>(['rest', 'train', 'inspect_market']);

export class GameEngine {
  readonly content: WorldContent;
  readonly state: WorldState;
  private readonly clock: GameClock;
  private rng: Random;
  private readonly history: History;
  private readonly stopAtChoices: boolean;
  /** 最近一次月报；界面取走后清空，避免同一个月弹两次。 */
  private monthReport: MonthlyReport | null = null;

  constructor(state: WorldState, content: WorldContent, options: { stopAtChoices?: boolean } = {}) {
    this.state = state;
    this.content = content;
    this.clock = new GameClock(state.clock);
    this.rng = Random.fromSnapshot({ seed: state.meta.seed, counters: state.rngCounters });
    this.history = new History(state.history);
    this.stopAtChoices = options.stopAtChoices ?? false;
    // 开局补齐公职：技能最高者出任首相/元帅/财务大臣，玩家影响力由此计算。
    if (Object.values(state.countries).every((country) => country.offices.length === 0)) {
      assignOffices(state);
    }
    // 给在位者补上配偶与子女：没有王朝就没有继承法可言。
    seedRulerDynasties(state, content);
  }

  /** 等待玩家抉择的事件（UI 用）。 */
  get pendingChoices() {
    return this.state.pendingChoices;
  }

  get day(): number {
    return this.state.clock.day;
  }

  /** 玩家是否仍在世；死亡后 UI 会暂停时间并进入结算。 */
  get playerAlive(): boolean {
    return this.state.characters[this.state.playerId]?.alive === true;
  }

  /**
   * 玩家可选的继承人：配偶 → 子女 → 兄弟姐妹 → 同家族其他在世成员。
   * 只返回在世、且不是玩家本人的角色，按亲疏排序。
   */
  heirs(): CharacterId[] {
    const player = this.state.characters[this.state.playerId];
    if (!player) return [];
    const alive = (id: CharacterId): boolean => this.state.characters[id]?.alive === true;
    const picked = new Set<CharacterId>();
    const push = (id: CharacterId | null | undefined): void => {
      if (id && id !== player.id && alive(id)) picked.add(id);
    };

    push(player.spouseId);
    for (const character of Object.values(this.state.characters)) {
      if (character.parentIds.includes(player.id)) push(character.id);
    }
    if (player.familyId) {
      const family = this.state.families[player.familyId];
      for (const memberId of family?.memberIds ?? []) {
        const member = this.state.characters[memberId];
        if (!member || memberId === player.id || !member.alive) continue;
        const shared = member.parentIds.filter(
          (id) => id !== null && player.parentIds.includes(id),
        );
        if (shared.length > 0) push(memberId);
      }
    }
    return [...picked];
  }

  /** 以指定继承人继续；要求目标在世且存在于世界中。 */
  continueAs(characterId: CharacterId): CommandResult {
    const next = this.state.characters[characterId];
    if (!next) return { ok: false, error: '继承人不存在' };
    if (!next.alive) return { ok: false, error: '继承人已经不在人世' };
    const previous = this.state.playerId;
    this.state.playerId = characterId;
    this.record(
      'milestone',
      `${formatDate(this.day)} ${next.name} 继承了 ${this.state.characters[previous]?.name ?? '前任'} 的家业`,
      [{ kind: 'character', id: characterId }],
    );
    this.syncCounters();
    return {
      ok: true,
      summary: `你现在是 ${next.name}`,
      refs: [{ kind: 'character', id: characterId }],
    };
  }

  /** 玩家在当前所在国的公职影响力（0–1），政策支持度与命令权限共用。 */
  playerInfluence(): number {
    const player = this.state.characters[this.state.playerId];
    if (!player) return 0;
    const region = this.state.regions[player.location.regionId];
    return influenceOf(this.state, player.id, region?.countryId ?? '');
  }

  /** 状态指纹：确定性回归与存档校验用。 */
  hash(): string {
    return hashWorld(this.state);
  }

  /** 唯一写入口。 */
  dispatch(command: Command): CommandResult {
    if (command.kind === 'choose') {
      const result = this.choose(command.choiceId);
      if (result.ok) {
        this.record(
          'command',
          `${formatDate(this.day)} ${result.summary ?? '做出抉择'}`,
          result.refs ?? [],
        );
      }
      this.syncCounters();
      return result;
    }
    if (command.kind === 'end_month') {
      const result = this.endMonth();
      this.syncCounters();
      return result;
    }
    const result = applyCommand(this.state, command, this.content);
    if (result.ok) {
      const actor = this.state.characters[this.state.playerId];
      if (actor?.alive) actor.lastActionDay = this.state.clock.day;
      const summary = result.summary ?? command.kind;
      // 玩家做的事必须留在编年史里，并且记在玩家名下——否则"我的故事"只剩系统事件。
      const refs = [...(result.refs ?? [])];
      if (this.state.playerId && !refs.some((ref) => ref.id === this.state.playerId)) {
        refs.push({ kind: 'character', id: this.state.playerId });
      }
      const routine = ROUTINE_COMMANDS.has(command.kind);
      this.record(
        'command',
        `${formatDate(this.day)} ${summary}`,
        refs,
        null,
        null,
        routine ? 'minor' : 'major',
      );
    } else {
      this.syncCounters();
    }
    return result;
  }

  /**
   * 结束本月：把剩下的日子按休养处理（没有收入，身体缓过来一点），推进到月末。
   * 这是玩家唯一不需要行动力的「跳过时间」入口，也是月报的触发点。
   */
  endMonth(): CommandResult {
    const player = this.state.characters[this.state.playerId];
    if (!player?.alive) return { ok: false, summary: '你已经不在人世，无法再结束这个月' };
    // 结算到本月最后一天（含）：日历指针停在「下个月第 1 天」。
    const left = DAYS_PER_MONTH - toDateParts(this.state.clock.day).dayOfMonth + 1;
    player.actionPoints = 0;
    this.advanceDays(left);
    const after = this.state.characters[this.state.playerId];
    const rest = after?.alive === true ? Math.min(6, Math.ceil(left / 5)) : 0;
    if (after?.alive === true) after.health = Math.min(100, after.health + rest);
    const summary =
      after?.alive === true
        ? `你把剩下的 ${left} 天用来休养，健康 +${rest}（当前 ${after.health}），这个月收尾了`
        : '这个月还没走完，人就不在了';
    this.record(
      'command',
      `${formatDate(this.state.clock.day)} ${summary}`,
      [{ kind: 'character', id: this.state.playerId }],
      null,
      null,
      'minor',
    );
    return { ok: true, summary, refs: [{ kind: 'character', id: this.state.playerId }] };
  }

  /** 取走最近一次月报（取走后清空）。 */
  consumeMonthReport(): MonthlyReport | null {
    const report = this.monthReport;
    this.monthReport = null;
    return report;
  }

  /** 只看一眼，不取走。 */
  get lastMonthReport(): MonthlyReport | null {
    return this.monthReport;
  }

  /**
   * 开局创建玩家人物（M4.2）。
   *
   * 走与人口学相同的 `buildCharacter` 路径，因此不需要为玩家特判档案结构；
   * 创建后把玩家指针指向新人物，并记一条 milestone 历史。
   */
  createPlayer(choice: CharacterCreationChoice): CharacterCreationResult {
    const result = createPlayerCharacter(this.state, this.content, choice, this.rng);
    this.record(
      'milestone',
      `${formatDate(this.day)} 你以「${choice.backgroundId}」的身份登场（${result.character.name}）`,
      [{ kind: 'character', id: result.character.id }],
    );
    this.syncCounters();
    return result;
  }

  /** 推进 n 天（含当天结算）。 */
  advanceDays(days: number): void {
    for (let index = 0; index < days; index += 1) {
      this.settleDay(this.state.clock.day);
      this.state.clock.day = this.clock.advanceOneDay();
    }
    this.syncCounters();
  }

  /** 推进到指定日期（含）。 */
  advanceTo(day: number): void {
    if (!Number.isFinite(day)) return;
    while (this.state.clock.day <= day) {
      this.settleDay(this.state.clock.day);
      this.state.clock.day = this.clock.advanceOneDay();
    }
    this.syncCounters();
  }

  /* ---------------------------------------------------------------- */

  private settleDay(day: number): void {
    this.fireDueEvents(day);
    for (const point of settlementPoints(day)) {
      this.settlePhase(point);
    }
  }

  private settlePhase(point: SettlementPoint): void {
    const ctx: SettleContext = {
      day: point.day,
      periodKey: point.phase >= Phase.Organization ? monthKeyOf(point.day) : `d${point.day}`,
      phase: point.phase,
      rng: this.rng,
    };

    switch (point.phase) {
      case Phase.Action:
        this.onActionPhase(point.day);
        break;
      case Phase.Market:
        this.onMarketPhase(ctx);
        break;
      case Phase.Organization:
        this.onOrganizationPhase(ctx);
        break;
      case Phase.Country:
        this.onCountryPhase(ctx);
        break;
      case Phase.Event:
        this.onEventPhase(ctx);
        break;
      case Phase.WrapUp:
        this.onWrapUpPhase(ctx);
        break;
    }
  }

  /** 死亡的两三句话：谁、在哪、活了多少年、生前是什么人、留下了什么。 */
  private recordDeath(id: CharacterId, day: number): void {
    const person = this.state.characters[id];
    const name = person?.name ?? id;
    const place = person ? this.state.regions[person.regionId]?.name : undefined;
    const org = person?.organizationId ? this.state.organizations[person.organizationId] : null;
    const country = person
      ? Object.values(this.state.countries).find((item) => item.regionIds.includes(person.regionId))
      : undefined;
    const role = org
      ? `${org.name}的${org.leadership.leaderId === id ? '掌舵人' : '成员'}`
      : country?.rulerId === id
        ? `${country.name}的统治者`
        : country
          ? `${country.name}的居民`
          : '云游四方的人';
    const age = person ? Math.max(0, Math.round(person.age)) : 0;
    const cash = person ? Math.max(0, Math.round(person.wealth)) : 0;
    const body = person
      ? `${name}在${place ?? '旅途上'}去世，享年 ${age} 岁。生前是${role}。身后留下 ${cash} 铜，由家人依照律法与习俗分派。`
      : `${name}去世了，没有留下太多可说的。`;
    this.record(
      'death',
      `${formatDate(day)} ${name} 去世`,
      [{ kind: 'character', id }],
      null,
      body,
    );
  }

  /** 更替的三句话：谁接了谁、凭什么、接手时的局面。 */
  private recordSuccession(
    countryId: string,
    beforeId: CharacterId,
    afterId: CharacterId,
    day: number,
  ): void {
    const country = this.state.countries[countryId];
    const next = this.state.characters[afterId];
    const before = this.state.characters[beforeId];
    if (!country || !next) return;
    const kin = before
      ? next.parentIds.includes(before.id)
        ? '先代的子嗣'
        : next.spouseId === before.id
          ? '先代的配偶'
          : before.familyId !== null && next.familyId === before.familyId
            ? '同族的近亲'
            : '群臣推举的新君'
      : '新君';
    const seat = country.succession === 'elective' ? '执政权' : '王位';
    const body = `${country.name}的${seat}由 ${next.name} 接掌，身份是${kin}。${before && !before.alive ? `先代 ${before.name} 已经入土，` : ''}新君面前的局面是稳定度 ${Math.round(country.stability * 100)}%、合法性 ${Math.round(country.legitimacy * 100)}%。`;
    this.record(
      'milestone',
      `${formatDate(day)} ${country.name} ${seat}更替：${next.name} 继位`,
      [
        { kind: 'country', id: countryId },
        { kind: 'character', id: afterId },
      ],
      null,
      body,
    );
  }

  /** 玩家的月度开销：既是钱的事，也是"你的生活"在编年史里的落点。 */
  private recordMonthlyUpkeep(ctx: SettleContext): void {
    const player = this.state.characters[this.state.playerId];
    if (!player?.alive) return;
    const before = player.wealth;
    settleMonthlyUpkeep(this.state);
    const spent = Math.max(0, Math.round(before - player.wealth));
    if (spent <= 0) return;
    this.record(
      'finance',
      `${formatDate(ctx.day)} 你的生活开销 ${spent} 铜`,
      [{ kind: 'character', id: player.id }],
      null,
      null,
      'minor',
    );
  }

  private onActionPhase(day: number): void {
    // 玩家与重要 NPC 的日常行动：M1 只处理"跳下一重要事件"所需的调度检查。
    void day;
  }

  private onMarketPhase(ctx: SettleContext): void {
    settleMonthlyProduction(this.state, this.content);
    const moves = settleMonthlyMarket(this.state, this.content);
    const trade = settleMonthlyTrade(this.state, this.content);
    const flows = trade.flows;

    const spiking = moves.filter((move) => move.priceAfter >= move.priceBefore * 1.1);
    for (const move of spiking) {
      this.record(
        'trade',
        `${formatDate(ctx.day)} ${move.regionId}/${move.goodId} 价格 ${move.priceBefore} → ${move.priceAfter}（缺口 ${move.shortage}）`,
        [{ kind: 'region', id: move.regionId }],
      );
    }
    for (const flow of flows) {
      this.record(
        'trade',
        `${formatDate(ctx.day)} ${flow.from} → ${flow.to} 发运 ${flow.goodId} ×${flow.units}（运费 ${flow.transportCost}，关税 ${flow.tariff}，${flow.arriveDay} 到港）`,
        [
          { kind: 'region', id: flow.from },
          { kind: 'region', id: flow.to },
        ],
      );
    }
    for (const arrival of trade.arrivals) {
      this.record(
        'trade',
        `${formatDate(ctx.day)} ${arrival.goodId} ×${arrival.units} 到港（损耗 ${arrival.lost}，货款 ${arrival.revenue}，关税 ${arrival.tariff}）`,
        arrival.orgId ? [{ kind: 'organization', id: arrival.orgId }] : [],
      );
    }
  }

  private onOrganizationPhase(ctx: SettleContext): void {
    refreshMonthlyActions(this.state);
    this.recordMonthlyUpkeep(ctx);
    const settlement = monthlyOrganizationSettlement(this.state, this.content, ctx);
    const decisions = settleMonthlyDecisions(this.state, ctx);
    const stipends = settleMonthlyCharacters(this.state, this.content, ctx);

    for (const entry of settlement.finance) {
      if (entry.profit < 0) {
        this.record('finance', `${formatDate(ctx.day)} ${entry.orgId} 亏损 ${entry.profit}`, [
          { kind: 'organization', id: entry.orgId },
        ]);
      }
    }
    for (const decision of decisions) {
      this.record(
        'command',
        `${formatDate(ctx.day)} ${decision.orgId} 战略 ${decision.from} → ${decision.to}（${decision.reason}）`,
        [{ kind: 'organization', id: decision.orgId }],
      );
    }
    for (const event of settlement.events) {
      const kind =
        event.kind === 'trade'
          ? 'trade'
          : event.kind === 'finance'
            ? 'finance'
            : event.kind === 'command'
              ? 'command'
              : 'milestone';
      this.record(kind, event.summary, event.refs);
    }
    void stipends;
  }

  private onCountryPhase(ctx: SettleContext): void {
    const budgets = settleMonthlyCountry(this.state, this.content, ctx);
    settleMonthlyMilitary(this.state, this.content, ctx);
    for (const declaration of settleMonthlyDiplomacy(this.state, this.content, ctx)) {
      this.record(
        'war',
        `${formatDate(ctx.day)} ${declaration.summary ?? '宣战'}`,
        [],
        null,
        `${declaration.summary ?? '宣战'}。两国的争端从使节的往返走到了战场，边地的村庄开始囤粮、修寨，商队绕道而行。`,
      );
    }
    const warOutcomes = settleMonthlyWar(this.state, this.content, ctx);
    for (const outcome of warOutcomes) {
      const place = outcome.regionId ? this.state.regions[outcome.regionId]?.name : null;
      const tally = outcome.casualties
        ? `这一仗攻方折了 ${outcome.casualties.attacker} 人，守方折了 ${outcome.casualties.defender} 人。`
        : '';
      this.record(
        'war',
        `${formatDate(ctx.day)} ${outcome.summary}`,
        [
          { kind: 'country', id: outcome.attackerId },
          { kind: 'country', id: outcome.defenderId },
        ],
        null,
        [`${place ? place + '的' : ''}战报传回两国朝堂：${outcome.summary}。`, tally]
          .filter((line) => line.length > 0)
          .join(''),
      );
    }

    for (const budget of budgets) {
      if (budget.balance < 0) {
        this.record(
          'finance',
          `${formatDate(ctx.day)} ${budget.countryId} 赤字 ${budget.balance}，债务 ${budget.debtAfter}`,
          [{ kind: 'country', id: budget.countryId }],
        );
      }
    }

    // 政策压力季度检查（3/6/9/12 月末），带成本、冷却与政体决策。
    if (isQuarterEnd(ctx.day)) {
      for (const note of syncOffices(this.state)) {
        this.record('policy', `${formatDate(ctx.day)} ${note.text}`, [
          { kind: 'country', id: note.countryId },
        ]);
      }
      const round = runPolicyRound(
        this.state,
        ctx,
        ctx.day,
        this.content.balance.policy,
        this.playerInfluence(),
      );
      for (const proposal of round) {
        this.record('policy', `${formatDate(ctx.day)} ${proposal.reason}`, [
          { kind: 'country', id: proposal.countryId },
        ]);
      }
      for (const change of round.polityChanges) {
        this.record('policy', `${formatDate(ctx.day)} ${change.reason}`, [
          { kind: 'country', id: change.countryId },
        ]);
      }
    }

    // 国家层面 NPC 决策：统治者/执政官每月在增税、削军、借债之间选一条路线。
    const cabinet = settleCountryDecisions(this.state, ctx);
    for (const decision of cabinet.decisions) {
      this.record(
        'command',
        `${formatDate(ctx.day)} ${decision.reason}（效用 ${decision.utility.toFixed(3)}）`,
        [
          { kind: 'country', id: decision.countryId },
          { kind: 'character', id: decision.characterId },
        ],
      );
    }
  }

  private onEventPhase(ctx: SettleContext): void {
    const candidates = collectCandidates(this.state, this.content, ctx.day, 2);
    const triggered = selectTriggered(
      this.state,
      candidates,
      this.rng,
      ctx.periodKey,
      this.content.balance.events.samplingDays,
    );

    for (const trigger of triggered) {
      this.applyTrigger(trigger.def, trigger.target, ctx.day);
    }
  }

  private onWrapUpPhase(ctx: SettleContext): void {
    // 月末：把当月的贸易与收支并成一条账本，编年史只留大事。
    if (isMonthEnd(ctx.day)) {
      this.history.compactMonth(ctx.day);
      const report = buildMonthlyReport(this.state, ctx.day);
      this.monthReport = report;
      this.record(
        'month',
        `${formatDate(ctx.day)} ${report.title}：${this.state.characters[this.state.playerId]?.name ?? '你'}的月末小结（${report.changes[0] ?? '无事发生'}）`,
        this.state.playerId ? [{ kind: 'character', id: this.state.playerId }] : [],
        null,
        report.body,
        'minor',
      );
    }

    // 季度：分层重算（L1/L2/L3）。
    if (isQuarterEnd(ctx.day)) {
      const report = computeTiers(this.state, this.content);
      applyTiers(this.state, report);
    }

    // 年度：衰老、死亡、遗产、婚姻与出生（M4.1 人口学）。
    if (isYearEnd(ctx.day)) {
      const rulersBefore = new Map(
        Object.values(this.state.countries).map(
          (country) => [country.id, country.rulerId] as const,
        ),
      );
      const yearly = settleYearlyDemography(this.state, this.content, ctx);
      for (const id of yearly.deaths) {
        this.recordDeath(id, ctx.day);
      }
      for (const country of Object.values(this.state.countries)) {
        const before = rulersBefore.get(country.id);
        if (!before || before === country.rulerId) continue;
        this.recordSuccession(country.id, before, country.rulerId, ctx.day);
      }
      for (const estate of yearly.estates) {
        const heirs = estate.heirs.length > 0 ? estate.heirs.join('、') : '所在国';
        this.record(
          'finance',
          `${formatDate(ctx.day)} ${estate.characterId} 的遗产由 ${heirs} 接收（现金 ${Math.round(
            estate.cash,
          )}，股份 ${(estate.share * 100).toFixed(1)}%）`,
          estate.heirs.map((id) => ({ kind: 'character' as const, id })),
        );
      }
      for (const marriage of yearly.marriages) {
        this.record('milestone', `${formatDate(ctx.day)} ${marriage.a} 与 ${marriage.b} 成婚`, [
          { kind: 'character', id: marriage.a },
          { kind: 'character', id: marriage.b },
        ]);
      }
      for (const id of yearly.births) {
        const child = this.state.characters[id];
        if (!child) continue;
        this.record('milestone', `${formatDate(ctx.day)} ${child.name} 出生`, [
          { kind: 'character', id },
        ]);
      }

      // 年度：生涯晋升/降级，关系网向 0 回归（M4.3）。
      for (const change of settleYearlyCareer(this.state, ctx.day)) {
        this.record(
          'milestone',
          `${formatDate(ctx.day)} ${this.state.characters[change.characterId]?.name ?? change.characterId} ${
            change.direction === 'up' ? '晋升为' : '降为'
          }${change.title}`,
          [{ kind: 'character', id: change.characterId }],
        );
      }
      decayRelations(this.state);
    }

    // 月度摘要：一行总览，方便 UI 与 100 年快进后的"年年有记录"。
    const activeOrgs = Object.values(this.state.organizations).filter(
      (org) => org.lifecycle !== 'dissolved',
    ).length;
    this.state.stats.orgCountSum += activeOrgs;
    this.state.stats.orgCountSamples += 1;
    // 月度结算只累积统计，不写历史：一百年 1200 条"月度结算"会淹没真正的事件叙事。
    void totalPopulation(this.state);
  }

  /* ---------------------------------------------------------------- */

  /** 玩家做出抉择：结算选项效果并清掉挂起记录。 */
  choose(choiceId?: string): CommandResult {
    const pending = this.state.pendingChoices.find(
      (item) => item.scope === 'character' && item.entityId === this.state.playerId,
    );
    if (!pending) return { ok: false, error: '当前没有等待你决定的事件' };

    const def = this.content.events.find((event) => event.id === pending.eventId);
    if (!def?.choices || def.choices.length === 0) {
      this.state.pendingChoices = this.state.pendingChoices.filter((item) => item !== pending);
      return { ok: false, error: '该事件没有可选项' };
    }
    const options = def.choices.filter((choice) => {
      if (!choice.conditions) return true;
      const target = { scope: pending.scope, entityId: pending.entityId };
      const resolver = (path: string): number => readFeature(this.state, target, path);
      return evaluate(choice.conditions, resolver);
    });
    const picked =
      (choiceId ? options.find((choice) => choice.id === choiceId) : undefined) ??
      (choiceId
        ? null
        : pickChoice(this.state, { scope: pending.scope, entityId: pending.entityId }, options));
    if (!picked)
      return { ok: false, error: choiceId ? `没有可用选项 ${choiceId}` : '没有满足条件的选项' };

    const target = { scope: pending.scope, entityId: pending.entityId };
    const changes = [
      ...applyBaseEffects(this.state, this.content, def, target),
      ...resolveChoice(this.state, this.content, def, target, picked, this.rng),
    ];
    this.state.pendingChoices = this.state.pendingChoices.filter((item) => item !== pending);
    return {
      ok: true,
      summary: `抉择「${picked.label}」${changes.length > 0 ? `：${changes.join('；')}` : ''}`,
      refs: [{ kind: pending.scope, id: pending.entityId }],
    };
  }

  /** 统一的"事件结算"入口：玩家抉择会被挂起，其余按效用自动选。 */
  applyTrigger(def: EventDef, target: EventTarget, day: number): void {
    const isPlayer = target.scope === 'character' && target.entityId === this.state.playerId;
    if (def.choices && def.choices.length > 0 && isPlayer && this.stopAtChoices) {
      this.state.pendingChoices.push({
        id: `${def.id}@${target.entityId}@${day}`,
        eventId: def.id,
        scope: target.scope,
        entityId: target.entityId,
        day,
        expiresDay: day + CHOICE_WINDOW_DAYS,
      });
      const cooldown =
        def.cooldownDays > 0 ? def.cooldownDays : this.content.balance.events.defaultCooldownDays;
      this.state.cooldowns[`${def.id}@${target.entityId}`] = day + cooldown;
      this.record(
        'event',
        `${formatDate(day)} ${eventText(this.state, def, target).title}：等待你的决定`,
        [{ kind: target.scope, id: target.entityId }],
        def.id,
      );
      return;
    }

    const outcome = applyEvent(this.state, this.content, { def, target }, this.rng);
    const narrative = eventText(this.state, def, target);
    const details = outcome.changes.filter((line) => !line.startsWith('忽略未知路径'));
    this.record(
      'event',
      `${formatDate(day)} ${outcome.summary}`,
      [{ kind: target.scope, id: target.entityId }],
      def.id,
      [narrative.body, details.join('；')].filter((part) => part.length > 0).join('\n'),
    );
  }

  private fireDueEvents(day: number): void {
    const due = this.state.pendingEvents
      .filter((event) => event.day <= day && event.kind === 'event')
      .sort((a, b) => (a.day === b.day ? a.seq - b.seq : a.day - b.day));
    if (due.length === 0) return;

    this.state.pendingEvents = this.state.pendingEvents.filter((event) => !due.includes(event));
    for (const scheduled of due) {
      const def = this.content.events.find((event) => event.id === scheduled.refId);
      if (!def) continue;
      if (!scheduled.targetScope || !scheduled.targetEntityId) continue;
      const target = { scope: scheduled.targetScope, entityId: scheduled.targetEntityId };
      // 链条步序必须与内容声明一致，避免存档里残留的旧排程跳步执行。
      if (scheduled.chainStep !== undefined && def.chain?.step !== scheduled.chainStep) continue;
      this.applyTrigger(def, target, day);
    }
  }

  private record(
    kind:
      | 'event'
      | 'finance'
      | 'policy'
      | 'command'
      | 'trade'
      | 'milestone'
      | 'death'
      | 'war'
      | 'month',
    summary: string,
    refs: readonly { kind: string; id: string }[],
    causeEventId: string | null = null,
    body: string | null = null,
    importance?: 'major' | 'minor',
  ): void {
    const typed = refs.map((ref) => ({ type: ref.kind, id: ref.id }));
    const chronicle = composeChronicle(this.state, summary, typed);
    this.history.append({
      day: this.state.clock.day,
      phase: Phase.Action,
      kind,
      summary: chronicle.summary,
      refs: typed,
      causeEventId,
      subject: chronicle.subject,
      place: chronicle.place,
      body,
      importance: importance ?? (kind === 'trade' || kind === 'finance' ? 'minor' : 'major'),
    });
  }

  private syncCounters(): void {
    this.state.rngCounters = this.rng.counterStore();
  }
}

export function totalPopulation(state: WorldState): number {
  let total = 0;
  for (const region of Object.values(state.regions)) total += region.population;
  return total;
}
