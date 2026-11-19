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
import { switchCareer } from '../systems/character/Career';

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
    });

export type CommandKind = Command['kind'];

export interface CommandResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly summary?: string;
  readonly refs?: readonly { readonly kind: string; readonly id: string }[];
}

const POLICY_MIN = 0;
const POLICY_MAX = 1;

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
      const current = country.policies[command.policy];
      if (typeof current !== 'number') return fail(`未知政策 ${command.policy}`);
      const cost = Math.max(100, Math.round(Math.abs(command.delta) * 5_000));
      const org = Object.values(state.organizations).find(
        (candidate) => canControl(state, candidate.id) && candidate.cash >= cost,
      );
      if (!org) return fail(`没有可用于游说支出的组织（需要 ${cost} 铜币）`);
      org.cash -= cost;
      const next = Math.min(
        POLICY_MAX,
        Math.max(POLICY_MIN, Number((current + command.delta).toFixed(4))),
      );
      country.policies[command.policy] = next;
      return {
        ok: true,
        summary: `${org.name} 游说 ${country.name}：${command.policy} ${current} → ${next}，花费 ${cost}`,
        refs: [
          { kind: 'country', id: country.id },
          { kind: 'organization', id: org.id },
        ],
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
  }
}
