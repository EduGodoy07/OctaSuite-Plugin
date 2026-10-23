#!/usr/bin/env node
/**
 * Import DeLoAlto — Método B (COPY TEXT de pg_dump, sin PostgreSQL).
 *
 * Stream del dump → CopyTableCollector (solo tablas/columnas pedidas) →
 * buildDeloaltoEvents (mapper + validación con project()) → append al journal
 * deloaltocompany del vault (append-only, dedupe por id de evento).
 *
 * Uso:
 *   node scripts/import-deloalto.mjs <dump.sql> [--dry-run] [--vault <ruta>]
 *
 * Por defecto --vault apunta al vault iCloud activo. Con --dry-run no toca el
 * journal: solo muestra el reporte (importados/saltados/diferencias/rechazados).
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { CopyTableCollector } from "../packages/core/dist/import/copy.js";
import { buildDeloaltoEvents } from "../packages/core/dist/import/deloalto.js";
import { groupEventsByMonth } from "../packages/core/dist/import/journal-events.js";

// Columnas exactas que usa packages/core/src/import/deloalto.ts.
const WANTED = new Map([
  ["product_category", ["id", "complete_name", "name", "create_date"]],
  ["uom_uom", ["id", "name"]],
  ["res_partner", ["id", "name", "is_company", "parent_id", "vat", "comment", "email", "phone", "mobile", "street", "street2", "city", "zip", "website", "function", "ref", "create_date"]],
  ["product_template", ["id", "name", "active", "list_price", "standard_price", "uom_id", "categ_id", "default_code", "create_date"]],
  ["product_taxes_rel", ["product_tmpl_id", "tax_id"]],
  ["account_tax", ["id", "amount"]],
  ["res_currency", ["id", "name"]],
  ["account_move", ["id", "move_type", "state", "currency_id", "invoice_date", "create_date", "partner_id", "amount_total", "name"]],
  ["account_move_line", ["id", "move_id", "display_type", "quantity", "price_unit", "discount", "name", "product_id", "price_subtotal"]],
  ["account_move_line_account_tax_rel", ["account_move_line_id", "account_tax_id"]],
]);

function parseArgs(argv) {
  let dump;
  let vault;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--vault") {
      const next = argv[++i];
      if (!next || next.startsWith("--")) {
        throw new Error("--vault requiere una ruta");
      }
      vault = next;
    } else if (arg.startsWith("--")) {
      throw new Error(`Opción desconocida: ${arg}`);
    } else if (dump === undefined) {
      dump = arg;
    } else {
      throw new Error(`Argumento inesperado: ${arg}`);
    }
  }
  if (!dump) {
    throw new Error("Uso: node scripts/import-deloalto.mjs <dump.sql> [--dry-run] [--vault <ruta>]");
  }
  return { dump, dryRun, vault };
}

async function readExistingEventIds(journalDir) {
  const ids = new Set();
  let malformedLines = 0;
  let filesScanned = 0;
  if (!fs.existsSync(journalDir)) return { ids, malformedLines, filesScanned };

  const files = fs.readdirSync(journalDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => entry.name)
    .sort();

  for (const filename of files) {
    filesScanned++;
    const stream = fs.createReadStream(path.join(journalDir, filename), "utf8");
    const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const raw of reader) {
      if (!raw.trim()) continue;
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed.id === "string" && parsed.id.length > 0) ids.add(parsed.id);
        else malformedLines++;
      } catch {
        // Preserve corrupt historical lines, but do not treat them as event IDs.
        malformedLines++;
      }
    }
  }
  return { ids, malformedLines, filesScanned };
}

function fmt(n) {
  return n.toLocaleString("en-US");
}

async function main() {
  const { dump, dryRun, vault } = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(dump)) {
    console.error(`No existe el dump: ${dump}`);
    process.exit(1);
  }

  console.log(`Streaming ${dump} (${(fs.statSync(dump).size / 1e9).toFixed(2)} GB)...`);
  const collector = new CopyTableCollector(WANTED);
  const rl = readline.createInterface({ input: fs.createReadStream(dump), crlfDelay: Infinity });
  const t0 = Date.now();

  for await (const line of rl) {
    collector.feed(line);
  }

  console.log(`\nFilas por tabla (${((Date.now() - t0) / 1000).toFixed(1)}s):`);
  for (const [table, rows] of collector.tables) {
    console.log(`  ${table}: ${fmt(rows.length)}`);
  }

  const tables = {
    product_category: collector.tables.get("product_category") ?? [],
    uom_uom: collector.tables.get("uom_uom") ?? [],
    res_partner: collector.tables.get("res_partner") ?? [],
    product_template: collector.tables.get("product_template") ?? [],
    product_taxes_rel: collector.tables.get("product_taxes_rel") ?? [],
    account_tax: collector.tables.get("account_tax") ?? [],
    res_currency: collector.tables.get("res_currency") ?? [],
    account_move: collector.tables.get("account_move") ?? [],
    account_move_line: collector.tables.get("account_move_line") ?? [],
    account_move_line_account_tax_rel: collector.tables.get("account_move_line_account_tax_rel") ?? [],
  };

  const result = buildDeloaltoEvents(tables);

  const skipSummary = (label, report) => {
    const skips = [...report.skipped.entries()].map(([k, v]) => `${k}=${v}`).join(", ");
    console.log(`  ${label}: ${fmt(report.imported)} importados | saltados: ${skips || "ninguno"}`);
  };

  console.log("\n=== Reporte de import ===");
  skipSummary("Categorías", result.categories);
  skipSummary("Productos", result.products);
  skipSummary("Partners", result.partners);
  console.log(`    NIT válidos conservados: ${fmt(result.partners.taxIdKept)}`);
  console.log(`    NIT dudosos preservados en notes: ${fmt(result.partners.taxIdPreserved)}`);
  console.log(`    Sin VAT: ${fmt(result.partners.emptyVat)} | CF: ${fmt(result.partners.cfCount)}`);
  skipSummary("Facturas", result.invoices);
  console.log(`    Con diff de redondeo vs Odoo: ${fmt(result.invoices.withRoundingDiff)}`);
  console.log(`  Total diff (centavos, Odoo - OctaSuite): ${result.totalDiffMinor}`);
  console.log(`  Eventos rechazados por el dominio: ${fmt(result.rejected.length)}`);
  for (const r of result.rejected.slice(0, 20)) {
    console.log(`    ${r.type} ${r.code}: ${r.reason}`);
  }

  const vaultDir = vault ?? path.join(process.env.HOME ?? "", "Library/Mobile Documents/iCloud~md~obsidian/Documents");
  const journalDir = path.join(vaultDir, "octasuite-data/journal/deloaltocompany");

  if (!dryRun && !fs.existsSync(journalDir)) {
    console.error(`No existe el directorio del journal: ${journalDir}`);
    process.exit(1);
  }

  // Deduplicar contra TODOS los archivos del journal de esta empresa, no solo
  // el mes destino: el dump puede contener eventos con fechas históricas variadas.
  const { ids: existing, malformedLines, filesScanned } = await readExistingEventIds(journalDir);
  const seen = new Set(existing);
  const fresh = [];
  for (const event of result.events) {
    if (seen.has(event.id)) continue;
    fresh.push(event);
    seen.add(event.id);
  }
  const byMonth = groupEventsByMonth(fresh);
  const duplicates = result.events.length - fresh.length;

  console.log(`\nJournal de destino: ${journalDir}`);
  console.log(`Archivos mensuales revisados: ${fmt(filesScanned)}; IDs ya existentes: ${fmt(existing.size)}`);
  if (malformedLines > 0) {
    console.warn(`Aviso: ${fmt(malformedLines)} líneas históricas no JSON o sin ID fueron preservadas y no usadas para deduplicar.`);
  }

  if (dryRun) {
    console.log(`\n[dry-run] No se escribió nada.`);
    console.log(`[dry-run] ${fmt(result.events.length)} eventos candidatos; ${fmt(duplicates)} ya existentes; ${fmt(fresh.length)} nuevos.`);
    for (const [month, events] of [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`[dry-run] ${month}.jsonl: ${fmt(events.length)} eventos nuevos`);
    }
    if (byMonth.size === 0) console.log("[dry-run] No hay eventos nuevos para importar.");
    return;
  }

  for (const [month, events] of [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const journalPath = path.join(journalDir, `${month}.jsonl`);
    const lines = events.map((event) => `${JSON.stringify(event)}\n`).join("");
    fs.appendFileSync(journalPath, lines, "utf8");
    console.log(`Append a ${journalPath}: ${fmt(events.length)} eventos nuevos`);
  }

  console.log(`OK — import completado. ${fmt(fresh.length)} eventos añadidos; ${fmt(duplicates)} ya existían.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});