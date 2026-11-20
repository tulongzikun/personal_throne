/**
 * `组织`域的命令实现，由 `CommandBus.applyCommand` 分发。
 * 只做纯状态变更与校验，不推进时间；失败返回 `{ ok: false }`，不抛异常。
 */

import type { WorldState, WorldContent, Contract } from '../WorldState';
import type { CommandOf, CommandResult } from '../commandTypes';
import { priceOf } from '../../systems/economy/MarketSystem';
import {
  breakContract,
  characterLabel,
  nextContractId,
  signLoanContract,
} from '../../systems/organization/ContractSystem';
import { marketKeyOf, sortedIds } from '../WorldState';
import { canControl, fail, isAmount, regionHasPath } from '../commandHelpers';

export function invest(state: WorldState, command: CommandOf<'invest'>): CommandResult {
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
  if (org.cash < command.amount) return fail(`现金不足：需要 ${command.amount}，现有 ${org.cash}`);
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

export function recruit(state: WorldState, command: CommandOf<'recruit'>): CommandResult {
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

export function setStrategy(state: WorldState, command: CommandOf<'set_strategy'>): CommandResult {
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

export function takeLoan(
  state: WorldState,
  command: CommandOf<'take_loan'>,
  content: WorldContent,
): CommandResult {
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

export function repayDebt(state: WorldState, command: CommandOf<'repay_debt'>): CommandResult {
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

export function buyAsset(state: WorldState, command: CommandOf<'buy_asset'>): CommandResult {
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

export function openRoute(
  state: WorldState,
  command: CommandOf<'open_route'>,
  content: WorldContent,
): CommandResult {
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

export function signContract(
  state: WorldState,
  command: CommandOf<'sign_contract'>,
  content: WorldContent,
): CommandResult {
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

export function breakContractCmd(
  state: WorldState,
  command: CommandOf<'break_contract'>,
  content: WorldContent,
): CommandResult {
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

export function restructure(
  state: WorldState,
  command: CommandOf<'restructure'>,
  content: WorldContent,
): CommandResult {
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

export function sellAsset(
  state: WorldState,
  command: CommandOf<'sell_asset'>,
  content: WorldContent,
): CommandResult {
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
