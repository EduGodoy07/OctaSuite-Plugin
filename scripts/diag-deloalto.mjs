// Diagnóstico del diff masivo: muestra facturas reales del dump con computed vs odooTotal.
import fs from "node:fs";
import readline from "node:readline";

import { CopyTableCollector } from "../packages/core/dist/import/copy.js";
import { buildDeloaltoEvents } from "../packages/core/dist/import/deloalto.js";

const WANTED = new Map([
  ["product_category", ["id", "complete_name", "name", "create_date"]],
  ["uom_uom", ["id", "name"]],
  ["res_partner", ["id", "name", "is_company", "parent_id", "vat", "comment", "email", "phone", "mobile", "street", "street2", "city", "zip", "website", "function", "ref", "create_date"]],
  ["product_template", ["id", "name", "active", "list_price", "standard_price", "uom_id", "categ_id", "default_code", "create_date"]],
  ["product_taxes_rel", ["product_tmpl_id", "tax_id"]],
  ["account_tax", ["id", "amount", "amount_type", "name"]],
  ["res_currency", ["id", "name"]],
  ["account_move", ["id", "move_type", "state", "currency_id", "invoice_date", "create_date", "partner_id", "amount_total", "amount_untaxed", "name"]],
  ["account_move_line", ["id", "move_id", "display_type", "quantity", "price_unit", "discount", "name", "product_id", "price_subtotal", "credit", "debit"]],
  ["account_move_line_account_tax_rel", ["account_move_line_id", "account_tax_id"]],
]);

const collector = new CopyTableCollector(WANTED);
const rl = readline.createInterface({ input: fs.createReadStream(process.argv[2]), crlfDelay: Infinity });
for await (const line of rl) collector.feed(line);

const t = (k) => collector.tables.get(k) ?? [];
const taxAmounts = new Map(t("account_tax").map((r) => [r.id, { amount: Number(r.amount ?? 0), type: r.amount_type, name: r.name }]));
const currencyNames = new Map(t("res_currency").map((r) => [r.id ?? "", r.name ?? ""]));
const linesByMove = new Map();
for (const line of t("account_move_line")) {
  const moveId = line.move_id;
  if (!moveId) continue;
  const list = linesByMove.get(moveId) ?? [];
  list.push(line);
  linesByMove.set(moveId, list);
}
const taxesByLine = new Map();
for (const rel of t("account_move_line_account_tax_rel")) {
  const lineId = rel.account_move_line_id;
  if (!lineId) continue;
  const tax = taxAmounts.get(rel.account_tax_id);
  if (!tax) continue;
  const list = taxesByLine.get(lineId) ?? [];
  list.push(tax);
  taxesByLine.set(lineId, list);
}

const shown = new Set();
let shownCount = 0;
for (const move of t("account_move")) {
  if (move.move_type !== "out_invoice" || move.state !== "posted") continue;
  const id = move.id;
  if (shown.has(id)) continue;
  const cur = currencyNames.get(move.currency_id ?? "") ?? "GTQ";
  if (cur !== "GTQ") continue;
  const lines = (linesByMove.get(id) ?? []).filter((l) => l.display_type === "product" && Number(l.quantity ?? 0) > 0);
  if (lines.length === 0) continue;
  console.log(`\n=== move ${id} ${move.name ?? ""} fecha=${move.invoice_date} total=${move.amount_total} untaxed=${move.amount_untaxed} ===`);
  for (const line of lines) {
    const taxNames = (taxesByLine.get(line.id) ?? []).map((tx) => `${tx.name}(${tx.type}:${tx.amount})`).join(",");
    console.log(`  line ${line.id}: qty=${line.quantity} unit=${line.price_unit} disc=${line.discount} subtotal=${line.price_subtotal} credit=${line.credit} debit=${line.debit} [${taxNames}]`);
  }
  shown.add(id);
  if (++shownCount >= 8) break;
}