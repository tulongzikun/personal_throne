/**
 * 玩家命令总线（铁律 2：唯一写入口）。
 *
 * 命令是**纯数据**：`{ kind, ...参数 }`。它既能被 UI 直接构造，也能写进存档、
 * 回放日志与测试用例。执行逻辑（`applyCommand`）负责校验、限额与审计，
 * 但不推进时间——时间只由 GameClock 推进（铁律 5）。
 *
 * 约定：
 * - 校验失败返回 `{ ok: false, error }`，绝不抛异常，也不留下半成品修改；
 * - 成功返回 `{ ok: true, summary, refs }`，由 GameEngine 写入 History；
 * - 金额单位为铜币整数，负数或非整数一律拒绝。
 */

import type {
  AttributeKey,
  Contract,
  CountryId,
  GoodId,
  OrgId,
  OrgStrategy,
  PolicyVector,
  RegionId,
  CharacterId,
  WorldContent,
  WorldState,
} from './WorldState';
import { marketKeyOf, sortedIds } from './WorldState';
import {
  breakContract,
  characterLabel,
  nextContractId,
  signLoanContract,
} from '../systems/organization/ContractSystem';
import { priceOf } from '../systems/economy/MarketSystem';
import { settleTravelEncounter } from '../systems/region/RegionNews';
import { switchCareer } from '../systems/character/Career';
import { declareWar, isAtWar, makePeace } from '../systems/military/WarSystem';
import {
  canClaimLeadership,
  moveShares,
  rankedHolders,
  roundShare,
  sharePrice,
} from '../systems/organization/Shares';
import { shareOf } from '../systems/organization/Organization';
import { applyForOffice, capitalOf, influenceOf } from '../systems/country/Offices';
import {
  lobbyBonus,
  purchaseFactor,
  saleFactor,
  tradeCarryCapacity,
} from '../systems/character/SkillEffects';
import {
  actionBlocker,
  heal,
  neighborsOf,
  REST_HEALTH,
  spendAction,
} from '../systems/character/Activity';
import { bumpRelation, setRelation } from '../systems/character/Relations';

export interface CommandBase {
  /** 命令唯一序号，由 GameEngine 分配；用于幂等与审计。 */
  seq?: number;
  /** 提交者，默认玩家。 */
  actorId?: string;
}

export type Command =
  | (CommandBase & { kind: 'invest'; orgId: OrgId; amount: number })
  | (CommandBase & { kind: 'recruit'; orgId: OrgId; count: number })
  | (CommandBase & { kind: 'set_strategy'; orgId: OrgId; strategy: OrgStrategy })
  | (CommandBase & { kind: 'take_loan'; orgId: OrgId; amount: number })
  | (CommandBase & { kind: 'repay_debt'; orgId: OrgId; amount: number })
  | (CommandBase & { kind: 'buy_asset'; orgId: OrgId; amount: number })
  | (CommandBase & {
      kind: 'open_route';
      orgId: OrgId;
      regionId: RegionId;
      goodId: GoodId;
    })
  | (CommandBase & {
      kind: 'lobby';
      countryId: CountryId;
      policy: keyof PolicyVector;
      delta: number;
    })
  | (CommandBase & {
      kind: 'sign_contract';
      orgId: OrgId;
      contractKind: 'supply' | 'transport' | 'employment' | 'loan';
      counterpartyId: string;
      goodId?: GoodId;
      quantity: number;
      unitPrice: number;
      months: number;
    })
  | (CommandBase & { kind: 'break_contract'; orgId: OrgId; contractId: string })
  | (CommandBase & { kind: 'restructure'; orgId: OrgId })
  | (CommandBase & { kind: 'sell_asset'; orgId: OrgId; amount: number })
  | (CommandBase & {
      kind: 'change_career';
      characterId: CharacterId;
      classId: 'merchant' | 'mercenary' | 'politician';
    })
  | (CommandBase & {
      kind: 'train';
      skill: string;
    })
  /** 对挂起的玩家事件做出抉择；不传 choiceId 表示按效用择优。 */
  | (CommandBase & { kind: 'choose'; choiceId?: string })
  | (CommandBase & { kind: 'declare_war'; targetCountryId: CountryId })
  | (CommandBase & { kind: 'offer_peace'; targetCountryId: CountryId })
  | (CommandBase & { kind: 'levy_army'; units: number })
  | (CommandBase & { kind: 'march_army'; regionId: RegionId })
  /** 从他人（或未登记份额）手里买入份额，价格按当前估值折算。 */
  | (CommandBase & { kind: 'buy_shares'; orgId: OrgId; share: number })
  /** 把自己持有的份额卖回给最大的能付得起钱的股东，或退回未登记份额。 */
  | (CommandBase & { kind: 'sell_shares'; orgId: OrgId; share: number })
  /** 持股超过现任领袖且达到 34% 时接管字号。 */
  | (CommandBase & { kind: 'claim_leadership'; orgId: OrgId })
  /** 谋求本国公职（分数过线且压过现任者才会成功）。 */
  | (CommandBase & { kind: 'seek_office'; countryId: CountryId; officeId: string })
  | (CommandBase & { kind: 'move'; regionId: RegionId })
  | (CommandBase & {
      kind: 'trade_goods';
      goodId: GoodId;
      units: number;
      targetRegionId?: RegionId;
    })
  | (CommandBase & { kind: 'seek_audience'; characterId: CharacterId })
  | (CommandBase & { kind: 'gift'; characterId: CharacterId; amount: number })
  | (CommandBase & { kind: 'gossip' })
  | (CommandBase & { kind: 'rest' })
  | (CommandBase & { kind: 'deposit'; orgId?: OrgId; amount: number })
  | (CommandBase & { kind: 'withdraw'; orgId?: OrgId; amount: number })
  /** 赴宴：只能在首都使用，换取与统治者/大臣的关系。 */
  | (CommandBase & { kind: 'attend_court' })
  /** 考察市场：在异地花 1 点行动力，30 天内看得见该地实时价格。 */
  | (CommandBase & { kind: 'inspect_market'; regionId: RegionId });

export type CommandKind = Command['kind'];

export interface CommandResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly summary?: string;
  readonly refs?: readonly { readonly kind: string; readonly id: string }[];
  /** 移动类命令实际消耗的在途天数；UI 可据此推进时间。 */
  readonly travelDays?: number;
}

const POLICY_MIN = 0;
const POLICY_MAX = 1;

/** 玩家对国家的控制权：本国统治者，或持有本国公职（rank ≥ 2）。 */
function canCommandCountry(state: WorldState, countryId: CountryId): boolean {
  const country = state.countries[countryId];
  if (!country) return false;
  if (country.rulerId === state.playerId) return true;
  return country.offices.some(
    (office) => office.holderId === state.playerId && office.influence >= 0.4,
  );
}

/** 玩家所属（效忠）的国家：所在地区所属国，否则按国籍取第一个。 */
function ownCountryOf(state: WorldState): WorldState['countries'][string] | null {
  const player = state.characters[state.playerId];
  const region = player ? state.regions[player.location.regionId] : null;
  if (region) {
    const country = state.countries[region.countryId];
    if (country) return country;
  }
  return null;
}

/** 玩家对组织的控制权：领袖，或持股 ≥ 20%。 */
function canControl(state: WorldState, orgId: OrgId): boolean {
  const org = state.organizations[orgId];
  if (!org) return false;
  if (org.leadership.leaderId === state.playerId) return true;
  return org.shares.some((share) => share.characterId === state.playerId && share.share >= 0.2);
}

function isAmount(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function fail(error: string): CommandResult {
  return { ok: false, error };
}

/** 校验并执行一条命令。纯状态变更 + 返回摘要，不做时间推进。 */
export function applyCommand(
  state: WorldState,
  command: Command,
  content: WorldContent,
): CommandResult {
  switch (command.kind) {
    case 'invest': {
      const org = state.organizations[command.orgId];
      if (!org) return fail(`组织 ${command.orgId} 不存在`);
      if (!canControl(state, org.id)) return fail('你没有该组织的控制权');
      const player = state.characters[state.playerId]!;
      if (player.regionId !== org.homeRegionId) {
        return fail(
          `签约要亲自到${org.name}的总部${state.regions[org.homeRegionId]?.name ?? ''}（你现在在${state.regions[player.regionId]?.name ?? ''}）`,
        );
      }
      if (!isAmount(command.amount)) return fail('投资额必须是正整数铜币');
      if (org.cash < command.amount)
        return fail(`现金不足：需要 ${command.amount}，现有 ${org.cash}`);
      // 投资：现金转为资产（不计利润），规模随投入增长。
      org.cash -= command.amount;
      org.assets += command.amount;
      org.scale += command.amount / Math.max(1, org.assets);
      return {
        ok: true,
        summary: `${org.name} 追加投资 ${command.amount} 铜币`,
        refs: [{ kind: 'organization', id: org.id }],
      };
    }

    case 'recruit': {
      const org = state.organizations[command.orgId];
      if (!org) return fail(`组织 ${command.orgId} 不存在`);
      if (!canControl(state, org.id)) return fail('你没有该组织的控制权');
      if (!Number.isInteger(command.count) || command.count <= 0) {
        return fail('招募人数必须是正整数');
      }
      const perHead = Math.max(1, Math.round(org.payrollMonthly / Math.max(1, org.members)));
      const cost = perHead * command.count;
      if (org.cash < cost) return fail(`现金不足：招募需要 ${cost}，现有 ${org.cash}`);
      org.cash -= cost;
      org.members += command.count;
      org.payrollMonthly += perHead * command.count;
      return {
        ok: true,
        summary: `${org.name} 招募 ${command.count} 人，花费 ${cost} 铜币`,
        refs: [{ kind: 'organization', id: org.id }],
      };
    }

    case 'set_strategy': {
      const org = state.organizations[command.orgId];
      if (!org) return fail(`组织 ${command.orgId} 不存在`);
      if (!canControl(state, org.id)) return fail('你没有该组织的控制权');
      if (org.strategy === command.strategy) return { ok: true, summary: '战略未变化' };
      const before = org.strategy;
      org.strategy = command.strategy;
      return {
        ok: true,
        summary: `${org.name} 战略由 ${before} 调整为 ${command.strategy}`,
        refs: [{ kind: 'organization', id: org.id }],
      };
    }

    case 'take_loan': {
      const org = state.organizations[command.orgId];
      if (!org) return fail(`组织 ${command.orgId} 不存在`);
      if (!canControl(state, org.id)) return fail('你没有该组织的控制权');
      if (!isAmount(command.amount)) return fail('借款额必须是正整数铜币');
      const capacity = Math.max(0, Math.round(org.assets * 0.5) - org.liabilities);
      if (command.amount > capacity) {
        return fail(`超出授信：可借 ${capacity}，申请 ${command.amount}`);
      }
      org.cash += command.amount;
      org.liabilities += command.amount;
      const contract = signLoanContract(
        state,
        content,
        org.id,
        command.amount,
        Math.min(12, content.balance.contract.maxLoanMonths),
      );
      return {
        ok: true,
        summary: `${org.name} 借款 ${command.amount} 铜币（契约 ${contract.id}）`,
        refs: [{ kind: 'organization', id: org.id }],
      };
    }

    case 'repay_debt': {
      const org = state.organizations[command.orgId];
      if (!org) return fail(`组织 ${command.orgId} 不存在`);
      if (!canControl(state, org.id)) return fail('你没有该组织的控制权');
      if (!isAmount(command.amount)) return fail('还款额必须是正整数铜币');
      if (org.liabilities <= 0) return fail('该组织没有未偿债务');
      const amount = Math.min(command.amount, org.liabilities, org.cash);
      if (amount <= 0) return fail('现金不足，无法还款');
      org.cash -= amount;
      org.liabilities -= amount;
      // 提前还款同步冲减贷款契约本金，避免契约继续按期扣款造成重复偿付。
      let remaining = amount;
      for (const contractId of sortedIds(state.contracts)) {
        const contract = state.contracts[contractId];
        if (!contract || contract.status !== 'open' || contract.kind !== 'loan') continue;
        if (contract.fromOrgId !== org.id) continue;
        const applied = Math.min(remaining, contract.principal);
        contract.principal -= applied;
        remaining -= applied;
        if (contract.principal <= 0) contract.status = 'fulfilled';
        if (remaining <= 0) break;
      }
      return {
        ok: true,
        summary: `${org.name} 偿还债务 ${amount} 铜币`,
        refs: [{ kind: 'organization', id: org.id }],
      };
    }

    case 'buy_asset': {
      const org = state.organizations[command.orgId];
      if (!org) return fail(`组织 ${command.orgId} 不存在`);
      if (!canControl(state, org.id)) return fail('你没有该组织的控制权');
      if (!isAmount(command.amount)) return fail('购置额必须是正整数铜币');
      if (org.cash < command.amount) return fail(`现金不足：需要 ${command.amount}`);
      org.cash -= command.amount;
      org.assets += command.amount;
      return {
        ok: true,
        summary: `${org.name} 购置固定资产 ${command.amount} 铜币`,
        refs: [{ kind: 'organization', id: org.id }],
      };
    }

    case 'open_route': {
      const org = state.organizations[command.orgId];
      if (!org) return fail(`组织 ${command.orgId} 不存在`);
      if (!canControl(state, org.id)) return fail('你没有该组织的控制权');
      const region = state.regions[command.regionId];
      if (!region) return fail(`地区 ${command.regionId} 不存在`);
      const good = content.goods.find((candidate) => candidate.id === command.goodId);
      if (!good) return fail(`未知商品 ${command.goodId}`);
      const market = state.markets[marketKeyOf(command.regionId, command.goodId)];
      if (!market) return fail(`地区 ${command.regionId} 没有商品 ${command.goodId} 的市场`);
      const reachable =
        org.homeRegionId === command.regionId ||
        regionHasPath(state, org.homeRegionId, command.regionId);
      if (!reachable) return fail('该地区与母地区之间没有可用商路');
      const cost = Math.max(50, Math.round(org.payrollMonthly * 0.2));
      if (org.cash < cost) return fail(`现金不足：开辟商路需要 ${cost}`);
      org.cash -= cost;
      // 商路体现为运力上限提升，实际贸易量由 TradeSystem 按缺口结算。
      market.importCapacity += Math.round(cost / 10);
      market.routeOwnerId = org.id;
      org.tradeInvestment += cost;
      return {
        ok: true,
        summary: `${org.name} 在 ${region.name} 开辟 ${command.goodId} 商路，花费 ${cost} 铜币`,
        refs: [
          { kind: 'organization', id: org.id },
          { kind: 'region', id: region.id },
        ],
      };
    }

    case 'sign_contract': {
      const org = state.organizations[command.orgId];
      if (!org) return fail(`组织 ${command.orgId} 不存在`);
      if (!canControl(state, org.id)) return fail('你没有该组织的控制权');
      const signer = state.characters[state.playerId]!;
      if (signer.regionId !== org.homeRegionId) {
        return fail(
          `签约要亲自到${org.name}的总部${state.regions[org.homeRegionId]?.name ?? ''}（你现在在${state.regions[signer.regionId]?.name ?? ''}）`,
        );
      }
      if (!Number.isInteger(command.months) || command.months < 1 || command.months > 24) {
        return fail('契约期限必须是 1–24 个月');
      }
      if (!isAmount(command.quantity)) return fail('契约数量必须是正整数');
      if (!Number.isFinite(command.unitPrice) || command.unitPrice < 0) {
        return fail('契约单价必须是非负有限数');
      }
      const months = command.months;
      const endDay = state.clock.day + months * 30;

      if (command.contractKind === 'loan') {
        const capacity = Math.max(0, Math.round(org.assets * 0.5) - org.liabilities);
        if (command.quantity > capacity) {
          return fail(`超出授信：可借 ${capacity}，申请 ${command.quantity}`);
        }
        org.cash += command.quantity;
        org.liabilities += command.quantity;
        const contract = signLoanContract(state, content, org.id, command.quantity, months);
        return {
          ok: true,
          summary: `${org.name} 与 ${characterLabel(state, contract.toOrgId)} 签订贷款契约 ${contract.id}：本金 ${command.quantity}，${months} 个月`,
          refs: [{ kind: 'organization', id: org.id }],
        };
      }

      if (command.contractKind === 'employment') {
        const character = state.characters[command.counterpartyId];
        if (!character || !character.alive) return fail('雇员不存在或已故');
        if (character.organizationId === org.id) return fail('该人物已经是本组织成员');
        if (command.unitPrice < 1) return fail('雇佣月薪必须至少 1 铜币');
        const value = command.unitPrice * months;
        if (org.cash < Math.round(value * 0.2)) {
          return fail(`现金不足：雇佣契约需要至少 ${Math.round(value * 0.2)} 铜币保证金`);
        }
        const id = nextContractId(state);
        state.contracts[id] = {
          id,
          kind: 'employment',
          parties: [org.id, character.id],
          fromOrgId: org.id,
          toOrgId: character.id,
          startDay: state.clock.day,
          endDay,
          value,
          status: 'open',
          goodId: null,
          quantity: 1,
          unitPrice: command.unitPrice,
          penaltyRate: content.balance.contract.defaultPenaltyRate,
          rateMonthly: 0,
          principal: 0,
          collateral: 0,
          nextDueDay: state.clock.day + 30,
          installments: months,
          paidInstallments: 0,
        };
        character.organizationId = org.id;
        return {
          ok: true,
          summary: `${org.name} 雇佣 ${character.name}，月薪 ${command.unitPrice}，${months} 个月（契约 ${id}）`,
          refs: [
            { kind: 'organization', id: org.id },
            { kind: 'character', id: character.id },
          ],
        };
      }

      const counterparty = state.organizations[command.counterpartyId];
      if (!counterparty || counterparty.lifecycle === 'dissolved') {
        return fail('契约对方组织不存在或已解散');
      }
      if (counterparty.id === org.id) return fail('不能与自己签约');
      if (!regionHasPath(state, org.homeRegionId, counterparty.homeRegionId)) {
        return fail('双方所在地区之间没有可用商路');
      }
      const good = command.goodId
        ? content.goods.find((candidate) => candidate.id === command.goodId)
        : undefined;
      if (!good) return fail('供货/运输契约必须指定合法商品');
      const unitPrice =
        command.unitPrice > 0 ? command.unitPrice : priceOf(state, org.homeRegionId, good.id);
      const sellerMarket = state.markets[marketKeyOf(org.homeRegionId, good.id)];
      const buyerMarket = state.markets[marketKeyOf(counterparty.homeRegionId, good.id)];
      if (!sellerMarket || !buyerMarket) return fail('双方地区缺少该商品市场');
      const value = unitPrice * command.quantity * months;
      if (counterparty.cash < Math.round(value * 0.1)) {
        return fail('对方现金不足，无法担保该契约');
      }
      const id = nextContractId(state);
      const contract: Contract = {
        id,
        kind: command.contractKind,
        parties: [org.id, counterparty.id],
        fromOrgId: org.id,
        toOrgId: counterparty.id,
        startDay: state.clock.day,
        endDay,
        value,
        status: 'open',
        goodId: good.id,
        quantity: command.quantity,
        unitPrice,
        penaltyRate: content.balance.contract.defaultPenaltyRate,
        rateMonthly: 0,
        principal: 0,
        collateral: 0,
        nextDueDay: state.clock.day + 30,
        installments: months,
        paidInstallments: 0,
      };
      state.contracts[id] = contract;
      return {
        ok: true,
        summary: `${org.name} 与 ${counterparty.name} 签订${command.contractKind === 'supply' ? '供货' : '运输'}契约 ${id}：${good.name} ×${command.quantity}/月，单价 ${unitPrice}，${months} 个月`,
        refs: [
          { kind: 'organization', id: org.id },
          { kind: 'organization', id: counterparty.id },
        ],
      };
    }

    case 'break_contract': {
      const org = state.organizations[command.orgId];
      if (!org) return fail(`组织 ${command.orgId} 不存在`);
      if (!canControl(state, org.id)) return fail('你没有该组织的控制权');
      const result = breakContract(state, content, command.contractId, org.id);
      if (!result.ok) return fail(result.error ?? '解约失败');
      return {
        ok: true,
        summary: `${org.name} 解除契约 ${command.contractId}，支付违约金 ${result.penalty ?? 0}`,
        refs: [{ kind: 'organization', id: org.id }],
      };
    }

    case 'restructure': {
      const org = state.organizations[command.orgId];
      if (!org) return fail(`组织 ${command.orgId} 不存在`);
      if (!canControl(state, org.id)) return fail('你没有该组织的控制权');
      if (org.lifecycle === 'dissolved') return fail('组织已解散');
      if (org.lifecycle === 'restructuring') return fail('组织已处于重组期');
      const haircut = content.balance.contract.liquidationHaircut;
      const sell = Math.round(org.assets * 0.25);
      org.assets -= sell;
      org.cash += Math.round(sell * (1 - haircut));
      const cut = Math.max(0, Math.round(org.members * 0.1));
      const perHead = Math.max(1, Math.round(org.payrollMonthly / Math.max(1, org.members)));
      org.members = Math.max(1, org.members - cut);
      org.payrollMonthly = perHead * org.members;
      const pay = Math.min(org.cash, org.liabilities);
      org.cash -= pay;
      org.liabilities -= pay;
      for (const contract of Object.values(state.contracts)) {
        if (contract.status === 'open' && contract.kind === 'loan') {
          contract.nextDueDay = Math.max(contract.nextDueDay, state.clock.day + 90);
        }
      }
      org.lifecycle = 'restructuring';
      org.graceUntilDay = 0;
      org.distressMonths = 0;
      org.restructureUntilDay =
        state.clock.day + Math.max(1, content.balance.contract.restructureMonths) * 30;
      state.stats.restructurings += 1;
      return {
        ok: true,
        summary: `${org.name} 主动重组：出售资产 ${sell}，裁员 ${cut}，偿债 ${pay}`,
        refs: [{ kind: 'organization', id: org.id }],
      };
    }

    case 'train': {
      if (command.actorId && command.actorId !== state.playerId) return fail('只能训练自己');
      const player = state.characters[state.playerId];
      if (!player) return fail('玩家不存在');
      if (!player.alive) return fail('你已经不在人世');
      const blocked = actionBlocker(state, state.playerId);
      if (blocked) return fail(blocked);
      const current = player.skills[command.skill] ?? 0;
      const attr = player.attributes[skillAttribute(command.skill)] ?? 10;
      const cap = 3 + Math.floor(attr / 3);
      if (current >= cap) return fail(`${command.skill} 已到天赋上限（${cap}）`);
      const cost = 150 + current * 120;
      if (player.wealth < cost) return fail(`学费不足：需要 ${cost}，现有 ${player.wealth}`);
      player.wealth -= cost;
      player.skills[command.skill] = current + 1;
      spendAction(player, 1);
      return {
        ok: true,
        summary: `你花 ${cost} 铜币训练 ${command.skill}，提升到 ${current + 1}`,
        refs: [{ kind: 'character', id: player.id }],
      };
    }

    case 'change_career': {
      if (command.characterId !== state.playerId) return fail('只能为自己转行');
      const result = switchCareer(state, command.characterId, command.classId, state.clock.day);
      if (!result.ok) return fail(result.error ?? '转行失败');
      return {
        ok: true,
        summary: result.message ?? '转行',
        refs: [{ kind: 'character', id: command.characterId }],
      };
    }
    case 'sell_asset': {
      const org = state.organizations[command.orgId];
      if (!org) return fail(`组织 ${command.orgId} 不存在`);
      if (!canControl(state, org.id)) return fail('你没有该组织的控制权');
      if (!isAmount(command.amount)) return fail('出售额必须是正整数铜币');
      if (command.amount > org.assets) return fail(`资产不足：现有 ${org.assets}`);
      const haircut = content.balance.contract.liquidationHaircut;
      const proceeds = Math.round(command.amount * (1 - haircut));
      org.assets -= command.amount;
      org.cash += proceeds;
      const pay = Math.min(org.cash, org.liabilities);
      org.cash -= pay;
      org.liabilities -= pay;
      return {
        ok: true,
        summary: `${org.name} 出售资产 ${command.amount}，回款 ${proceeds}，偿债 ${pay}`,
        refs: [{ kind: 'organization', id: org.id }],
      };
    }

    case 'lobby': {
      const country = state.countries[command.countryId];
      if (!country) return fail(`国家 ${command.countryId} 不存在`);
      if (!Number.isFinite(command.delta) || command.delta === 0) {
        return fail('游说强度必须是非零有限数');
      }
      if (Math.abs(command.delta) > 0.2) return fail('单次游说幅度不得超过 0.2');
      const player = state.characters[state.playerId]!;
      const capital = capitalOf(state, country.id);
      const seated = influenceOf(state, player.id, country.id) >= 0.4;
      if (!seated && capital && player.regionId !== capital) {
        return fail(
          `游说要在${country.name}首都${state.regions[capital]?.name ?? ''}当面谈（远程游说需要至少 0.4 影响力）`,
        );
      }
      const effectiveDelta = command.delta + Math.sign(command.delta) * lobbyBonus(player);
      const current = country.policies[command.policy];
      if (typeof current !== 'number') return fail(`未知政策 ${command.policy}`);
      const cost = Math.max(100, Math.round(Math.abs(effectiveDelta) * 5_000));
      const org = Object.values(state.organizations).find(
        (candidate) => canControl(state, candidate.id) && candidate.cash >= cost,
      );
      if (!org) return fail(`没有可用于游说支出的组织（需要 ${cost} 铜币）`);
      org.cash -= cost;
      const next = Math.min(
        POLICY_MAX,
        Math.max(POLICY_MIN, Number((current + effectiveDelta).toFixed(4))),
      );
      country.policies[command.policy] = next;
      return {
        ok: true,
        summary: `${org.name} 游说 ${country.name}：${command.policy} ${current} → ${next}（说服加成 +${lobbyBonus(player).toFixed(2)}），花费 ${cost}`,
        refs: [
          { kind: 'country', id: country.id },
          { kind: 'organization', id: org.id },
        ],
      };
    }

    case 'choose': {
      // 抉择由 GameEngine 结算（需要 rng 与历史记录），这里只做占位以防漏接。
      return fail('抉择请通过 GameEngine.dispatch 提交');
    }
    case 'declare_war': {
      const target = state.countries[command.targetCountryId];
      if (!target) return fail(`国家 ${command.targetCountryId} 不存在`);
      const own = ownCountryOf(state);
      if (!own) return fail('你还没有效忠的国家');
      if (own.id === target.id) return fail('不能对自己宣战');
      if (!canCommandCountry(state, own.id)) return fail('宣战需要统治权或高级公职');
      const result = declareWar(state, content, own.id, target.id);
      if (!result.ok) return fail(result.error ?? '宣战失败');
      return {
        ok: true,
        summary: result.summary ?? '已宣战',
        refs: [
          { kind: 'country', id: own.id },
          { kind: 'country', id: target.id },
        ],
      };
    }
    case 'offer_peace': {
      const target = state.countries[command.targetCountryId];
      if (!target) return fail(`国家 ${command.targetCountryId} 不存在`);
      const own = ownCountryOf(state);
      if (!own) return fail('你还没有效忠的国家');
      if (!canCommandCountry(state, own.id)) return fail('议和需要统治权或高级公职');
      if (!isAtWar(state, own.id, target.id)) return fail('你们并不在交战');
      const outcome = makePeace(state, own.id, target.id, {
        day: state.clock.day,
        periodKey: 'manual',
        phase: 2,
        rng: { nextFloat: () => 0.5 } as never,
      });
      return {
        ok: true,
        summary: outcome.summary,
        refs: [
          { kind: 'country', id: own.id },
          { kind: 'country', id: target.id },
        ],
      };
    }
    case 'levy_army': {
      const own = ownCountryOf(state);
      if (!own) return fail('你还没有效忠的国家');
      if (!canCommandCountry(state, own.id)) return fail('征兵需要统治权或高级公职');
      if (!isAmount(command.units)) return fail('征兵人数必须是正整数');
      const cost = command.units * content.balance.war.levyCostPerSoldier;
      if (own.treasury < cost) return fail(`国库不足（需要 ${cost} 铜币）`);
      const army = state.armies[`army:${own.id}`];
      if (!army) return fail('没有可用的军队建制');
      if (command.units > own.population * 0.02) return fail('单次征兵超过人口 2%，国力承受不住');
      own.treasury -= cost;
      army.size += command.units;
      return {
        ok: true,
        summary: `征召 ${command.units} 人，耗银 ${cost}`,
        refs: [{ kind: 'country', id: own.id }],
      };
    }
    case 'march_army': {
      const own = ownCountryOf(state);
      if (!own) return fail('你还没有效忠的国家');
      if (!canCommandCountry(state, own.id)) return fail('调兵需要统治权或高级公职');
      const army = state.armies[`army:${own.id}`];
      if (!army) return fail('没有可用的军队建制');
      const region = state.regions[command.regionId];
      if (!region) return fail(`地区 ${command.regionId} 不存在`);
      army.targetRegionId = region.id;
      army.stance = 'march';
      return {
        ok: true,
        summary: `军队开往 ${region.name}`,
        refs: [
          { kind: 'country', id: own.id },
          { kind: 'region', id: region.id },
        ],
      };
    }

    case 'buy_shares': {
      const org = state.organizations[command.orgId];
      if (!org || org.lifecycle === 'dissolved') return fail('该组织不存在或已解散');
      const player = state.playerId;
      const buyer = state.characters[player];
      if (!buyer) return fail('找不到玩家人物');
      if (!Number.isFinite(command.share) || command.share <= 0) return fail('份额必须是正数');
      const share = roundShare(command.share);
      const available = roundShare(1 - shareOf(org, player));
      if (share > available + 1e-9) {
        return fail(`可购入的份额不足：最多 ${(available * 100).toFixed(1)}%`);
      }
      const price = sharePrice(org, share);
      if (buyer.wealth < price) {
        return fail(`现金不足：需要 ${price} 铜币，现有 ${buyer.wealth}`);
      }
      let remaining = share;
      const paid = new Map<CharacterId, number>();
      for (const holder of rankedHolders(org)) {
        if (remaining <= 0) break;
        if (holder.characterId === player || holder.share <= 0) continue;
        const take = roundShare(Math.min(holder.share, remaining));
        if (take <= 0) continue;
        moveShares(org, holder.characterId, player, take);
        paid.set(holder.characterId, (paid.get(holder.characterId) ?? 0) + price * (take / share));
        remaining = roundShare(remaining - take);
      }
      if (remaining > 0) moveShares(org, null, player, remaining);
      buyer.wealth -= price;
      for (const [sellerId, amount] of paid) {
        const seller = state.characters[sellerId];
        if (seller) seller.wealth += Math.round(amount);
      }
      return {
        ok: true,
        summary: `${org.name}：买入 ${(share * 100).toFixed(1)}% 股份，花费 ${price} 铜币（现持 ${(shareOf(org, player) * 100).toFixed(1)}%）`,
        refs: [{ kind: 'organization', id: org.id }],
      };
    }

    case 'sell_shares': {
      const org = state.organizations[command.orgId];
      if (!org || org.lifecycle === 'dissolved') return fail('该组织不存在或已解散');
      const player = state.playerId;
      if (!Number.isFinite(command.share) || command.share <= 0) return fail('份额必须是正数');
      const share = roundShare(command.share);
      const owned = shareOf(org, player);
      if (share > owned + 1e-9) {
        return fail(`你只持有 ${(owned * 100).toFixed(1)}%，卖不了这么多`);
      }
      const price = sharePrice(org, share);
      const buyer = rankedHolders(org).find((entry) => {
        if (entry.characterId === player) return false;
        const character = state.characters[entry.characterId];
        return character !== undefined && character.wealth >= price;
      });
      if (buyer) {
        const character = state.characters[buyer.characterId];
        if (character) character.wealth -= price;
        moveShares(org, player, buyer.characterId, share);
      } else {
        moveShares(org, player, null, share);
      }
      const me = state.characters[player];
      if (buyer && me) me.wealth += price;
      return {
        ok: true,
        summary: buyer
          ? `${org.name}：卖出 ${(share * 100).toFixed(1)}% 股份，收到 ${price} 铜币`
          : `${org.name}：${(share * 100).toFixed(1)}% 股份回到未登记池，无人接手`,
        refs: [{ kind: 'organization', id: org.id }],
      };
    }

    case 'claim_leadership': {
      const org = state.organizations[command.orgId];
      if (!org) return fail('该组织不存在');
      const verdict = canClaimLeadership(org, state.playerId);
      if (!verdict.ok) return fail(verdict.reason);
      org.leadership.leaderId = state.playerId;
      return {
        ok: true,
        summary: `你接管了 ${org.name}，成为新的领袖`,
        refs: [{ kind: 'organization', id: org.id }],
      };
    }

    case 'seek_office': {
      const application = applyForOffice(
        state,
        state.playerId,
        command.countryId,
        command.officeId,
      );
      if (!application.ok) return fail(application.reason);
      return {
        ok: true,
        summary: application.reason,
        refs: [{ kind: 'country', id: command.countryId }],
      };
    }

    case 'move': {
      const blocked = actionBlocker(state, state.playerId);
      if (blocked) return fail(blocked);
      const player = state.characters[state.playerId]!;
      const target = state.regions[command.regionId];
      if (!target) return fail('目标地区不存在');
      if (command.regionId === player.regionId) return fail('你已经在这里了');
      const hop = neighborsOf(state, player.regionId).find((link) => link.id === command.regionId);
      if (!hop) return fail('只能先移动到相邻地区（沿商路）');
      const fee = hop.days * 2;
      if (player.wealth < fee) return fail(`路费不足：需要 ${fee} 铜币`);
      player.wealth -= fee;
      spendAction(player, 2);
      player.regionId = command.regionId;
      player.location = { regionId: command.regionId, site: 'road', sinceDay: state.clock.day };
      const encounter = settleTravelEncounter(state, player, command.regionId);
      return {
        ok: true,
        summary: `你沿商路走了 ${hop.days} 天抵达${target.name}${encounter ? `；${encounter}` : ''}`,
        refs: [{ kind: 'region', id: command.regionId }],
        travelDays: hop.days,
      };
    }

    case 'trade_goods': {
      const blocked = actionBlocker(state, state.playerId);
      if (blocked) return fail(blocked);
      const player = state.characters[state.playerId]!;
      const capacity = tradeCarryCapacity(player);
      const units = Math.max(1, Math.round(command.units));
      if (units > capacity) {
        return fail(`一次最多贩 ${capacity} 单位（贸易每级 +1）`);
      }
      const sourceKey = marketKeyOf(player.regionId, command.goodId);
      const source = state.markets[sourceKey];
      if (!source) return fail('本地没有这种货');
      if (source.stock < units) return fail(`本地库存只有 ${source.stock} 单位`);
      const links = neighborsOf(state, player.regionId);
      const candidates = (
        command.targetRegionId ? links.filter((link) => link.id === command.targetRegionId) : links
      )
        .map((link) => {
          const market = state.markets[marketKeyOf(link.id, command.goodId)];
          return market
            ? {
                link,
                market,
                margin: market.price * saleFactor(player) - source.price * purchaseFactor(player),
              }
            : null;
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .sort((a, b) => b.margin - a.margin);
      const best = candidates[0];
      if (!best) return fail('没有可去的相邻市场');
      const buy = Math.round(source.price * purchaseFactor(player)) * units;
      // 运费按每单位每天 0.05 铜计：4 天路程约 0.2 铜/单位，量大利薄。
      const freight = Math.max(1, Math.round(best.link.days * units * 0.05));
      if (player.wealth < buy + freight) {
        return fail(`本钱不足：需要 ${buy + freight} 铜币`);
      }
      const revenue = Math.round(best.market.price * saleFactor(player)) * units;
      const profit = revenue - buy - freight;
      if (profit <= 0) return fail('这趟货不赚钱，换个地方或等价格变化');
      player.wealth += profit;
      source.stock -= units;
      best.market.stock += units;
      spendAction(player, 1);
      return {
        ok: true,
        summary: `你贩了 ${units} 单位${content.goods.find((good) => good.id === command.goodId)?.name ?? command.goodId}（贸易 ${player.skills.trade ?? 0} 级让利 ${Math.round((1.05 - purchaseFactor(player)) * 100)}%），净赚 ${profit} 铜币`,
        refs: [{ kind: 'region', id: best.link.id }],
      };
    }

    case 'seek_audience': {
      const blocked = actionBlocker(state, state.playerId);
      if (blocked) return fail(blocked);
      const player = state.characters[state.playerId]!;
      const target = state.characters[command.characterId];
      if (!target || !target.alive) return fail('对方不在人世');
      if (target.regionId !== player.regionId) return fail('对方不在本地');
      if (target.id === player.id) return fail('不需要拜会自己');
      bumpRelation(state, player.id, target.id, 'ally', 6);
      spendAction(player, 1);
      return {
        ok: true,
        summary: `你拜会了${target.name}，关系更近了一步`,
        refs: [{ kind: 'character', id: target.id }],
      };
    }

    case 'gift': {
      const blocked = actionBlocker(state, state.playerId);
      if (blocked) return fail(blocked);
      if (!Number.isInteger(command.amount) || command.amount <= 0) return fail('礼物金额不合法');
      const player = state.characters[state.playerId]!;
      const target = state.characters[command.characterId];
      if (!target || !target.alive) return fail('对方不在人世');
      if (target.regionId !== player.regionId) return fail('对方不在本地');
      if (player.wealth < command.amount) return fail('现金不足');
      player.wealth -= command.amount;
      target.wealth += command.amount;
      const gain = Math.max(1, Math.min(25, Math.round(command.amount / 40)));
      setRelation(state, player.id, target.id, 'ally', gain);
      spendAction(player, 1);
      return {
        ok: true,
        summary: `你送给${target.name}价值 ${command.amount} 铜币的礼物（关系 +${gain}）`,
        refs: [{ kind: 'character', id: target.id }],
      };
    }

    case 'gossip': {
      const blocked = actionBlocker(state, state.playerId);
      if (blocked) return fail(blocked);
      const player = state.characters[state.playerId]!;
      const neighbors = Object.values(state.characters)
        .filter(
          (other) => other.alive && other.regionId === player.regionId && other.id !== player.id,
        )
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      const names = neighbors.slice(0, 2).map((other) => other.name);
      const insight = player.skills.insight ?? 0;
      const cap = 3 + Math.floor((player.attributes.perception ?? 10) / 3);
      if (insight < cap) player.skills.insight = insight + 1;
      spendAction(player, 1);
      return {
        ok: true,
        summary:
          names.length > 0
            ? `你在市集上打听风声，听说${names.join('、')}最近有些麻烦（洞察 +${insight < cap ? 1 : 0}）`
            : '你在市集上转了一圈，只听到些无关紧要的闲话',
        refs: [],
      };
    }

    case 'attend_court': {
      const blocked = actionBlocker(state, state.playerId);
      if (blocked) return fail(blocked);
      const player = state.characters[state.playerId]!;
      const own = ownCountryOf(state);
      if (!own) return fail('你还没有效忠的国家');
      const capital = capitalOf(state, own.id);
      if (!capital || player.regionId !== capital) {
        return fail(
          `王庭不在${state.regions[player.regionId]?.name ?? '此地'}：赴宴要去${state.regions[capital ?? '']?.name ?? '首都'}`,
        );
      }
      if (player.wealth < 50) return fail('赴宴至少要 50 铜币的置装费');
      const hosts = [own.rulerId, ...own.offices.map((office) => office.holderId)]
        .map((id) => state.characters[id])
        .filter((character): character is NonNullable<typeof character> =>
          Boolean(character?.alive),
        );
      player.wealth -= 50;
      spendAction(player, 1);
      let gain = 0;
      for (const host of hosts.slice(0, 2)) {
        bumpRelation(state, player.id, host.id, 'ally', 8);
        gain += 8;
      }
      const hostName = hosts[0]?.name ?? own.name;
      return {
        ok: true,
        summary: `你在${own.name}王庭赴宴，与${hostName}等人寒暄（关系 +${gain || 8}，花费 50 铜）`,
        refs: [{ kind: 'country', id: own.id }],
      };
    }

    case 'inspect_market': {
      const blocked = actionBlocker(state, state.playerId);
      if (blocked) return fail(blocked);
      const player = state.characters[state.playerId]!;
      const region = state.regions[command.regionId];
      if (!region) return fail('目标地区不存在');
      if (player.regionId !== command.regionId) {
        return fail('考察市场要人到了当地才行（先「前往」再考察）');
      }
      if ((state.inspections[region.id] ?? 0) > state.clock.day) {
        return fail('你最近已经考察过这里了');
      }
      state.inspections[region.id] = state.clock.day + 30;
      spendAction(player, 1);
      return {
        ok: true,
        summary: `你花了一天摸清${region.name}的行情：未来 30 天这里的价格对你是透明的`,
        refs: [{ kind: 'region', id: region.id }],
      };
    }

    case 'rest': {
      const blocked = actionBlocker(state, state.playerId);
      if (blocked && !blocked.includes('健康')) return fail(blocked);
      const player = state.characters[state.playerId]!;
      const gained = heal(player, REST_HEALTH);
      spendAction(player, 0);
      return {
        ok: true,
        summary: `你歇了几日，健康恢复 ${gained} 点（当前 ${player.health}）`,
        refs: [{ kind: 'character', id: player.id }],
      };
    }

    case 'deposit':
    case 'withdraw': {
      const player = state.characters[state.playerId]!;
      if (!Number.isInteger(command.amount) || command.amount <= 0) return fail('金额不合法');
      const banks = Object.values(state.organizations)
        .filter(
          (org) =>
            org.type === 'bank' &&
            org.lifecycle !== 'dissolved' &&
            (command.orgId ? org.id === command.orgId : org.homeRegionId === player.regionId),
        )
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      const bank = banks[0];
      if (!bank) return fail('本地没有银行');
      const held = player.deposits[bank.id] ?? 0;
      if (command.kind === 'deposit') {
        if (player.wealth < command.amount) return fail('现金不足');
        player.wealth -= command.amount;
        player.deposits[bank.id] = held + command.amount;
        bank.cash += command.amount;
        return {
          ok: true,
          summary: `你在${bank.name}存入 ${command.amount} 铜币`,
          refs: [{ kind: 'organization', id: bank.id }],
        };
      }
      if (held < command.amount) return fail(`存款只有 ${held} 铜币`);
      if (bank.cash < command.amount) return fail('银行现金不足');
      player.deposits[bank.id] = held - command.amount;
      bank.cash -= command.amount;
      player.wealth += command.amount;
      return {
        ok: true,
        summary: `你从${bank.name}取出 ${command.amount} 铜币`,
        refs: [{ kind: 'organization', id: bank.id }],
      };
    }

    default: {
      const exhaustive: never = command;
      return fail(`未知命令 ${(exhaustive as { kind?: string }).kind ?? '?'}`);
    }
  }
}

/** 地区之间是否存在商路连通（BFS，最多 4 跳）。 */
export function regionHasPath(state: WorldState, from: RegionId, to: RegionId): boolean {
  if (from === to) return true;
  const visited = new Set<RegionId>([from]);
  let frontier: RegionId[] = [from];
  for (let hop = 0; hop < 4; hop += 1) {
    const next: RegionId[] = [];
    for (const id of frontier) {
      const region = state.regions[id];
      if (!region) continue;
      for (const link of region.links) {
        if (link.to === to) return true;
        if (!visited.has(link.to)) {
          visited.add(link.to);
          next.push(link.to);
        }
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return false;
}

/** 技能对应的主属性（六维），用于训练上限。 */
const SKILL_ATTRIBUTE: Readonly<Record<string, AttributeKey>> = {
  trade: 'intellect',
  negotiation: 'charisma',
  persuasion: 'charisma',
  intimidation: 'willpower',
  insight: 'perception',
  law: 'intellect',
  melee: 'physique',
  tactics: 'intellect',
  stealth: 'agility',
  appraisal: 'perception',
  craft: 'agility',
};

function skillAttribute(skill: string): AttributeKey {
  return SKILL_ATTRIBUTE[skill] ?? 'intellect';
}

/** 命令的可读描述，供 UI 按钮与日志使用。 */
export function describeCommand(command: Command): string {
  switch (command.kind) {
    case 'invest':
      return `投资 ${command.amount}`;
    case 'recruit':
      return `招募 ${command.count} 人`;
    case 'set_strategy':
      return `改用 ${command.strategy} 战略`;
    case 'take_loan':
      return `借款 ${command.amount}`;
    case 'repay_debt':
      return `还款 ${command.amount}`;
    case 'buy_asset':
      return `购置资产 ${command.amount}`;
    case 'open_route':
      return `开辟商路 → ${command.regionId}/${command.goodId}`;
    case 'lobby':
      return `游说 ${command.countryId}.${command.policy} ${command.delta > 0 ? '+' : ''}${command.delta}`;
    case 'sign_contract':
      return `签订 ${command.contractKind} 契约 ${command.counterpartyId}`;
    case 'break_contract':
      return `解除契约 ${command.contractId}`;
    case 'restructure':
      return '债务重组';
    case 'sell_asset':
      return `出售资产 ${command.amount}`;
    case 'change_career':
      return `转行为 ${command.classId}`;
    case 'train':
      return `训练 ${command.skill}`;
    case 'choose':
      return command.choiceId ? `抉择 ${command.choiceId}` : '做出抉择';
    case 'declare_war':
      return `向 ${command.targetCountryId} 宣战`;
    case 'offer_peace':
      return `与 ${command.targetCountryId} 议和`;
    case 'levy_army':
      return `征兵 ${command.units} 人`;
    case 'march_army':
      return `军队开往 ${command.regionId}`;
    case 'buy_shares':
      return `买入 ${(command.share * 100).toFixed(1)}% 股份`;
    case 'sell_shares':
      return `卖出 ${(command.share * 100).toFixed(1)}% 股份`;
    case 'claim_leadership':
      return '接管字号';
    case 'seek_office':
      return `谋求 ${command.countryId} 的 ${command.officeId} 公职`;
    case 'move':
      return `前往 ${command.regionId}`;
    case 'trade_goods':
      return `贩运 ${command.units} 单位 ${command.goodId}`;
    case 'seek_audience':
      return '拜会某人';
    case 'gift':
      return `送礼 ${command.amount} 铜币`;
    case 'gossip':
      return '打听风声';
    case 'rest':
      return '休息';
    case 'deposit':
      return `存入 ${command.amount} 铜币`;
    case 'withdraw':
      return `取出 ${command.amount} 铜币`;
    case 'attend_court':
      return '赴宴';
    case 'inspect_market':
      return `考察 ${command.regionId} 的市场`;
  }
}
