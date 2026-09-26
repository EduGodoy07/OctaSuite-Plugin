import { describe, expect, it } from "vitest";
import { reportCsv, reportFileName, reportMarkdown } from "../src/ui/report-export";
import type { ReportInput } from "../src/ui/report-export";

const base: ReportInput = {
  month: "2026-09",
  currency: "GTQ",
  locale: "es-GT",
  companies: ["Principal"],
  kpis: [
    { label: "Facturado", value: "Q 12,350.00" },
    { label: "Gastos", value: "Q 4,120.50" },
  ],
  trend: [
    { line: "2025-10", invoiced: "Q 0.00", expenses: "Q 800.00" },
    { line: "2026-09", invoiced: "Q 12,350.00", expenses: "Q 4,120.50" },
  ],
  byCategory: [
    { name: "Servicios", amount: "Q 3,000.00" },
    { name: "Consumo, general", amount: "Q 1,120.50" },
  ],
  paymentMix: [
    { method: "Efectivo", amount: "Q 8,000.00", sharePct: "65%" },
    { method: "Tarjeta", amount: "Q 4,350.00", sharePct: "35%" },
  ],
  customers: {
    tickets: "7",
    identified: "3",
    returning: "33%",
    avgTicket: "Q 1,764.29",
  },
  daily: [
    { date: "2026-09-02", amount: "Q 800.00" },
    { date: "2026-09-08", amount: "Q 3,320.50" },
  ],
  gaps: ["00042"],
};

describe("reportMarkdown", () => {
  it("incluye encabezado con el período y las etiquetas de empresa consolidadas", () => {
    const md = reportMarkdown(base);
    expect(md).toContain("# Reporte 2026-09");
    expect(md).toContain("Empresas: Principal");
  });

  it("emite los KPIs y las tablas principales", () => {
    const md = reportMarkdown(base);
    expect(md).toContain("- **Facturado:** Q 12,350.00");
    expect(md).toContain("| Servicios | Q 3,000.00 |");
    expect(md).toContain("| Efectivo | Q 8,000.00 | 65% |");
    expect(md).toContain("| Consumo, general | Q 1,120.50 |");
  });

  it("incluye la sección de huecos solo cuando existe", () => {
    expect(reportMarkdown(base)).toContain("Huecos en el correlativo");
    const sinGaps = { ...base, gaps: [] };
    expect(reportMarkdown(sinGaps)).not.toContain("Huecos en el correlativo");
  });

  it("listas vacías no producen tablas fantasma", () => {
    const vacio = {
      ...base,
      trend: [],
      byCategory: [],
      paymentMix: [],
      daily: [],
    };
    const md = reportMarkdown(vacio);
    expect(md).toContain("# Reporte 2026-09");
    expect(md).not.toContain("| Línea |");
  });
});

describe("reportCsv", () => {
  it("tiene una sección por bloque con cabecera y filas", () => {
    const csv = reportCsv(base);
    expect(csv).toContain("# Tendencia");
    expect(csv).toContain("Línea,Facturado,Gastos");
    expect(csv).toContain("2026-09,\"Q 12,350.00\",\"Q 4,120.50\"");
    expect(csv).toContain("# Gasto por categoría");
    expect(csv).toContain("# Formas de pago");
  });

  it("escapa comas y comillas dentro de celdas (CSV válido)", () => {
    const csv = reportCsv(base);
    expect(csv).toContain('"Consumo, general","Q 1,120.50"');
  });

  it("incluye KPIs como secciones clave-valor y clientes como tabla", () => {
    const csv = reportCsv(base);
    expect(csv).toContain('Facturado,"Q 12,350.00"');
    expect(csv).toContain("Documentos,Identificados,Vuelven,Ticket promedio");
    expect(csv).toContain('7,3,33%,"Q 1,764.29"');
  });
});

describe("reportFileName", () => {
  it("genera el nombre del reporte Markdown sin incluir carpetas", () => {
    const name = reportFileName("2026-09", "md");
    expect(name).toBe("reporte-2026-09.md");
    // Aserción clave contra la regresión del folder duplicado (P0 de 2026-09-26):
    // el caller arma el path base aparte, nunca debe venir con "/" desde acá.
    expect(name).not.toContain("/");
  });

  it("genera el nombre de las tablas CSV sin incluir carpetas", () => {
    const name = reportFileName("2026-09", "csv");
    expect(name).toBe("tablas-2026-09.csv");
    expect(name).not.toContain("/");
  });
});
