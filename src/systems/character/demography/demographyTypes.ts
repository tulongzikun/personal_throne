import type { CharacterId } from '../../../core/WorldState';

export interface Marriage {
  readonly a: CharacterId;
  readonly b: CharacterId;
}

export interface EstateShare {
  readonly characterId: string;
  readonly heirs: readonly CharacterId[];
  readonly cash: number;
  readonly share: number;
}

export interface DemographyReport {
  readonly births: readonly CharacterId[];
  readonly marriages: readonly Marriage[];
  readonly deaths: readonly CharacterId[];
  readonly estates: readonly EstateShare[];
}
