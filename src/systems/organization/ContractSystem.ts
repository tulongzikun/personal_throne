/**
 * 契约系统（M2）：供货 / 运输 / 贷款 / 雇佣。
 *
 * 共同规则：
 * - 每份契约有到期日、分期数、违约金率；每月到期日执行一期；
 * - 到期未付先给 1 个月宽限（只顺延一次），再次违约才判 defaulted；
 * - 违约方按未履行金额支付违约金（进对方现金，不足则记负债），并计入 stats；
 * - 所有金额为整数铜币，所有遍历按契约 ID 稳定排序。
 */

import type {
  CharacterId,
  OrgId,
  SettleContext,
  WorldContent,
  WorldState,
} from '../../core/WorldState';
import { marketKeyOf, sortedIds } from '../../core/WorldState';

import type { LifecycleEvent } from './Lifecycle';
export type ContractEvent = LifecycleEvent;

export interface ContractResult {
  readonly events: readonly ContractEvent[];
  readonly defaulted: readonly string[];
  readonly fulfilled: readonly string[];
}

export function nextContractId(state: WorldState): string {
  state.contractSeq += 1;
  let id = `ct_${state.contractSeq}`;
  while (state.contracts[id]) {
    state.contractSeq += 1;
    id = `ct_${state.contractSeq}`;
  }
  return id;
}

export function settleMonthlyContracts(
  state: WorldState,
  content: WorldContent,
  ctx: SettleContext,
): ContractResult {
  const events: ContractEvent[] = [];
  const defaulted: string[] = [];
  const fulfilled: string[] = [];

  for (const contractId of sortedIds(state.contracts)) {
    const contract = state.contracts[contractId];
    if (!contract || contract.status !== 'open') continue;
    if (ctx.day < contract.nextDueDay) continue;

    const from = state.organizations[contract.fromOrgId];
    const to = contract.kind === 'employment' ? undefined : state.organizations[contract.toOrgId];
    if (!from) {
      contract.status = 'cancelled';
      continue;
    }

    const scheduled = contract.startDay + 30 * (contract.paidInstallments + 1);
    const graceUsed = contract.nextDueDay > scheduled;

    switch (contract.kind) {
      case 'loan': {
        const per = Math.round(contract.principal / contract.installments);
        const interest = Math.round(contract.principal * contract.rateMonthly);
        const principalDue =
          contract.paidInstallments + 1 >= contract.installments
            ? Math.max(0, contract.principal - per * (contract.installments - 1))
            : per;
        from.liabilities += interest;
        const due = principalDue + interest;
        if (from.cash >= due) {
          from.cash -= due;
          from.liabilities = Math.max(0, from.liabilities - due);
          contract.paidInstallments += 1;
          contract.nextDueDay += 30;
          events.push({
            kind: 'finance',
            summary: `${ctx.day} ${from.name} 偿还贷款 ${contract.id} 第 ${contract.paidInstallments}/${contract.installments} 期 ${due}`,
            refs: [{ kind: 'organization', id: from.id }],
          });
          if (contract.paidInstallments >= contract.installments) {
            contract.status = 'fulfilled';
            fulfilled.push(contract.id);
          }
        } else if (!graceUsed) {
          contract.nextDueDay = scheduled + 30;
          events.push({
            kind: 'finance',
            summary: `${ctx.day} ${from.name} 贷款 ${contract.id} 到期未付 ${due}，进入 1 个月宽限`,
            refs: [{ kind: 'organization', id: from.id }],
          });
        } else {
          defaultContract(state, content, contract, from, due, events);
          defaulted.push(contract.id);
        }
        break;
      }
      case 'employment': {
        const character = state.characters[contract.toOrgId];
        const wage = Math.max(1, contract.unitPrice * contract.quantity);
        if (!character || !character.alive) {
          contract.status = 'cancelled';
          break;
        }
        if (from.cash >= wage) {
          from.cash -= wage;
          character.wealth += wage;
          contract.paidInstallments += 1;
          contract.nextDueDay += 30;
          if (contract.paidInstallments >= contract.installments) contract.status = 'fulfilled';
        } else if (!graceUsed) {
          contract.nextDueDay = scheduled + 30;
        } else {
          defaultContract(state, content, contract, from, wage, events);
          defaulted.push(contract.id);
        }
        break;
      }
      case 'supply': {
        const amount = contract.quantity * contract.unitPrice;
        const sourceMarket = contract.goodId
          ? state.markets[marketKeyOf(from.homeRegionId, contract.goodId)]
          : undefined;
        const targetMarket =
          contract.goodId && to
            ? state.markets[marketKeyOf(to.homeRegionId, contract.goodId)]
            : undefined;
        if (!sourceMarket || !targetMarket) {
          contract.status = 'cancelled';
          break;
        }
        if (sourceMarket.stock < contract.quantity) {
          if (!graceUsed) {
            contract.nextDueDay = scheduled + 30;
          } else {
            defaultContract(state, content, contract, from, amount, events);
            defaulted.push(contract.id);
          }
          break;
        }
        if (to && to.cash < amount) {
          if (!graceUsed) {
            contract.nextDueDay = scheduled + 30;
          } else {
            defaultContract(state, content, contract, to, amount, events);
            defaulted.push(contract.id);
          }
          break;
        }
        sourceMarket.stock -= contract.quantity;
        targetMarket.stock += contract.quantity;
        if (to) {
          to.cash -= amount;
          from.cash += amount;
          from.tradeRevenue += amount;
          state.stats.tradeRevenue += amount;
        }
        contract.paidInstallments += 1;
        contract.nextDueDay += 30;
        events.push({
          kind: 'trade',
          summary: `${ctx.day} 供货契约 ${contract.id}：${from.name} → ${to?.name ?? contract.toOrgId} ${contract.quantity} 单位 ${contract.goodId}，货款 ${amount}`,
          refs: [
            { kind: 'organization', id: from.id },
            { kind: 'organization', id: to?.id ?? from.id },
          ],
        });
        if (contract.paidInstallments >= contract.installments) contract.status = 'fulfilled';
        break;
      }
      case 'transport': {
        const fee = Math.max(1, contract.quantity * contract.unitPrice);
        if (from.cash >= fee) {
          from.cash -= fee;
          from.tradeCost += fee;
          state.stats.tradeCost += fee;
          if (to) to.cash += fee;
          contract.paidInstallments += 1;
          contract.nextDueDay += 30;
          if (contract.paidInstallments >= contract.installments) contract.status = 'fulfilled';
        } else if (!graceUsed) {
          contract.nextDueDay = scheduled + 30;
        } else {
          defaultContract(state, content, contract, from, fee, events);
          defaulted.push(contract.id);
        }
        break;
      }
      default:
        // M1 遗留的 trade/service 契约：到期即视为履行，避免旧存档报错。
        if (ctx.day >= contract.endDay) {
          contract.status = 'fulfilled';
          fulfilled.push(contract.id);
        }
        break;
    }
  }

  return { events, defaulted, fulfilled };
}

function defaultContract(
  state: WorldState,
  content: WorldContent,
  contract: WorldState['contracts'][string],
  debtor: WorldState['organizations'][string],
  due: number,
  events: ContractEvent[],
): void {
  const penalty = Math.max(
    content.balance.contract.minPenalty,
    Math.round(Math.max(due, contract.value) * contract.penaltyRate),
  );
  contract.status = 'defaulted';
  // 违约金优先用现金赔付给守约方，不足部分记入违约方负债。
  const creditorId = contract.fromOrgId === debtor.id ? contract.toOrgId : contract.fromOrgId;
  const creditor = state.organizations[creditorId];
  const paidNow = Math.min(debtor.cash, penalty);
  debtor.cash -= paidNow;
  if (creditor && creditor.id !== debtor.id) creditor.cash += paidNow;
  debtor.liabilities += penalty - paidNow;
  let seized = 0;
  let seizedProceeds = 0;
  if (contract.collateral > 0 && debtor.assets > 0) {
    seized = Math.min(debtor.assets, contract.collateral);
    seizedProceeds = Math.round(seized * (1 - content.balance.contract.liquidationHaircut));
    debtor.assets -= seized;
    const pay = Math.min(debtor.liabilities, seizedProceeds);
    debtor.liabilities -= pay;
    seizedProceeds = pay;
  }
  state.stats.contractDefaults += 1;
  events.push({
    kind: 'finance',
    summary: `${contract.id} 违约：${debtor.name} 未付 ${due}，违约金 ${penalty} 计入负债${seized > 0 ? `，处置抵押物 ${seized} 回款 ${seizedProceeds} 偿债` : ''}`,
    refs: [{ kind: 'organization', id: debtor.id }],
  });
}

/** 主动解约：解约方支付违约金，契约立即失效。 */
export function breakContract(
  state: WorldState,
  content: WorldContent,
  contractId: string,
  actorOrgId: OrgId,
): { ok: boolean; error?: string; penalty?: number } {
  const contract = state.contracts[contractId];
  if (!contract) return { ok: false, error: '契约不存在' };
  if (contract.status !== 'open') return { ok: false, error: '契约已结束' };
  if (contract.fromOrgId !== actorOrgId && contract.toOrgId !== actorOrgId) {
    return { ok: false, error: '不是契约当事方' };
  }
  const remainingShare =
    contract.installments > 0
      ? Math.max(0, 1 - contract.paidInstallments / contract.installments)
      : 1;
  const remaining = Math.round(contract.value * remainingShare);
  const penalty = Math.max(
    content.balance.contract.minPenalty,
    Math.round(remaining * contract.penaltyRate),
  );
  const actor = state.organizations[actorOrgId];
  if (!actor) return { ok: false, error: '组织不存在' };
  const pay = Math.min(actor.cash, penalty);
  actor.cash -= pay;
  actor.liabilities += penalty - pay;
  const otherId = contract.fromOrgId === actorOrgId ? contract.toOrgId : contract.fromOrgId;
  const other = state.organizations[otherId];
  if (other) other.cash += pay;
  contract.status = 'cancelled';
  state.stats.contractDefaults += 1;
  return { ok: true, penalty };
}

export function signLoanContract(
  state: WorldState,
  content: WorldContent,
  fromOrgId: OrgId,
  amount: number,
  months: number,
): WorldState['contracts'][string] {
  const rate = content.balance.contract.loanRateMonthly;
  const id = nextContractId(state);
  const bankId = sortedIds(state.organizations).find((id) => {
    const candidate = state.organizations[id];
    return candidate?.type === 'bank' && id !== fromOrgId && candidate.lifecycle !== 'dissolved';
  });
  const bank = bankId ? state.organizations[bankId] : undefined;
  const borrower = state.organizations[fromOrgId];
  state.contracts[id] = {
    id,
    kind: 'loan',
    parties: [fromOrgId, bank?.id ?? fromOrgId],
    fromOrgId,
    toOrgId: bank?.id ?? fromOrgId,
    startDay: state.clock.day,
    endDay: state.clock.day + months * 30,
    value: amount,
    status: 'open',
    goodId: null,
    quantity: 1,
    unitPrice: amount,
    penaltyRate: content.balance.contract.defaultPenaltyRate,
    rateMonthly: rate,
    principal: amount,
    collateral: Math.min(borrower?.assets ?? 0, Math.round(amount * 1.2)),
    nextDueDay: state.clock.day + 30,
    installments: months,
    paidInstallments: 0,
  };
  return state.contracts[id];
}

export function characterLabel(state: WorldState, id: CharacterId): string {
  return state.characters[id]?.name ?? id;
}
