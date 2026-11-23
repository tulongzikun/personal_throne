/**
 * 命令的类型定义。命令是纯数据：既能由 UI 直接构造，也能写进存档与回放。
 */

import type {
  CharacterId,
  CountryId,
  GoodId,
  OrgId,
  OrgStrategy,
  PolicyVector,
  RegionId,
} from './WorldState';

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
  | (CommandBase & { kind: 'end_month' })
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

/** 取出某个 `kind` 对应的命令类型。 */
export type CommandOf<K extends CommandKind> = Extract<Command, { kind: K }>;
