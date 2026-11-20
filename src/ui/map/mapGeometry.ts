import type { CountryId, Region, Terrain, WorldState } from '../../core/WorldState';

export const COUNTRY_PALETTE: readonly string[] = [
  '#d9b45b',
  '#5f8a6b',
  '#8f7bb5',
  '#b06a5a',
  '#6b8fb0',
];

export const TERRAIN_GLYPHS: Readonly<Record<Terrain, string>> = {
  city: '◆',
  plains: '❖',
  mountains: '▲',
  coast: '≈',
  forest: '♣',
};

export const GLYPH_LABELS = TERRAIN_GLYPHS;

/** 国家按 id 排序后依次取色，保证同一存档里颜色稳定。 */
export function countryPalette(state: WorldState): ReadonlyMap<CountryId, string> {
  const ids = Object.keys(state.countries).sort();
  const palette = new Map<CountryId, string>();
  ids.forEach((id, index) => {
    palette.set(id, COUNTRY_PALETTE[index % COUNTRY_PALETTE.length] ?? COUNTRY_PALETTE[0]!);
  });
  return palette;
}

/** 32 位字符串散列，用来给每个地区一个固定的形状相位。 */
export function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function boundsOf(regions: readonly Region[]): Bounds {
  if (regions.length === 0) return { x: 0, y: 0, width: 320, height: 320 };
  const xs = regions.map((region) => region.x);
  const ys = regions.map((region) => region.y);
  const minX = Math.min(...xs) - 85;
  const maxX = Math.max(...xs) + 85;
  const minY = Math.min(...ys) - 75;
  const maxY = Math.max(...ys) + 75;
  return {
    x: minX,
    y: minY,
    width: Math.max(220, maxX - minX),
    height: Math.max(220, maxY - minY),
  };
}

export function radiusOf(population: number): number {
  return 26 + Math.sqrt(Math.max(1, population)) / 22;
}

/** 每个地形一套半径轮廓：城市紧凑、平原铺开、山地尖锐、海岸起伏、森林扇贝。 */
export function shapeRadii(terrain: Terrain, base: number, phase: number, steps: number): number[] {
  const radii: number[] = [];
  for (let index = 0; index < steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    let factor: number;
    switch (terrain) {
      case 'city':
        factor = 1 + 0.05 * Math.cos(angle * 4 + phase) - 0.04;
        break;
      case 'plains':
        factor = 1.08 + 0.12 * Math.sin(angle * 2 + phase) - 0.16 * Math.abs(Math.sin(angle));
        break;
      case 'mountains':
        factor = index % 2 === 0 ? 1.22 : 0.82;
        factor += 0.08 * Math.sin(angle * 3 + phase);
        break;
      case 'coast':
        factor = 1 + 0.13 * Math.sin(angle * 3 + phase) + 0.08 * Math.sin(angle * 5 - phase);
        break;
      case 'forest':
        factor = 1 + 0.15 * Math.sin(angle * 6 + phase);
        break;
    }
    radii.push(base * factor);
  }
  return radii;
}

export function polygonPoints(region: Region, radii: readonly number[], squash: number): Point[] {
  return radii.map((radius, index) => {
    const angle = (index / radii.length) * Math.PI * 2 - Math.PI / 2;
    return {
      x: region.x + Math.cos(angle) * radius,
      y: region.y + Math.sin(angle) * radius * squash,
    };
  });
}

/** Catmull-Rom 转三次贝塞尔，得到柔和的地区轮廓。 */
export function smoothPath(points: readonly Point[]): string {
  if (points.length < 3) return '';
  const first = points[0]!;
  let path = `M ${first.x.toFixed(1)} ${first.y.toFixed(1)}`;
  for (let index = 0; index < points.length; index += 1) {
    const p0 = points[(index - 1 + points.length) % points.length]!;
    const p1 = points[index]!;
    const p2 = points[(index + 1) % points.length]!;
    const p3 = points[(index + 2) % points.length]!;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    path += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return `${path} Z`;
}

export function angularPath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  const head = points[0]!;
  const rest = points
    .slice(1)
    .map((point) => `L ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ');
  return `M ${head.x.toFixed(1)} ${head.y.toFixed(1)} ${rest} Z`;
}

export function shapePath(region: Region): { path: string; radius: number; squash: number } {
  const base = radiusOf(region.population);
  const phase = hashSeed(region.id) * Math.PI * 2;
  const steps = region.terrain === 'mountains' ? 14 : 18;
  const radii = shapeRadii(region.terrain, base, phase, steps);
  const squash = region.terrain === 'plains' ? 0.78 : region.terrain === 'mountains' ? 0.92 : 0.9;
  const points = polygonPoints(region, radii, squash);
  const path = region.terrain === 'mountains' ? angularPath(points) : smoothPath(points);
  return { path, radius: base, squash };
}
