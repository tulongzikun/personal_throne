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

import type { Command, CommandResult } from './commandTypes';
import type { WorldState, WorldContent } from './WorldState';
import { fail } from './commandHelpers';
import {
  breakContractCmd,
  buyAsset,
  invest,
  openRoute,
  recruit,
  repayDebt,
  restructure,
  sellAsset,
  setStrategy,
  signContract,
  takeLoan,
} from './commands/organization';
import {
  attendCourt,
  buyShares,
  changeCareer,
  choose,
  claimLeadership,
  depositOrWithdraw,
  gift,
  gossip,
  inspectMarket,
  move,
  rest,
  seekAudience,
  sellShares,
  tradeGoods,
  train,
} from './commands/personal';
import { declareWarCmd, levyArmy, marchArmy, offerPeace } from './commands/military';
import { lobby, seekOffice } from './commands/politics';

/**
 * 类型与校验工具在这里转出，保持既有 import 路径不变。
 */
export type { Command, CommandBase, CommandKind, CommandOf, CommandResult } from './commandTypes';
export { regionHasPath } from './commandHelpers';

/**
 * 原型链上的名字不能当 id 用：`state.regions['toString']` 会取到函数而不是地区，
 * 后续读 `.population` 得到 `undefined`，再参与算术就变成 NaN 污染整个世界。
 * 这里把这类字符串挡在入口，而不是在每个系统里各写一遍 `Object.hasOwn`。
 */
const RESERVED_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'toString',
  'toLocaleString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
]);

/** 命令里只允许"干净的标识符/枚举"作为字符串参数。 */
function isSafeToken(value: string): boolean {
  if (value.length === 0 || value.length > 128) return false;
  if (RESERVED_KEYS.has(value)) return false;
  // 逐字符判断控制字符类别，避免正则里的 \u0000- 触发 no-control-regex。
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

/** 入口体检：活人、有限数字、安全字符串。任何一条不过就整体拒绝。 */
function screenCommand(state: WorldState, command: Command): string | null {
  const actor = state.characters[state.playerId];
  if (!actor) return '找不到玩家角色';
  if (!actor.alive) return '你已经不在人世，无法再下达命令';
  for (const [key, value] of Object.entries(command as unknown as Record<string, unknown>)) {
    if (key === 'kind') continue;
    if (value === undefined || value === null) return `参数 ${key} 缺失`;
    if (typeof value === 'number' && !Number.isFinite(value)) return `参数 ${key} 不是有效数字`;
    if (typeof value === 'string' && !isSafeToken(value)) return `参数 ${key} 不是有效的标识`;
    if (typeof value === 'object') return `参数 ${key} 类型不合法`;
  }
  return null;
}

/** 校验并执行一条命令。纯状态变更 + 返回摘要，不做时间推进。 */
export function applyCommand(
  state: WorldState,
  command: Command,
  content: WorldContent,
): CommandResult {
  const rejected = screenCommand(state, command);
  if (rejected) return fail(rejected);
  switch (command.kind) {
    case 'invest':
      return invest(state, command);
    case 'recruit':
      return recruit(state, command);
    case 'set_strategy':
      return setStrategy(state, command);
    case 'take_loan':
      return takeLoan(state, command, content);
    case 'repay_debt':
      return repayDebt(state, command);
    case 'buy_asset':
      return buyAsset(state, command);
    case 'open_route':
      return openRoute(state, command, content);
    case 'sign_contract':
      return signContract(state, command, content);
    case 'break_contract':
      return breakContractCmd(state, command, content);
    case 'restructure':
      return restructure(state, command, content);
    case 'train':
      return train(state, command);
    case 'change_career':
      return changeCareer(state, command);
    case 'sell_asset':
      return sellAsset(state, command, content);
    case 'lobby':
      return lobby(state, command);
    case 'choose':
      return choose(state, command);
    case 'declare_war':
      return declareWarCmd(state, command, content);
    case 'offer_peace':
      return offerPeace(state, command);
    case 'levy_army':
      return levyArmy(state, command, content);
    case 'march_army':
      return marchArmy(state, command);
    case 'buy_shares':
      return buyShares(state, command);
    case 'sell_shares':
      return sellShares(state, command);
    case 'claim_leadership':
      return claimLeadership(state, command);
    case 'seek_office':
      return seekOffice(state, command);
    case 'move':
      return move(state, command);
    case 'trade_goods':
      return tradeGoods(state, command, content);
    case 'seek_audience':
      return seekAudience(state, command);
    case 'gift':
      return gift(state, command);
    case 'gossip':
      return gossip(state, command);
    case 'attend_court':
      return attendCourt(state, command);
    case 'inspect_market':
      return inspectMarket(state, command);
    case 'rest':
      return rest(state, command);
    case 'deposit':
      return depositOrWithdraw(state, command);
    case 'withdraw':
      return depositOrWithdraw(state, command);
    case 'end_month':
      // 结束本月要推进日历，由引擎自己处理；走到这里说明调用方绕过了 dispatch。
      return fail('结束本月必须经由引擎推进');
    default: {
      const exhaustive: never = command;
      return fail(`未知命令 ${(exhaustive as { kind?: string }).kind ?? '?'}`);
    }
  }
}

export function describeCommand(command: Command): string {
  switch (command.kind) {
    case 'end_month':
      return '结束本月';
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
