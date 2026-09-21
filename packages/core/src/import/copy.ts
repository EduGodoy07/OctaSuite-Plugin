/**
 * Parser del formato TEXT de PostgreSQL COPY (pg_dump), para extraer datos
 * de dumps de Odoo sin instalar PostgreSQL (Método B).
 *
 * Formato: header `COPY public.tabla ("col1", col2) FROM stdin;`, luego una
 * fila por línea con campos separados por TAB, terminada por `\.`.
 * Escapes: `\t` tab, `\n` newline, `\r`, `\\`, y `\N` = NULL.
 */

export interface CopyHeader {
  readonly table: string;
  readonly columns: readonly string[];
}

/** Parsea `COPY public.foo (a, "B c") FROM stdin;` → {table, columns}. */
export function parseCopyHeader(line: string): CopyHeader | null {
  const m = /^COPY public\.("[^"]+"|[A-Za-z_0-9]+)\s*\((.*)\)\s*FROM stdin;\s*$/.exec(line);
  if (!m) return null;
  return { table: unquoteIdent(m[1]!), columns: splitColumnList(m[2]!) };
}

function unquoteIdent(s: string): string {
  return s.startsWith('"') && s.endsWith('"') && s.length >= 2 ? s.slice(1, -1).replace(/""/g, '"') : s;
}

/** Separa la lista de columnas respetando comillas dobles. */
function splitColumnList(list: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of list) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === "," && !inQuotes) {
      out.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out.map(unquoteIdent);
}

/** `\N` → null; desescapa `\\`, `\t`, `\n`, `\r` según el formato COPY. */
export function unescapeCopyField(field: string): string | null {
  if (field === "\\N") return null;
  if (!field.includes("\\")) return field;
  let out = "";
  for (let i = 0; i < field.length; i++) {
    const ch = field[i]!;
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = field[++i];
    if (next === undefined) {
      out += "\\";
      break;
    }
    switch (next) {
      case "t": out += "\t"; break;
      case "n": out += "\n"; break;
      case "r": out += "\r"; break;
      case "b": out += "\b"; break;
      case "f": out += "\f"; break;
      case "v": out += "\v"; break;
      default: out += next;
    }
  }
  return out;
}

export type Row = Record<string, string | null>;

/** Parsea una fila de datos a registro por nombre de columna. */
export function parseCopyRow(line: string, header: CopyHeader): Row {
  const fields = line.split("\t").map(unescapeCopyField);
  const row: Row = {};
  header.columns.forEach((col, i) => {
    row[col] = fields[i] ?? null;
  });
  return row;
}

/**
 * Colector streaming de bloques COPY para pipelines de dumps grandes:
 * `feed(line)` por cada línea del dump; solo retiene las tablas pedidas y,
 * de cada una, solo las columnas pedidas (memoria acotada en dumps de GB).
 */
export class CopyTableCollector {
  private header: CopyHeader | null = null;
  private keepIdx: number[] = [];
  private readonly wanted: ReadonlyMap<string, readonly string[]>;
  /** table → filas proyectadas (solo columnas pedidas). */
  readonly tables = new Map<string, Row[]>();
  /** Líneas de datos leídas por tabla (diagnóstico). */
  readonly rowCount = new Map<string, number>();

  constructor(wanted: ReadonlyMap<string, readonly string[]>) {
    this.wanted = wanted;
  }

  feed(line: string): void {
    const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (this.header) {
      if (trimmed === "\\.") {
        this.header = null;
        this.keepIdx = [];
        return;
      }
      const row = parseCopyRow(trimmed, this.header);
      const projected: Row = {};
      for (const i of this.keepIdx) {
        const col = this.header.columns[i]!;
        projected[col] = row[col] ?? null;
      }
      this.tables.get(this.header.table)!.push(projected);
      return;
    }
    const parsed = parseCopyHeader(trimmed);
    if (!parsed || !this.wanted.has(parsed.table)) return;
    const keep = this.wanted.get(parsed.table)!;
    this.keepIdx = keep.map((c) => parsed.columns.indexOf(c)).filter((i) => i >= 0);
    if (!this.tables.has(parsed.table)) {
      this.tables.set(parsed.table, []);
      this.rowCount.set(parsed.table, 0);
    }
    this.header = parsed;
  }
}
