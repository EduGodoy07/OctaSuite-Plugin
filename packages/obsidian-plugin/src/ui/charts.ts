/**
 * Gráficos en SVG propio.
 *
 * Expensica usa Chart.js y D3: unos 200 KB de dependencias para dibujar cuatro
 * formas. Acá los gráficos son SVG generado a mano, sin dependencias, y toman
 * los colores de las variables de tema de Obsidian, así que se ven bien en
 * cualquier tema claro u oscuro sin configurar paletas.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

function svg(parent: HTMLElement, width: number, height: number): SVGSVGElement {
  const el = document.createElementNS(SVG_NS, "svg");
  el.setAttribute("viewBox", `0 0 ${width} ${height}`);
  el.setAttribute("preserveAspectRatio", "none");
  el.addClass("octa-chart");
  parent.appendChild(el);
  return el;
}

function node<K extends keyof SVGElementTagNameMap>(
  parent: SVGElement,
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  parent.appendChild(el);
  return el;
}

export interface SeriesPoint {
  readonly label: string;
  /** Valor en unidades mínimas. Se escala acá, no en el llamador. */
  readonly value: number;
}

/**
 * Barras agrupadas de dos series. Se usa para facturado contra gastos por mes.
 * Sin eje Y numérico a propósito: la comparación entre barras es lo que se lee,
 * y los importes exactos están en la tabla de al lado.
 */
export function groupedBars(
  parent: HTMLElement,
  a: { readonly name: string; readonly points: readonly SeriesPoint[] },
  b: { readonly name: string; readonly points: readonly SeriesPoint[] },
  formatValue: (value: number) => string,
): void {
  const wrap = parent.createDiv({ cls: "octa-chart-wrap" });
  const legend = wrap.createDiv({ cls: "octa-legend" });
  for (const [name, cls] of [
    [a.name, "is-a"],
    [b.name, "is-b"],
  ] as const) {
    const item = legend.createSpan({ cls: "octa-legend-item" });
    item.createSpan({ cls: `octa-swatch ${cls}` });
    item.createSpan({ text: name });
  }

  const count = Math.max(a.points.length, b.points.length);
  if (count === 0) return;

  const width = 100;
  const height = 34;
  const max = Math.max(1, ...a.points.map((p) => p.value), ...b.points.map((p) => p.value));
  const slot = width / count;
  const barWidth = Math.max(0.8, (slot - slot * 0.35) / 2);

  const chart = svg(wrap, width, height);
  for (let i = 0; i < count; i++) {
    const base = i * slot + slot * 0.175;
    const pairs: Array<[SeriesPoint | undefined, string]> = [
      [a.points[i], "octa-bar-a"],
      [b.points[i], "octa-bar-b"],
    ];
    pairs.forEach(([point, cls], j) => {
      if (!point) return;
      const h = (point.value / max) * (height - 2);
      const rect = node(chart, "rect", {
        x: base + j * barWidth,
        y: height - h,
        width: barWidth,
        height: Math.max(point.value > 0 ? 0.4 : 0, h),
        class: cls,
      });
      const title = document.createElementNS(SVG_NS, "title");
      title.textContent = `${point.label}: ${formatValue(point.value)}`;
      rect.appendChild(title);
    });
  }

  const labels = wrap.createDiv({ cls: "octa-chart-labels" });
  for (let i = 0; i < count; i++) {
    const label = a.points[i]?.label ?? b.points[i]?.label ?? "";
    labels.createSpan({ text: label.slice(5) }); // «2026-08» → «08»
  }
}

/**
 * Anillo de proporciones. Se dibuja con un solo círculo y `stroke-dasharray`
 * en vez de arcos: menos código y sin errores de redondeo en los ángulos.
 */
export function donut(
  parent: HTMLElement,
  slices: readonly { readonly label: string; readonly share: number; readonly detail: string }[],
): void {
  const wrap = parent.createDiv({ cls: "octa-donut-wrap" });
  if (slices.length === 0) return;

  const size = 42;
  const radius = 15.9155; // circunferencia = 100, así el dasharray es el porcentaje
  const chart = svg(wrap, size, size);
  node(chart, "circle", {
    cx: size / 2,
    cy: size / 2,
    r: radius,
    fill: "none",
    class: "octa-donut-track",
    "stroke-width": 6,
  });

  let offset = 25; // arranca arriba
  slices.forEach((slice, i) => {
    const pct = Math.max(0, Math.min(100, slice.share * 100));
    const arc = node(chart, "circle", {
      cx: size / 2,
      cy: size / 2,
      r: radius,
      fill: "none",
      "stroke-width": 6,
      "stroke-dasharray": `${pct} ${100 - pct}`,
      "stroke-dashoffset": offset,
      class: `octa-donut-slice octa-hue-${i % 6}`,
    });
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = `${slice.label}: ${slice.detail}`;
    arc.appendChild(title);
    offset -= pct;
  });

  const legend = wrap.createDiv({ cls: "octa-legend is-column" });
  slices.forEach((slice, i) => {
    const item = legend.createDiv({ cls: "octa-legend-item" });
    item.createSpan({ cls: `octa-swatch octa-hue-${i % 6}` });
    item.createSpan({ text: slice.label });
    item.createSpan({ cls: "octa-legend-value", text: `${Math.round(slice.share * 100)}%` });
  });
}

/**
 * Mapa de calor del mes, una celda por día en filas de semana.
 * La idea viene del calendario de Expensica: sirve para ver de un vistazo qué
 * días concentran el gasto, que un total mensual esconde.
 */
export function monthHeatmap(
  parent: HTMLElement,
  days: readonly { readonly date: string; readonly value: number }[],
  formatValue: (value: number) => string,
): void {
  const wrap = parent.createDiv({ cls: "octa-heatmap" });
  if (days.length === 0) return;

  const max = Math.max(1, ...days.map((d) => d.value));
  const header = wrap.createDiv({ cls: "octa-heatmap-head" });
  for (const label of ["L", "M", "M", "J", "V", "S", "D"]) header.createSpan({ text: label });

  const grid = wrap.createDiv({ cls: "octa-heatmap-grid" });

  // Lunes como primer día: getDay() da 0 para domingo.
  const first = days[0]!.date;
  const [y, m, d] = first.split("-").map(Number) as [number, number, number];
  const weekday = (new Date(y, m - 1, d).getDay() + 6) % 7;
  for (let i = 0; i < weekday; i++) grid.createDiv({ cls: "octa-cell is-empty" });

  for (const day of days) {
    const intensity = day.value === 0 ? 0 : Math.ceil((day.value / max) * 4);
    const cell = grid.createDiv({ cls: `octa-cell is-level-${intensity}` });
    cell.setAttribute("aria-label", `${day.date}: ${formatValue(day.value)}`);
    cell.setAttribute("title", `${day.date} — ${formatValue(day.value)}`);
  }
}
