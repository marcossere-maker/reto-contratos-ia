import { promises as fs } from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import type { Ctx, Row } from "./types.js";

export const columns = [
  "id_contrato",
  "cliente",
  "nit_cliente",
  "pais",
  "objeto",
  "valor",
  "moneda",
  "fecha_inicio",
  "fecha_fin",
  "requiere_poliza",
  "tipo_poliza",
  "estado_poliza",
  "comercial",
  "ruta_sharepoint",
  "fecha_registro",
  "fuente",
];
export const fixture = (ctx: Ctx, ...p: string[]) =>
  path.join(ctx.directory, "fixtures", "reto-02", ...p);
export const output = (ctx: Ctx, ...p: string[]) =>
  path.join(ctx.directory, "out", ...p);
export async function json<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}
export async function atomic(file: string, data: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file + ".tmp", data);
  await fs.rename(file + ".tmp", file);
}
export async function init(ctx: Ctx) {
  await fs.mkdir(output(ctx, "sharepoint"), { recursive: true });
  try {
    await fs.copyFile(
      fixture(ctx, "maestro-contratos.csv"),
      output(ctx, "sharepoint", "maestro-contratos.csv"),
      fs.constants.COPYFILE_EXCL,
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
}
export async function rows(ctx: Ctx): Promise<Row[]> {
  await init(ctx);
  return parse(
    await fs.readFile(
      output(ctx, "sharepoint", "maestro-contratos.csv"),
      "utf8",
    ),
    { columns: true, skip_empty_lines: true },
  ) as Row[];
}
export async function saveRows(ctx: Ctx, data: Row[]) {
  await atomic(
    output(ctx, "sharepoint", "maestro-contratos.csv"),
    stringify(data, { header: true, columns }),
  );
}
export async function processed(ctx: Ctx): Promise<string[]> {
  try {
    return await json<string[]>(output(ctx, "procesados.json"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}
export async function mark(ctx: Ctx, id: string) {
  await atomic(
    output(ctx, "procesados.json"),
    JSON.stringify([...new Set([...(await processed(ctx)), id])], null, 2),
  );
}
export async function log(
  ctx: Ctx,
  data: Record<string, unknown>,
  file = "log.jsonl",
) {
  const dest = output(ctx, file);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.appendFile(
    dest,
    JSON.stringify({
      ts: new Date().toISOString(),
      sessionId: ctx.sessionId,
      ...data,
    }) + "\n",
  );
}
export function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function slug(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
export function safeId(id: string) {
  if (!/^msg-\d{3}$/.test(id))
    throw new Error("Identificador de mensaje inválido.");
  return id;
}
