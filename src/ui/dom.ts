/** 极简 DOM/SVG 工具：只做创建、清空与数字格式化，不引入任何框架。 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Readonly<Record<string, string | number>> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function fmtInt(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  return sign + String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 金额统一用铜币；过大时追加「万」的紧凑写法。 */
export function fmtMoney(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 10_000).toFixed(1)} 万铜`;
  return `${fmtInt(value)} 铜`;
}

export function fmtPct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function fmtSignedPct(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${Math.round(value * 100)}%`;
}

/**
 * 给节点挂一条解释性提示：`title` 保证原生可访问性，
 * `data-tip` 供样式画出虚线下划线，让「这个数字是什么」可被发现。
 */
export function withHint<T extends HTMLElement>(node: T, hint: string): T {
  node.title = hint;
  node.dataset.tip = hint;
  node.classList.add('has-tip');
  return node;
}

export function statCell(
  label: string,
  value: string,
  tone: 'neutral' | 'good' | 'bad' = 'neutral',
  hint?: string,
): HTMLElement {
  const cell = el('div', `stat stat--${tone}`);
  cell.append(el('span', 'stat__label', label), el('span', 'stat__value', value));
  if (hint) withHint(cell, hint);
  return cell;
}

export function button(
  label: string,
  onClick: () => void,
  variant: 'ghost' | 'gold' | 'small' = 'ghost',
): HTMLButtonElement {
  const node = el('button', `btn btn--${variant}`, label);
  node.type = 'button';
  node.setAttribute('aria-label', label);
  node.addEventListener('click', onClick);
  return node;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
