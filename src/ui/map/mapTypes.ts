import type { Region, RegionId } from '../../core/WorldState';

export interface RegionNode {
  readonly id: RegionId;
  readonly group: SVGGElement;
  readonly shape: SVGPathElement;
  readonly surface: SVGPathElement;
  readonly halo: SVGPathElement;
  readonly name: SVGTextElement;
  readonly pop: SVGTextElement;
  readonly radius: number;
  readonly squash: number;
}

export interface LinkView {
  readonly a: Region;
  readonly b: Region;
  readonly days: number;
  readonly capacity: number;
}

export interface Summary {
  readonly region: Region;
  readonly countryName: string;
  readonly terrain: string;
  readonly goods: readonly string[];
  readonly priceIndex: number;
  readonly stock: number;
}

export const CLIP_PREFIX = 'map-clip-';
