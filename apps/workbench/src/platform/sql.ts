import type { Cell } from "../contracts/import";

/** 仅平台固定表/列调用；不能接收HTTP或适配器提供的SQL标识符。 */
export function insertRows(db: D1Database, table: string, columns: string[], rows: Cell[][], suffix = ""): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  const perStatement = Math.floor(100 / columns.length);
  if (perStatement < 1) throw new Error("platform column limit");
  for (let offset = 0; offset < rows.length; offset += perStatement) {
    const chunk = rows.slice(offset, offset + perStatement);
    statements.push(db.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES ${chunk.map(() => `(${columns.map(() => "?").join(",")})`).join(",")} ${suffix}`).bind(...chunk.flat()));
  }
  return statements;
}
