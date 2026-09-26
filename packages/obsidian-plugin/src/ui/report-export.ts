/**
 * Exportación offline de reportes (B-04): funciones puras que serializan el
 * reporte de un período a Markdown (para imprimir/PDF desde Obsidian) y a CSV
 * (para hojas de cálculo / trámites). Sin dependencias de Obsidian ni del core:
 * reciben los datos YA calculados y formateados por la vista, para no duplicar
 * la lógica de consolidación ni de formato.
 */

export interface ReportKpi {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
}

export interface ReportInput {
  /** Período en formato "YYYY-MM". */
  readonly month: string;
  readonly currency: string;
  readonly locale: string;
  /** Etiquetas de las empresas consolidadas. */
  readonly companies: readonly string[];
  readonly kpis: readonly ReportKpi[];
  readonly trend: readonly { line: string; invoiced: string; expenses: string }[];
  readonly byCategory: readonly { name: string; amount: string }[];
  readonly paymentMix: readonly { method: string; amount: string; sharePct: string }[];
  readonly customers: {
    tickets: string;
    identified: string;
    returning: string;
    avgTicket: string;
  };
  readonly daily: readonly { date: string; amount: string }[];
  /** Números faltantes del correlativo; vacío si no hay huecos. */
  readonly gaps: readonly (string | number)[];
}

/** Envuelve una celda CSV, escapando comas y comillas. */
function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Nombre de archivo del reporte para un período y formato (B-04).
 * Devuelve SOLO el nombre, sin ruta: el caller compone `folder/filename` aparte.
 * Si esto un día incluyera "/", el export escribiría en un folder anidado
 * correcto — pero el P0 2026-09-26 mostró que la duplicación de folder en el
 * caller es invisible para los unit tests de writeReportToVault, así que el
 * nombre se centraliza acá y se testea que no contenga separadores.
 */
export function reportFileName(month: string, kind: "md" | "csv"): string {
  return kind === "md" ? `reporte-${month}.md` : `tablas-${month}.csv`;
}

function mdTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
  const head = `| ${headers.map(esc).join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.map(esc).join(" | ")} |`).join("\n");
  return body ? `${head}\n${sep}\n${body}` : "";
}

export function reportMarkdown(input: ReportInput): string {
  const lines: string[] = [];
  lines.push(`# Reporte ${input.month}`);
  lines.push("");
  lines.push(`Empresas: ${input.companies.join(", ")}`);
  lines.push(`Moneda: ${input.currency}`);
  lines.push("");

  lines.push("## Resumen");
  for (const kpi of input.kpis) {
    lines.push(`- **${kpi.label}:** ${kpi.value}${kpi.hint ? ` (${kpi.hint})` : ""}`);
  }
  lines.push("");

  const trendRows = input.trend.map((r) => [r.line, r.invoiced, r.expenses]);
  if (trendRows.length > 0) {
    lines.push("## Tendencia de 12 meses");
    lines.push(mdTable(["Línea", "Facturado", "Gastos"], trendRows));
    lines.push("");
  }

  if (input.byCategory.length > 0) {
    lines.push("## Gasto por categoría");
    lines.push(mdTable(["Categoría", "Monto"], input.byCategory.map((c) => [c.name, c.amount])));
    lines.push("");
  }

  if (input.paymentMix.length > 0) {
    lines.push("## Formas de pago");
    lines.push(
      mdTable(["Método", "Monto", "Participación"], input.paymentMix.map((p) => [p.method, p.amount, p.sharePct])),
    );
    lines.push("");
  }

  lines.push("## Clientes");
  lines.push(
    mdTable(["Documentos", "Identificados", "Vuelven", "Ticket promedio"], [
      [input.customers.tickets, input.customers.identified, input.customers.returning, input.customers.avgTicket],
    ]),
  );
  lines.push("");

  if (input.daily.length > 0) {
    lines.push("## Gasto por día");
    lines.push(mdTable(["Fecha", "Monto"], input.daily.map((d) => [d.date, d.amount])));
    lines.push("");
  }

  if (input.gaps.length > 0) {
    lines.push("## Huecos en el correlativo");
    lines.push(`Faltan los números: ${input.gaps.join(", ")}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

export function reportCsv(input: ReportInput): string {
  const parts: string[] = [];

  const keyValue = (rows: readonly ReportKpi[]) => rows.map((r) => `${csvCell(r.label)},${csvCell(r.value)}`).join("\n");
  parts.push("# KPIs");
  parts.push(keyValue(input.kpis));

  if (input.trend.length > 0) {
    parts.push("# Tendencia");
    parts.push("Línea,Facturado,Gastos");
    parts.push(input.trend.map((r) => `${csvCell(r.line)},${csvCell(r.invoiced)},${csvCell(r.expenses)}`).join("\n"));
  }

  if (input.byCategory.length > 0) {
    parts.push("# Gasto por categoría");
    parts.push("Categoría,Monto");
    parts.push(input.byCategory.map((c) => `${csvCell(c.name)},${csvCell(c.amount)}`).join("\n"));
  }

  if (input.paymentMix.length > 0) {
    parts.push("# Formas de pago");
    parts.push("Método,Monto,Participación");
    parts.push(input.paymentMix.map((p) => `${csvCell(p.method)},${csvCell(p.amount)},${csvCell(p.sharePct)}`).join("\n"));
  }

  parts.push("# Clientes");
  parts.push("Documentos,Identificados,Vuelven,Ticket promedio");
  parts.push(
    `${csvCell(input.customers.tickets)},${csvCell(input.customers.identified)},${csvCell(
      input.customers.returning,
    )},${csvCell(input.customers.avgTicket)}`,
  );

  if (input.daily.length > 0) {
    parts.push("# Gasto por día");
    parts.push("Fecha,Monto");
    parts.push(input.daily.map((d) => `${csvCell(d.date)},${csvCell(d.amount)}`).join("\n"));
  }

  if (input.gaps.length > 0) {
    parts.push("# Huecos en el correlativo");
    parts.push(input.gaps.map((g) => csvCell(String(g))).join(","));
  }

  return parts.join("\n\n") + "\n";
}

/** Interfaz mínima del vault que usa writeReportToVault (para testabilidad). */
export interface MinimalVault {
  createFolder(path: string): Promise<unknown>;
  getAbstractFileByPath(path: string): { path: string } | null;
  modify(file: { path: string }, content: string): Promise<unknown>;
  create(path: string, content: string): Promise<unknown>;
}

/**
 * Escribe un reporte (Markdown o CSV) al vault en la carpeta de reportes.
 * - Si el archivo ya existe: usa `modify`.
 * - Si no existe: usa `create`.
 * - Crea la carpeta solo si no existe: en Obsidian real `vault.createFolder`
 *   LANZA si la carpeta ya existe, así que crearla siempre rompe el segundo
 *   export al mismo folder.
 * Función pura para testabilidad; la vista llama a esto.
 */
export async function writeReportToVault(
  vault: MinimalVault,
  folder: string,
  filename: string,
  content: string,
): Promise<void> {
  const fullPath = `${folder}/${filename}`;
  if (!vault.getAbstractFileByPath(folder)) {
    await vault.createFolder(folder);
  }
  const existing = vault.getAbstractFileByPath(fullPath);
  if (existing && "path" in existing) {
    await vault.modify(existing, content);
  } else {
    await vault.create(fullPath, content);
  }
}