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
import { applyEvent, collectCandidates, selectTriggered } from './EventEngine';
import { formatDate, GameClock, Phase, settlementPoints, type SettlementPoint } from './GameClock';
import { History } from './History';
import { Random } from './Random';
import { applyTiers, computeTiers } from './SimulationTier';
import {
  hashWorld,
  monthKeyOf,
  type SettleContext,
  type WorldContent,
  type WorldState,
} from './WorldState';
import { isQuarterEnd, isYearEnd } from './GameClock';
import { settleMonthlyDecisions, settleCountryDecisions } from '../systems/npc/DecisionSystem';
import { monthlyOrganizationSettlement } from '../systems/organization/OrganizationSystem';
import { settleMonthlyProduction } from '../systems/economy/ProductionSystem';
import { settleMonthlyMarket } from '../systems/economy/MarketSystem';
import { settleMonthlyTrade } from '../systems/economy/TradeSystem';
import { settleMonthlyCharacters } from '../systems/character/CharacterSystem';
import { settleYearlyDemography } from '../systems/character/Demography';
import {
  createPlayerCharacter,
  type CharacterCreationChoice,
  type CharacterCreationResult,
} from '../systems/character/CharacterCreator';
import { settleMonthlyCountry } from '../systems/country/CountrySystem';
import { runPolicyRound } from '../systems/country/PolicySystem';
import { settleMonthlyMilitary } from '../systems/military/WarSystem';

export class GameEngine {
  readonly content: WorldContent;
  readonly state: WorldState;
  private readonly clock: GameClock;
  private rng: Random;
  private readonly history: History;

  constructor(state: WorldState, content: WorldContent) {
    this.state = state;
    this.content = content;
    this.clock = new GameClock(state.clock);
    this.rng = Random.fromSnapshot({ seed: state.meta.seed, counters: state.rngCounters });
    this.history = new History(state.history);
  }

  get day(): number {
    return this.state.clock.day;
  }

  /** 状态指纹：确定性回归与存档校验用。 */
  hash(): string {
    return hashWorld(this.state);
  }

  /** 唯一写入口。 */
  dispatch(command: Command): CommandResult {
    const result = applyCommand(this.state, command, this.content);
    if (result.ok) {
      const summary = result.summary ?? command.kind;
      this.record('command', `${formatDate(this.day)} ${summary}`, result.refs ?? []);
    } else {
      this.syncCounters();
    }
    return result;
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
      const round = runPolicyRound(this.state, ctx, ctx.day, this.content.balance.policy);
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
      const outcome = applyEvent(this.state, this.content, trigger);
      this.record(
        'event',
        `${formatDate(ctx.day)} ${outcome.summary}`,
        [{ kind: trigger.target.scope, id: trigger.target.entityId }],
        trigger.def.id,
      );
    }
  }

  private onWrapUpPhase(ctx: SettleContext): void {
    // 季度：分层重算（L1/L2/L3）。
    if (isQuarterEnd(ctx.day)) {
      const report = computeTiers(this.state, this.content);
      applyTiers(this.state, report);
    }

    // 年度：衰老、死亡、遗产、婚姻与出生（M4.1 人口学）。
    if (isYearEnd(ctx.day)) {
      const yearly = settleYearlyDemography(this.state, this.content, ctx);
      for (const id of yearly.deaths) {
        this.record('death', `${formatDate(ctx.day)} ${id} 去世`, [{ kind: 'character', id }]);
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
    }

    // 月度摘要：一行总览，方便 UI 与 100 年快进后的"年年有记录"。
    const activeOrgs = Object.values(this.state.organizations).filter(
      (org) => org.lifecycle !== 'dissolved',
    ).length;
    this.state.stats.orgCountSum += activeOrgs;
    this.state.stats.orgCountSamples += 1;
    this.record(
      'milestone',
      `${formatDate(ctx.day)} 月度结算：人口 ${totalPopulation(this.state)}，组织 ${activeOrgs}，历史 ${this.state.history.length} 条`,
      [],
    );
  }

  /* ---------------------------------------------------------------- */

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
      const outcome = applyEvent(this.state, this.content, { def, target });
      this.record(
        'event',
        `${formatDate(day)} ${outcome.summary}`,
        [{ kind: target.scope, id: target.entityId }],
        def.id,
      );
    }
  }

  private record(
    kind: 'event' | 'finance' | 'policy' | 'command' | 'trade' | 'milestone' | 'death',
    summary: string,
    refs: readonly { kind: string; id: string }[],
    causeEventId: string | null = null,
  ): void {
    this.history.append({
      day: this.state.clock.day,
      phase: Phase.Action,
      kind,
      summary,
      refs: refs.map((ref) => ({ type: ref.kind, id: ref.id })),
      causeEventId,
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
