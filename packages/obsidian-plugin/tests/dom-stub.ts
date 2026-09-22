/**
 * Stub de DOM mínimo para tests en node de vistas de Obsidian.
 *
 * Vitest corre con environment: "node" (sin jsdom). Las vistas reales usan
 * el API El de Obsidian (createDiv/createSpan/setAttribute/appendChild/
 * textContent) y document.createElementNS para el SVG del organigrama.
 * Este stub implementa solo lo que el código real toca durante un render.
 */
export class FakeNode {
  tag: string;
  attrs: Record<string, string> = {};
  children: FakeNode[] = [];
  _text = "";
  constructor(tag: string) {
    this.tag = tag;
  }
  setAttribute(name: string, value: string) {
    this.attrs[name] = value;
  }
  setAttributeNS(_ns: string, name: string, value: string) {
    this.attrs[name] = value;
  }
  appendChild(child: FakeNode): FakeNode {
    this.children.push(child);
    return child;
  }
  set textContent(v: string) {
    this._text = v;
    this.children = [];
  }
  get textContent() {
    return this._text;
  }
  /** Obsidian El: elementos arbitrarios (button, table, td, hr...) con clase, texto y attrs. */
  createEl(tag: string, opts?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeNode {
    const n = new FakeNode(tag);
    if (opts?.cls) n.attrs.class = opts.cls;
    if (opts?.attr) Object.assign(n.attrs, opts.attr);
    if (opts?.text !== undefined) n.textContent = opts.text;
    this.children.push(n);
    return n;
  }
  addClass(...cls: string[]): void {
    const current = this.attrs.class ? this.attrs.class.split(" ") : [];
    this.attrs.class = [...current, ...cls].join(" ");
  }
  empty(): void {
    this.children = [];
    this._text = "";
  }
  get childElementCount(): number {
    return this.children.length;
  }
  setText(text: string): void {
    this._text = text;
  }
  /** Obsidian El: crea hijo con clase y texto opcional. */
  createDiv(opts?: { cls?: string; text?: string }): FakeNode {
    const n = new FakeNode("div");
    if (opts?.cls) n.attrs.class = opts.cls;
    if (opts?.text) n.textContent = opts.text;
    this.children.push(n);
    return n;
  }
  createSpan(opts?: { cls?: string; text?: string }): FakeNode {
    const n = new FakeNode("span");
    if (opts?.cls) n.attrs.class = opts.cls;
    if (opts?.text) n.textContent = opts.text;
    this.children.push(n);
    return n;
  }
}

/** Instala un document global mínimo (solo createElementNS se usa en renders SVG). */
export function installFakeDocument(): void {
  (globalThis as Record<string, unknown>).document = {
    createElementNS: (_ns: string, tag: string) => new FakeNode(tag),
  };
}

export function serialize(n: FakeNode, indent = ""): string {
  const attrs = Object.entries(n.attrs)
    .map(([k, v]) => ` ${k}="${v.replace(/"/g, "&quot;")}"`)
    .join("");
  if (n.children.length === 0) {
    if (n._text === "") return `${indent}<${n.tag}${attrs} />`;
    return `${indent}<${n.tag}${attrs}>${n._text}</${n.tag}>`;
  }
  const inner = n.children.map((c) => serialize(c, indent + "  ")).join("\n");
  return `${indent}<${n.tag}${attrs}>\n${inner}\n${indent}</${n.tag}>`;
}

export function count(n: FakeNode, pred: (n: FakeNode) => boolean): number {
  let acc = pred(n) ? 1 : 0;
  for (const c of n.children) acc += count(c, pred);
  return acc;
}

export function findFirst(n: FakeNode, pred: (n: FakeNode) => boolean): FakeNode | undefined {
  if (pred(n)) return n;
  for (const c of n.children) {
    const f = findFirst(c, pred);
    if (f) return f;
  }
  return undefined;
}