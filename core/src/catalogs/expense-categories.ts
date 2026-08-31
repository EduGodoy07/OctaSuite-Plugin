/**
 * Categorias por defecto, copiadas literalmente del seed de OctaSuite
 * (`2026_07_06_000001_create_expense_categories_table.php`), incluida la regla
 * de generacion del `code`.
 */
export const DEFAULT_EXPENSE_CATEGORY_NAMES: readonly string[] = [
  "Travel",
  "Meals & Entertainment",
  "Office Supplies",
  "Software & Subscriptions",
  "Transportation",
  "Accommodation",
  "Professional Services",
  "Other",
];

/** `Meals & Entertainment` -> `MEALS_ENTERTAINMENT` (misma regla que el seed PHP). */
export function categoryCode(name: string): string {
  return name.toUpperCase().split(" & ").join("_").split(" ").join("_");
}
