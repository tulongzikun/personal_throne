/**
 * SVG 世界地图：五个地区各有地形轮廓与内部纹理，悬停/聚焦弹出地区摘要，
 * 商路按运力加粗，箭头指向净需求方（需要进口的那一端）。
 *
 * 纯 SVG + 确定性形状抖动，不依赖任何库，也不使用 Math.random。
 */

import type { CountryId, Region, RegionId, Terrain, WorldState } from '../core/WorldState';
import { fmtInt, svgEl } from './dom';
import { TERRAIN_LABELS, labelOf } from './labels';

export const COUNTRY_PALETTE: readonly string[] = [
  '#d9b45b',
  '#5f8a6b',
  '#8f7bb5',
  '#b06a5a',
  '#6b8fb0',
];

const TERRAIN_GLYPHS: Readonly<Record<Terrain, string>> = {
  city: '◆',
  plains: '❖',
  mountains: '▲',
  coast: '≈',
  forest: '♣',
};

const GLYPH_LABELS = TERRAIN_GLYPHS;

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
function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function boundsOf(regions: readonly Region[]): Bounds {
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

function radiusOf(population: number): number {
  return 26 + Math.sqrt(Math.max(1, population)) / 22;
}

/** 每个地形一套半径轮廓：城市紧凑、平原铺开、山地尖锐、海岸起伏、森林扇贝。 */
function shapeRadii(terrain: Terrain, base: number, phase: number, steps: number): number[] {
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

function polygonPoints(region: Region, radii: readonly number[], squash: number): Point[] {
  return radii.map((radius, index) => {
    const angle = (index / radii.length) * Math.PI * 2 - Math.PI / 2;
    return {
      x: region.x + Math.cos(angle) * radius,
      y: region.y + Math.sin(angle) * radius * squash,
    };
  });
}

/** Catmull-Rom 转三次贝塞尔，得到柔和的地区轮廓。 */
function smoothPath(points: readonly Point[]): string {
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

function angularPath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  const head = points[0]!;
  const rest = points
    .slice(1)
    .map((point) => `L ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ');
  return `M ${head.x.toFixed(1)} ${head.y.toFixed(1)} ${rest} Z`;
}

function shapePath(region: Region): { path: string; radius: number; squash: number } {
  const base = radiusOf(region.population);
  const phase = hashSeed(region.id) * Math.PI * 2;
  const steps = region.terrain === 'mountains' ? 14 : 18;
  const radii = shapeRadii(region.terrain, base, phase, steps);
  const squash = region.terrain === 'plains' ? 0.78 : region.terrain === 'mountains' ? 0.92 : 0.9;
  const points = polygonPoints(region, radii, squash);
  const path = region.terrain === 'mountains' ? angularPath(points) : smoothPath(points);
  return { path, radius: base, squash };
}

interface RegionNode {
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

interface LinkView {
  readonly a: Region;
  readonly b: Region;
  readonly days: number;
  readonly capacity: number;
}

interface Summary {
  readonly region: Region;
  readonly countryName: string;
  readonly terrain: string;
  readonly goods: readonly string[];
  readonly priceIndex: number;
  readonly stock: number;
}

const CLIP_PREFIX = 'map-clip-';

export class MapView {
  private readonly svg: SVGSVGElement;
  private readonly nodes = new Map<RegionId, RegionNode>();
  private readonly linksGroup: SVGGElement;
  private readonly tip: SVGGElement;
  private readonly tipBox: SVGRectElement;
  private readonly tipLines: SVGTextElement[] = [];
  private bounds: Bounds = { x: 0, y: 0, width: 320, height: 320 };
  private selected: RegionId | null = null;
  private view: WorldState;
  private palette: ReadonlyMap<CountryId, string>;

  constructor(
    host: HTMLElement,
    state: WorldState,
    private readonly onSelect: (regionId: RegionId) => void,
  ) {
    this.view = state;
    this.palette = countryPalette(state);
    this.svg = svgEl('svg', {
      class: 'map',
      viewBox: '0 0 320 320',
      preserveAspectRatio: 'xMidYMid meet',
      role: 'group',
      'aria-label': '世界地图：五个地区，悬停查看市场摘要，点击进入地区面板',
    });
    const defs = svgEl('defs');
    const seaGlow = svgEl('radialGradient', { id: 'map-sea-glow' });
    seaGlow.append(
      svgEl('stop', { offset: '0%', 'stop-color': '#1b1713' }),
      svgEl('stop', { offset: '100%', 'stop-color': '#0d0b09' }),
    );
    defs.append(seaGlow);
    this.svg.append(defs);

    this.svg.append(
      svgEl('rect', {
        class: 'map__sea',
        x: 0,
        y: 0,
        width: 320,
        height: 320,
        fill: 'url(#map-sea-glow)',
      }),
    );

    this.linksGroup = svgEl('g', { class: 'map__links' });
    const nodeLayer = svgEl('g', { class: 'map__nodes' });
    this.svg.append(this.linksGroup, nodeLayer);

    this.tip = svgEl('g', { class: 'map__tip', 'aria-hidden': 'true' });
    this.tipBox = svgEl('rect', { class: 'map__tip-box', rx: 4, width: 210, height: 88 });
    this.tip.append(this.tipBox);
    for (let index = 0; index < 4; index += 1) {
      const line = svgEl('text', {
        class: `map__tip-line map__tip-line--${index}`,
        x: 10,
        y: 20 + index * 18,
      });
      this.tipLines.push(line);
      this.tip.append(line);
    }
    this.svg.append(this.tip);

    host.append(this.svg);
    this.draw(state, nodeLayer);
  }

  select(regionId: RegionId | null): void {
    this.selected = regionId;
    for (const [id, node] of this.nodes) {
      const active = id === regionId;
      node.group.classList.toggle('is-selected', active);
      node.group.dataset.selected = active ? 'true' : 'false';
      node.group.setAttribute('aria-label', `${this.describe(id)}${active ? '（已选中）' : ''}`);
    }
  }

  update(state: WorldState): void {
    this.view = state;
    const palette = countryPalette(state);
    this.palette = palette;
    for (const [id, node] of this.nodes) {
      const region = state.regions[id];
      if (!region) continue;
      node.pop.textContent = `人口 ${fmtInt(region.population)}`;
      const color = palette.get(region.countryId) ?? COUNTRY_PALETTE[0]!;
      node.shape.setAttribute('stroke', color);
      const active = id === this.selected;
      node.group.classList.toggle('is-selected', active);
      node.group.dataset.selected = active ? 'true' : 'false';
      node.surface.setAttribute('fill', color);
      node.group.setAttribute('aria-label', `${this.describe(id)}${active ? '（已选中）' : ''}`);
    }
    this.renderLinks(state);
  }

  private describe(regionId: RegionId): string {
    const summary = this.summarize(regionId);
    if (!summary) return '未知地区';
    return [
      summary.region.name,
      summary.countryName,
      summary.terrain,
      `人口 ${fmtInt(summary.region.population)}`,
      `主要商品 ${summary.goods.join('、') || '无'}`,
      `价格指数 ${summary.priceIndex.toFixed(2)}`,
    ].join('，');
  }

  private summarize(regionId: RegionId): Summary | null {
    const state = this.view;
    const region = state.regions[regionId];
    if (!region) return null;
    const country = state.countries[region.countryId];
    const markets = Object.values(state.markets).filter((m) => m.regionId === regionId);
    const prices = new Map<string, number>();
    const totals = new Map<string, { price: number; count: number }>();
    for (const market of Object.values(state.markets)) {
      const entry = totals.get(market.goodId) ?? { price: 0, count: 0 };
      entry.price += market.price;
      entry.count += 1;
      totals.set(market.goodId, entry);
    }
    for (const [goodId, entry] of totals) {
      prices.set(goodId, entry.count > 0 ? entry.price / entry.count : 1);
    }
    let weighted = 0;
    let weight = 0;
    for (const market of markets) {
      const average = prices.get(market.goodId) ?? market.price;
      const w = Math.max(1, market.demand);
      weighted += (market.price / Math.max(0.0001, average)) * w;
      weight += w;
    }
    const ranked = [...markets].sort((left, right) => right.demand - left.demand);
    const goods = ranked.slice(0, 2).map((market) => this.goodName(market.goodId));
    const stock = markets.reduce((sum, market) => sum + market.stock, 0);
    return {
      region,
      countryName: country?.name ?? region.countryId,
      terrain: labelOf(TERRAIN_LABELS, region.terrain),
      goods,
      priceIndex: weight > 0 ? weighted / weight : 1,
      stock,
    };
  }

  private goodName(goodId: string): string {
    const label = labelOf(
      { grain: '粮食', iron: '铁矿', weapons: '武器', luxury: '奢侈品' },
      goodId,
    );
    return label;
  }

  private draw(state: WorldState, nodeLayer: SVGGElement): void {
    this.bounds = boundsOf(Object.values(state.regions));
    this.svg.setAttribute(
      'viewBox',
      `${this.bounds.x} ${this.bounds.y} ${this.bounds.width} ${this.bounds.height}`,
    );
    this.svg.setAttribute(
      'data-bounds',
      `${Math.round(this.bounds.width)}x${Math.round(this.bounds.height)}`,
    );

    this.svg.insertBefore(this.buildGrid(), this.linksGroup);
    const defs = this.svg.querySelector('defs');
    const regions = Object.values(state.regions).sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    for (const region of regions) {
      const node = this.buildNode(region, defs);
      this.nodes.set(region.id, node);
      nodeLayer.append(node.group);
    }
    this.renderLinks(state);
    this.svg.append(this.tip);
  }

  private buildGrid(): SVGGElement {
    const grid = svgEl('g', { class: 'map__grid' });
    const step = 60;
    const startX = Math.floor(this.bounds.x / step) * step;
    const startY = Math.floor(this.bounds.y / step) * step;
    for (let x = startX; x <= this.bounds.x + this.bounds.width; x += step) {
      grid.append(
        svgEl('line', { x1: x, y1: this.bounds.y, x2: x, y2: this.bounds.y + this.bounds.height }),
      );
    }
    for (let y = startY; y <= this.bounds.y + this.bounds.height; y += step) {
      grid.append(
        svgEl('line', { x1: this.bounds.x, y1: y, x2: this.bounds.x + this.bounds.width, y2: y }),
      );
    }
    return grid;
  }

  private buildNode(region: Region, defs: Element | null): RegionNode {
    const { path, radius, squash } = shapePath(region);
    const group = svgEl('g', {
      class: `map__node map__node--${region.terrain}`,
      'data-region-id': region.id,
      'data-terrain': region.terrain,
      tabindex: 0,
      role: 'button',
      'aria-label': this.describe(region.id),
    });

    const halo = svgEl('path', { class: 'map__halo', d: path });
    const shape = svgEl('path', { class: 'map__shape', d: path });
    const surface = svgEl('path', { class: 'map__surface', d: path });
    const tone = this.palette.get(region.countryId) ?? COUNTRY_PALETTE[0]!;
    surface.setAttribute('fill', tone);
    shape.setAttribute('stroke', tone);
    const glyph = svgEl('text', {
      class: 'map__glyph',
      x: region.x,
      y: region.y - radius * squash * 0.42,
      'text-anchor': 'middle',
    });
    glyph.textContent = GLYPH_LABELS[region.terrain];

    const name = svgEl('text', {
      class: 'map__name',
      x: region.x,
      y: region.y + 4,
      'text-anchor': 'middle',
    });
    name.textContent = region.name;
    const pop = svgEl('text', {
      class: 'map__pop',
      x: region.x,
      y: region.y + 20,
      'text-anchor': 'middle',
    });
    pop.textContent = `人口 ${fmtInt(region.population)}`;

    group.append(halo, surface, shape, glyph, name, pop);
    if (defs) group.insertBefore(this.buildTexture(region, radius, squash, defs), glyph);

    group.addEventListener('click', () => this.onSelect(region.id));
    group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.onSelect(region.id);
      }
    });
    group.addEventListener('mouseenter', () => this.showTip(region.id, group));
    group.addEventListener('focus', () => this.showTip(region.id, group));
    group.addEventListener('mouseleave', () => this.hideTip(group));
    group.addEventListener('blur', () => this.hideTip(group));
    return { id: region.id, group, shape, surface, halo, name, pop, radius, squash };
  }

  /** 地形内部纹理：全部裁剪在地区轮廓内，用同色低透明度描边。 */
  private buildTexture(region: Region, radius: number, squash: number, defs: Element): SVGGElement {
    const clipId = `${CLIP_PREFIX}${region.id}`;
    const clip = svgEl('clipPath', { id: clipId });
    const outline = svgEl('path', { d: shapePath(region).path });
    clip.append(outline);
    defs.append(clip);

    const layer = svgEl('g', { class: 'map__texture', 'clip-path': `url(#${clipId})` });
    const color = this.palette.get(region.countryId) ?? COUNTRY_PALETTE[0]!;
    const stroke = { stroke: color, fill: 'none', 'stroke-width': 1 };
    const x = region.x;
    const y = region.y;

    switch (region.terrain) {
      case 'plains': {
        for (let index = -2; index <= 2; index += 1) {
          const offset = index * radius * 0.22;
          layer.append(
            svgEl('path', {
              ...stroke,
              d: `M ${x - radius} ${y + offset} Q ${x} ${y + offset - 7} ${x + radius} ${y + offset}`,
              opacity: 0.5,
            }),
          );
        }
        break;
      }
      case 'mountains': {
        for (let index = -1; index <= 1; index += 1) {
          const cx = x + index * radius * 0.55;
          const peak = y + radius * 0.1;
          const base = y + radius * 0.5;
          layer.append(
            svgEl('path', {
              ...stroke,
              d: `M ${cx - radius * 0.32} ${base} L ${cx} ${peak - radius * 0.42} L ${cx + radius * 0.32} ${base}`,
              opacity: 0.55,
            }),
          );
        }
        break;
      }
      case 'coast': {
        for (let index = 0; index < 3; index += 1) {
          const offset = radius * 0.28 + index * 12;
          layer.append(
            svgEl('path', {
              ...stroke,
              d: `M ${x - radius * 0.7} ${y + offset} q ${radius * 0.18} -6 ${radius * 0.36} 0 t ${radius * 0.36} 0 t ${radius * 0.36} 0`,
              opacity: 0.5,
            }),
          );
        }
        break;
      }
      case 'forest': {
        for (let index = 0; index < 6; index += 1) {
          const angle = (index / 6) * Math.PI * 2;
          const cx = x + Math.cos(angle) * radius * 0.5;
          const cy = y + Math.sin(angle) * radius * squash * 0.5;
          layer.append(
            svgEl('path', {
              ...stroke,
              d: `M ${cx} ${cy - 6} L ${cx + 5} ${cy + 4} L ${cx - 5} ${cy + 4} Z`,
              opacity: 0.55,
            }),
          );
        }
        break;
      }
      case 'city': {
        layer.append(
          svgEl('path', {
            ...stroke,
            d: `M ${x - radius * 0.6} ${y} H ${x + radius * 0.6} M ${x} ${y - radius * 0.6} V ${y + radius * 0.6}`,
            opacity: 0.45,
          }),
        );
        for (const [dx, dy] of [
          [-0.38, -0.3],
          [0.34, -0.34],
          [-0.3, 0.32],
          [0.36, 0.28],
        ] as const) {
          layer.append(
            svgEl('rect', {
              ...stroke,
              x: x + dx * radius,
              y: y + dy * radius,
              width: 7,
              height: 7,
              opacity: 0.5,
            }),
          );
        }
        break;
      }
    }
    return layer;
  }

  private uniqueLinks(state: WorldState): LinkView[] {
    const seen = new Set<string>();
    const links: LinkView[] = [];
    for (const region of Object.values(state.regions)) {
      for (const link of region.links) {
        const target = state.regions[link.to];
        if (!target) continue;
        const key = [region.id, target.id].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        const reverse = target.links.find((entry) => entry.to === region.id);
        links.push({
          a: region,
          b: target,
          days: Math.min(link.days, reverse?.days ?? link.days),
          capacity: Math.max(link.capacity, reverse?.capacity ?? link.capacity),
        });
      }
    }
    return links;
  }

  private netNeed(state: WorldState, regionId: RegionId): number {
    let need = 0;
    for (const market of Object.values(state.markets)) {
      if (market.regionId !== regionId) continue;
      need += market.demand - market.production;
    }
    return need;
  }

  private renderLinks(state: WorldState): void {
    while (this.linksGroup.firstChild) this.linksGroup.removeChild(this.linksGroup.firstChild);
    for (const link of this.uniqueLinks(state)) {
      const nodeA = this.nodes.get(link.a.id);
      const nodeB = this.nodes.get(link.b.id);
      if (!nodeA || !nodeB) continue;
      const width = Math.max(1.5, Math.min(6.5, 1.2 + link.capacity / 180));
      const group = svgEl('g', {
        class: 'map__link-group',
        'data-link': `${link.a.id}-${link.b.id}`,
      });
      const line = svgEl('line', {
        class: 'map__link',
        x1: link.a.x,
        y1: link.a.y,
        x2: link.b.x,
        y2: link.b.y,
        'stroke-width': width.toFixed(2),
      });
      group.append(line);

      const needA = this.netNeed(state, link.a.id);
      const needB = this.netNeed(state, link.b.id);
      if (Math.abs(needA - needB) > 0.5) {
        const from = needA < needB ? link.a : link.b;
        const to = needA < needB ? link.b : link.a;
        const fromNode = needA < needB ? nodeA : nodeB;
        const toNode = needA < needB ? nodeB : nodeA;
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const length = Math.hypot(dx, dy) || 1;
        const ux = dx / length;
        const uy = dy / length;
        const startPad = fromNode.radius * 0.9 + 6;
        const endPad = toNode.radius * 0.9 + 6;
        const arrowX = from.x + ux * (startPad + (length - startPad - endPad) * 0.55);
        const arrowY = from.y + uy * (startPad + (length - startPad - endPad) * 0.55);
        const size = 4 + width;
        const points = [
          `${arrowX + ux * size} ${arrowY + uy * size}`,
          `${arrowX - uy * size * 0.7 - ux * size * 0.4} ${arrowY + ux * size * 0.7 - uy * size * 0.4}`,
          `${arrowX + uy * size * 0.7 - ux * size * 0.4} ${arrowY - ux * size * 0.7 - uy * size * 0.4}`,
        ].join(' ');
        group.append(svgEl('polygon', { class: 'map__arrow', points }));
      }

      const title = svgEl('title');
      title.textContent = `${link.a.name} ↔ ${link.b.name} · ${link.days} 日 · 运力 ${fmtInt(link.capacity)}`;
      line.append(title);
      this.linksGroup.append(group);
    }
  }

  private showTip(regionId: RegionId, group: SVGGElement): void {
    const summary = this.summarize(regionId);
    if (!summary) return;
    group.classList.add('is-hover');
    const index = summary.priceIndex;
    const delta = Math.round((index - 1) * 100);
    const trend =
      Math.abs(delta) <= 2
        ? '接近世界均价'
        : delta > 0
          ? `高于世界均价 ${delta}%`
          : `低于世界均价 ${Math.abs(delta)}%`;
    const labels = [
      `${summary.region.name} · ${summary.terrain}`,
      `${summary.countryName} · 人口 ${fmtInt(summary.region.population)}`,
      `主要商品 ${summary.goods.join('、') || '—'}`,
      `价格指数 ${index.toFixed(2)}（${trend}）`,
    ];
    labels.forEach((text, slot) => {
      this.tipLines[slot]?.replaceChildren(document.createTextNode(text));
    });
    const width = 226;
    const height = 92;
    const x = Math.min(
      Math.max(this.bounds.x + 4, summary.region.x - width / 2),
      this.bounds.x + this.bounds.width - width - 4,
    );
    const y = Math.max(
      this.bounds.y + 4,
      summary.region.y - radiusOf(summary.region.population) - height - 16,
    );
    this.tip.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
    this.tipBox.setAttribute('width', String(width));
    this.tipBox.setAttribute('height', String(height));
    this.tip.classList.add('is-visible');
  }

  private hideTip(group: SVGGElement): void {
    group.classList.remove('is-hover');
    this.tip.classList.remove('is-visible');
  }
}
