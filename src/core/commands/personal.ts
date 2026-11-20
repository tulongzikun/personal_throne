/**
 * `个人`域的命令实现，由 `CommandBus.applyCommand` 分发。
 * 只做纯状态变更与校验，不推进时间；失败返回 `{ ok: false }`，不抛异常。
 */

import type { WorldState, WorldContent, CharacterId } from '../WorldState';
import type { CommandOf, CommandResult } from '../commandTypes';
import {
  REST_HEALTH,
  actionBlocker,
  heal,
  neighborsOf,
  spendAction,
} from '../../systems/character/Activity';
import { switchCareer } from '../../systems/character/Career';
import { bumpRelation, setRelation } from '../../systems/character/Relations';
import {
  purchaseFactor,
  saleFactor,
  tradeCarryCapacity,
} from '../../systems/character/SkillEffects';
import { capitalOf } from '../../systems/country/Offices';
import { shareOf } from '../../systems/organization/Organization';
import {
  canClaimLeadership,
  moveShares,
  rankedHolders,
  roundShare,
  sharePrice,
} from '../../systems/organization/Shares';
import { settleTravelEncounter } from '../../systems/region/RegionNews';
import { marketKeyOf } from '../WorldState';
import { SKILL_ATTRIBUTE, fail, ownCountryOf, skillAttribute } from '../commandHelpers';

export function train(state: WorldState, command: CommandOf<'train'>): CommandResult {
  if (command.actorId && command.actorId !== state.playerId) return fail('只能训练自己');
  if (!(command.skill in SKILL_ATTRIBUTE)) return fail(`没有「${command.skill}」这门手艺`);
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

export function changeCareer(
  state: WorldState,
  command: CommandOf<'change_career'>,
): CommandResult {
  if (command.characterId !== state.playerId) return fail('只能为自己转行');
  const result = switchCareer(state, command.characterId, command.classId, state.clock.day);
  if (!result.ok) return fail(result.error ?? '转行失败');
  return {
    ok: true,
    summary: result.message ?? '转行',
    refs: [{ kind: 'character', id: command.characterId }],
  };
}

export function choose(_state: WorldState, _command: CommandOf<'choose'>): CommandResult {
  // 抉择由 GameEngine 结算（需要 rng 与历史记录），这里只做占位以防漏接。
  return fail('抉择请通过 GameEngine.dispatch 提交');
}

export function buyShares(state: WorldState, command: CommandOf<'buy_shares'>): CommandResult {
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

export function sellShares(state: WorldState, command: CommandOf<'sell_shares'>): CommandResult {
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

export function claimLeadership(
  state: WorldState,
  command: CommandOf<'claim_leadership'>,
): CommandResult {
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

export function move(state: WorldState, command: CommandOf<'move'>): CommandResult {
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

export function tradeGoods(
  state: WorldState,
  command: CommandOf<'trade_goods'>,
  content: WorldContent,
): CommandResult {
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

export function seekAudience(
  state: WorldState,
  command: CommandOf<'seek_audience'>,
): CommandResult {
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

export function gift(state: WorldState, command: CommandOf<'gift'>): CommandResult {
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

export function gossip(state: WorldState, _command: CommandOf<'gossip'>): CommandResult {
  const blocked = actionBlocker(state, state.playerId);
  if (blocked) return fail(blocked);
  const player = state.characters[state.playerId]!;
  const neighbors = Object.values(state.characters)
    .filter((other) => other.alive && other.regionId === player.regionId && other.id !== player.id)
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

export function attendCourt(state: WorldState, _command: CommandOf<'attend_court'>): CommandResult {
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
    .filter((character): character is NonNullable<typeof character> => Boolean(character?.alive));
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

export function inspectMarket(
  state: WorldState,
  command: CommandOf<'inspect_market'>,
): CommandResult {
  const blocked = actionBlocker(state, state.playerId);
  if (blocked) return fail(blocked);
  const player = state.characters[state.playerId]!;
  const region = state.regions[command.regionId];
  if (!region) return fail('目标地区不存在');
  const here = player.regionId === command.regionId;
  const adjacent = (state.regions[player.regionId]?.links ?? []).some(
    (link) => link.to === command.regionId,
  );
  if (!here && !adjacent) {
    return fail('只能考察自己所在或相邻的地区（再远就得亲自跑一趟）');
  }
  if ((state.inspections[region.id] ?? 0) > state.clock.day) {
    return fail('你最近已经打听过这里了（30 天内有效）');
  }
  const fee = here ? 0 : 20;
  if (player.wealth < fee) return fail(`派伙计打听要 ${fee} 铜，你现在不够`);
  player.wealth -= fee;
  state.inspections[region.id] = state.clock.day + 30;
  spendAction(player, 1);
  const cost = fee > 0 ? `（花 ${fee} 铜打发伙计）` : '';
  return {
    ok: true,
    summary: `${here ? '你花了一天摸清' : '你先遣伙计打听'}${region.name}的行情${cost}：未来 30 天这里的价格对你是透明的`,
    refs: [{ kind: 'region', id: region.id }],
  };
}

export function rest(state: WorldState, _command: CommandOf<'rest'>): CommandResult {
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

export function depositOrWithdraw(
  state: WorldState,
  command: CommandOf<'deposit'> | CommandOf<'withdraw'>,
): CommandResult {
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
