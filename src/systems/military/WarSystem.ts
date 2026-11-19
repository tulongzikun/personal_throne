/**
 * 军事：M1 只做"军队的维持与士气漂移"，不做战争（M6）。
 *
 * 每个国家按军费与人口折算常备军规模，驻扎在首都/最大城市；
 * 士气随国库与合法性变化，为后续 WarSystem 的真实会战提供输入。
 */

import type { SettleContext, WorldContent, WorldState } from '../../core/WorldState';
import { sortedIds } from '../../core/WorldState';

export interface ArmyUpdate {
  readonly countryId: string;
  readonly size: number;
  readonly morale: number;
}

export function settleMonthlyMilitary(
  state: WorldState,
  content: WorldContent,
  ctx: SettleContext,
): ArmyUpdate[] {
  const updates: ArmyUpdate[] = [];
  void content;

  for (const countryId of sortedIds(state.countries)) {
    const country = state.countries[countryId];
    if (!country) continue;

    const capital =
      country.regionIds
        .map((id) => state.regions[id])
        .filter((region): region is NonNullable<typeof region> => Boolean(region))
        .sort((a, b) => b.population - a.population)[0] ?? null;
    if (!capital) continue;

    const size = Math.max(50, Math.round(country.population * 0.004 + country.military * 8));
    const armyId = `army:${country.id}`;
    const moraleBase = 0.45 + country.legitimacy * 0.3 + (country.treasury > 0 ? 0.1 : -0.15);
    const morale = clamp01(
      moraleBase +
        (ctx.rng.nextFloat({ stream: 'army', entityId: country.id, periodKey: ctx.periodKey }) -
          0.5) *
          0.1,
    );

    state.armies[armyId] = {
      id: armyId,
      countryId: country.id,
      size,
      locationRegionId: capital.id,
      morale,
    };
    updates.push({ countryId: country.id, size, morale });
  }

  return updates;
}

export function totalArmySize(state: WorldState, countryId: string): number {
  return Object.values(state.armies)
    .filter((army) => army.countryId === countryId)
    .reduce((sum, army) => sum + army.size, 0);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number(value.toFixed(4))));
}
