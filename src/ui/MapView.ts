/**
 * 地图：纯 SVG 绘制 5 个地区与商路。
 *
 * 坐标直接来自 `Region.x/y`（内容层已经给出相对坐标系），
 * viewBox 按节点包围盒自动扩展，因此换一张世界地图无需改代码。
 */

import type { Region, RegionId, WorldState } from '../core/WorldState';
import { clear, fmtInt, svgEl } from './dom';
import { TERRAIN_LABELS } from './labels';

const COUNTRY_PALETTE = ['#d9b45b', '#5f8a6b', '#8f7bb5', '#b06a5a', '#6b8fb0'];

const TERRAIN_GLYPHS: Record<Region['terrain'], string> = {
  city: '◆',
  plains: '❖',
  mountains: '▲',
  coast: '≈',
  forest: '♣',
};

export function countryPalette(state: WorldState): ReadonlyMap<string, string> {
  const ids = Object.keys(state.countries).sort();
  return new Map(
    ids.map((id, index) => [id, COUNTRY_PALETTE[index % COUNTRY_PALETTE.length] ?? '#d9b45b']),
  );
}

interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
}

function boundsOf(regions: readonly Region[]): Bounds {
  if (regions.length === 0) return { minX: 0, minY: 0, width: 400, height: 400 };
  const xs = regions.map((region) => region.x);
  const ys = regions.map((region) => region.y);
  const minX = Math.min(...xs) - 85;
  const maxX = Math.max(...xs) + 85;
  const minY = Math.min(...ys) - 75;
  const maxY = Math.max(...ys) + 75;
  return { minX, minY, width: Math.max(220, maxX - minX), height: Math.max(220, maxY - minY) };
}

export class MapView {
  private readonly onSelect: (regionId: RegionId) => void;
  private readonly svg: SVGSVGElement;
  private readonly nodes = new Map<RegionId, SVGGElement>();
  private readonly populations = new Map<RegionId, SVGTextElement>();
  private selected: RegionId | null = null;

  constructor(host: HTMLElement, state: WorldState, onSelect: (regionId: RegionId) => void) {
    this.onSelect = onSelect;
    this.svg = this.build(state);
    clear(host);
    host.append(this.svg);
  }

  select(regionId: RegionId | null): void {
    this.selected = regionId;
    for (const [id, node] of this.nodes) {
      node.classList.toggle('is-selected', id === regionId);
    }
  }

  update(state: WorldState): void {
    for (const region of Object.values(state.regions)) {
      const node = this.nodes.get(region.id);
      const label = this.populations.get(region.id);
      if (!node) continue;
      node.setAttribute(
        'aria-label',
        `${region.name}，${TERRAIN_LABELS[region.terrain]}，人口 ${fmtInt(region.population)}`,
      );
      if (label) label.textContent = `人口 ${fmtInt(region.population)}`;
    }
    this.select(this.selected);
  }

  private build(state: WorldState): SVGSVGElement {
    const regions = Object.values(state.regions);
    const bounds = boundsOf(regions);
    const palette = countryPalette(state);
    const svg = svgEl('svg', {
      class: 'map',
      viewBox: `${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`,
      preserveAspectRatio: 'xMidYMid meet',
      role: 'group',
      'aria-label': '世界地图',
    });

    const defs = svgEl('defs');
    const gradient = svgEl('radialGradient', {
      id: 'map-sea-glow',
      cx: '50%',
      cy: '45%',
      r: '72%',
    });
    gradient.append(
      svgEl('stop', { offset: '0%', 'stop-color': '#2a231c' }),
      svgEl('stop', { offset: '60%', 'stop-color': '#171310' }),
      svgEl('stop', { offset: '100%', 'stop-color': '#0d0b09' }),
    );
    defs.append(gradient);
    svg.append(defs);

    svg.append(
      svgEl('rect', {
        class: 'map__sea',
        x: bounds.minX,
        y: bounds.minY,
        width: bounds.width,
        height: bounds.height,
        fill: 'url(#map-sea-glow)',
      }),
    );

    const grid = svgEl('g', { class: 'map__grid' });
    const step = 60;
    const startX = Math.floor(bounds.minX / step) * step;
    const startY = Math.floor(bounds.minY / step) * step;
    for (let x = startX; x <= bounds.minX + bounds.width; x += step) {
      grid.append(
        svgEl('line', {
          x1: x,
          y1: bounds.minY,
          x2: x,
          y2: bounds.minY + bounds.height,
        }),
      );
    }
    for (let y = startY; y <= bounds.minY + bounds.height; y += step) {
      grid.append(
        svgEl('line', {
          x1: bounds.minX,
          y1: y,
          x2: bounds.minX + bounds.width,
          y2: y,
        }),
      );
    }
    svg.append(grid);

    const linkLayer = svgEl('g', { class: 'map__links' });
    const seen = new Set<string>();
    for (const region of regions) {
      for (const link of region.links) {
        const target = state.regions[link.to];
        if (!target) continue;
        const key = [region.id, link.to].sort().join('~');
        if (seen.has(key)) continue;
        seen.add(key);
        const line = svgEl('line', {
          class: 'map__link',
          x1: region.x,
          y1: region.y,
          x2: target.x,
          y2: target.y,
        });
        const title = svgEl('title');
        title.textContent = `${region.name} ↔ ${target.name} · ${link.days} 日 · 运力 ${link.capacity}`;
        line.append(title);
        linkLayer.append(line);
      }
    }
    svg.append(linkLayer);

    const nodeLayer = svgEl('g', { class: 'map__nodes' });
    for (const region of [...regions].sort((a, b) => a.id.localeCompare(b.id))) {
      const color = palette.get(region.countryId) ?? '#d9b45b';
      const radius = 12 + Math.sqrt(region.population) / 55;
      const node = svgEl('g', {
        class: 'map__node',
        'data-region-id': region.id,
        tabindex: 0,
        role: 'button',
        'aria-label': `${region.name}，${TERRAIN_LABELS[region.terrain]}，人口 ${fmtInt(region.population)}`,
      });
      node.append(
        svgEl('circle', {
          class: 'map__halo',
          cx: region.x,
          cy: region.y,
          r: radius + 8,
          stroke: color,
        }),
        svgEl('circle', {
          class: 'map__ring',
          cx: region.x,
          cy: region.y,
          r: radius,
          stroke: color,
        }),
        svgEl('circle', {
          class: 'map__dot',
          cx: region.x,
          cy: region.y,
          r: Math.max(3, radius * 0.22),
          fill: color,
        }),
        svgEl('text', {
          class: 'map__glyph',
          x: region.x,
          y: region.y + 4,
          'text-anchor': 'middle',
          fill: color,
        }),
      );

      const glyph = node.querySelector<SVGTextElement>('.map__glyph');
      if (glyph) glyph.textContent = TERRAIN_GLYPHS[region.terrain];

      const name = svgEl('text', {
        class: 'map__name',
        x: region.x,
        y: region.y + radius + 18,
        'text-anchor': 'middle',
      });
      name.textContent = region.name;

      const population = svgEl('text', {
        class: 'map__pop',
        x: region.x,
        y: region.y + radius + 32,
        'text-anchor': 'middle',
      });
      population.textContent = `人口 ${fmtInt(region.population)}`;

      node.append(name, population);
      node.addEventListener('click', () => this.onSelect(region.id));
      node.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.onSelect(region.id);
        }
      });

      this.nodes.set(region.id, node);
      this.populations.set(region.id, population);
      nodeLayer.append(node);
    }
    svg.append(nodeLayer);

    return svg;
  }
}
