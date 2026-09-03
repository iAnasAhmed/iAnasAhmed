/** Minimal DOM helpers. A framework's ergonomics in ~40 lines, with no framework. */

type Child = Node | string | number | null | undefined | false;

export interface Attrs {
  readonly [key: string]: string | number | boolean | EventListener | undefined | null;
}

function applyAttr(el: Element, key: string, value: unknown): void {
  if (value === undefined || value === null || value === false) return;

  if (key.startsWith('on') && typeof value === 'function') {
    el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    return;
  }
  if (key === 'class') { el.setAttribute('class', String(value)); return; }
  if (key === 'html') { el.innerHTML = String(value); return; }
  if (value === true) { el.setAttribute(key, ''); return; }
  el.setAttribute(key, String(value));
}

function appendChildren(el: Element, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

/** Create an HTML element. `h('div', { class: 'x' }, 'hello')`. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) applyAttr(el, key, value);
  appendChildren(el, children);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Create an SVG element. SVG needs its own namespace, so it needs its own helper. */
export function s(tag: string, attrs: Attrs = {}, ...children: Child[]): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) applyAttr(el, key, value);
  appendChildren(el, children);
  return el;
}

/** Replace an element's contents in one shot. */
export function render(target: Element, ...children: Child[]): void {
  target.replaceChildren();
  appendChildren(target, children);
}

export function qs<T extends Element>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Missing required element: ${selector}`);
  return el;
}
