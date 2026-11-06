import { promises as fs } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  contratoSchema,
  type Contrato,
  type Ctx,
  type Row,
  type Tool,
  type Validation,
} from "../types.js";
import { document, extract } from "../extract.js";
import {
  atomic,
  columns,
  fixture,
  log,
  mark,
  output,
  processed,
  rows,
  safeId,
  saveRows,
  slug,
  validDate,
} from "../storage.js";

const id = z
  .string()
  .regex(/^msg-\d{3}$/)
  .describe("Identificador del correo, por ejemplo msg-001");
const contract = contratoSchema.describe(
  "Contrato devuelto por contratos_extraer, sin inventar valores",
);
export function similarity(a: string, b: string) {
  const tokens = (s: string) => new Set(slug(s).split("-"));
  const x = tokens(a),
    y = tokens(b);
  return [...x].filter((t) => y.has(t)).length / Math.max(x.size, y.size, 1);
}
export async function validate(
  ctx: Ctx,
  mensajeId: string,
  c: Contrato,
): Promise<Validation> {
  const doc = await document(ctx, mensajeId),
    all = await rows(ctx);
  const v: Validation = {
    clasificacion: "nuevo",
    requiere_revision: [],
    diferencias: {},
  };
  if (!doc.attachment || !c.cliente || !c.objeto) {
    return {
      ...v,
      clasificacion: "rechazado",
      motivo: "Sin contrato o sin partes y objeto identificables.",
    };
  }
  const old =
    all.find((r) => r.id_contrato === c.id_contrato) ??
    all.find(
      (r) =>
        r.nit_cliente === c.nit_cliente &&
        similarity(r.objeto, c.objeto!) >= 0.9,
    );
  if (old) {
    v.id_contrato_existente = old.id_contrato;
    if (
      !c.es_otrosi &&
      ["valor", "fecha_inicio", "fecha_fin"].every(
        (k) => String(c[k as keyof Contrato]) === old[k],
      )
    )
      v.clasificacion = "duplicado";
    else {
      v.clasificacion = "actualizacion";
      for (const k of columns.filter((k) => k in c))
        if (String(c[k as keyof Contrato] ?? "") !== old[k])
          v.diferencias[k] = { antes: old[k], despues: c[k as keyof Contrato] };
    }
  }
  if (v.clasificacion === "duplicado") return v;
  for (const k of [
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
  ]) {
    const value = c[k as keyof Contrato];
    if (value === null || (c.confianza[k] ?? 0) < 0.8)
      v.requiere_revision.push(k);
  }
  for (const k of ["fecha_inicio", "fecha_fin"] as const)
    if (c[k] && !validDate(c[k]!)) v.requiere_revision.push(k);
  if (c.fecha_inicio && c.fecha_fin && c.fecha_fin < c.fecha_inicio)
    v.requiere_revision.push("fecha_fin");
  if (
    v.clasificacion === "actualizacion" &&
    !c.es_otrosi &&
    Object.keys(v.diferencias).length
  )
    v.requiere_revision.push(...Object.keys(v.diferencias));
  v.requiere_revision = [...new Set(v.requiere_revision)];
  return v;
}
function wrapped(
  description: string,
  args: Tool["args"],
  run: (a: Record<string, unknown>, ctx: Ctx) => Promise<unknown>,
): Tool {
  return {
    description,
    args,
    async execute(a, ctx) {
      try {
        const data = await run(z.object(args).strict().parse(a), ctx);
        return JSON.stringify({ ok: true, data });
      } catch (e) {
        return JSON.stringify({
          ok: false,
          error:
            e instanceof z.ZodError
              ? "Argumentos inválidos: " +
                e.issues
                  .map((i) => i.path.join(".") + ": " + i.message)
                  .join(";")
              : e && typeof e === "object" && "code" in e
                ? "No se pudo acceder al archivo del caso. Verificá que exista y que el servidor tenga permisos."
                : e instanceof Error
                  ? e.message
                  : "No se pudo completar la operación.",
        });
      }
    },
  };
}
const assertSource = async (ctx: Ctx, id: string, c: Contrato) => {
  const source = await extract(ctx, id);
  if (
    !isDeepStrictEqual(source, c) &&
    !isDeepStrictEqual(ctx.autorizacion, { mensajeId: id, contrato: c })
  )
    throw new Error(
      "Los valores deben coincidir con la extracción o una revisión humana autorizada.",
    );
};
export const leer_buzon = wrapped(
  "Lista los mensajes pendientes del buzón ficticio.",
  {},
  async (_, ctx) => {
    const done = await processed(ctx);
    const ids = (await fs.readdir(fixture(ctx, "buzon")))
      .filter((x) => /^msg-\d{3}$/.test(x) && !done.includes(x))
      .sort();
    return {
      mensajes: await Promise.all(
        ids.map(async (id) => {
          try {
            const d = await document(ctx, id);
            return { ...d.correo, tiene_contrato: !!d.attachment };
          } catch {
            return {
              id,
              de: "",
              asunto: "Mensaje no legible",
              fecha: "",
              adjuntos: [],
              tiene_contrato: false,
              error: "Revisar el archivo de correo o su adjunto.",
            };
          }
        }),
      ),
    };
  },
);
export const extraer = wrapped(
  "Extrae datos deterministas con fuente y confianza del adjunto de un mensaje.",
  { mensaje_id: id },
  async (a, ctx) => extract(ctx, a.mensaje_id as string),
);
export const validar = wrapped(
  "Clasifica el contrato y devuelve campos que requieren revisión humana.",
  { mensaje_id: id, contrato: contract },
  async (a, ctx) => {
    const c = a.contrato as Contrato;
    await assertSource(ctx, a.mensaje_id as string, c);
    return validate(ctx, a.mensaje_id as string, c);
  },
);
export const registrar = wrapped(
  "Registra y archiva un contrato validado; exige autorización humana para campos dudosos.",
  {
    mensaje_id: id,
    contrato: contract,
    confirmado: z
      .boolean()
      .optional()
      .describe("Solo true tras la confirmación humana inmediata"),
  },
  async (a, ctx) => {
    const mensajeId = safeId(a.mensaje_id as string),
      c = a.contrato as Contrato;
    await assertSource(ctx, mensajeId, c);
    if ((await processed(ctx)).includes(mensajeId)) {
      return { id_contrato: c.id_contrato, accion: "ya_procesado" };
    }
    const v = await validate(ctx, mensajeId, c);
    if (v.clasificacion === "rechazado" || v.clasificacion === "duplicado") {
      await mark(ctx, mensajeId);
      return {
        id_contrato: c.id_contrato,
        accion: v.clasificacion,
        motivo: v.motivo,
      };
    }
    if (
      v.requiere_revision.length &&
      (!a.confirmado ||
        !isDeepStrictEqual(ctx.autorizacion, { mensajeId, contrato: c }))
    )
      throw new Error("Requiere revisión: " + v.requiere_revision.join(", "));
    for (const key of ["fecha_inicio", "fecha_fin"] as const)
      if (!c[key] || !validDate(c[key]!))
        throw new Error("Falta una fecha válida: " + key);
    const all = await rows(ctx);
    const existing = all.find(
      (r) => r.id_contrato === (v.id_contrato_existente ?? c.id_contrato),
    );
    const contractId =
      v.id_contrato_existente ??
      c.id_contrato ??
      `AUTO-${ctx.hoy?.slice(0, 4) ?? new Date().getUTCFullYear()}-${String(all.length + 1).padStart(4, "0")}`;
    if (!/^[A-Za-z0-9-]+$/.test(contractId))
      throw new Error("Número de contrato no seguro para archivar.");
    const d = await document(ctx, mensajeId);
    const relative = `Contratos/${c.fecha_inicio!.slice(0, 4)}/${slug(c.cliente!)}/${contractId}${c.es_otrosi ? "-" + mensajeId : ""}${path.extname(d.attachment!)}`;
    await atomic(output(ctx, "sharepoint", relative), d.text);
    const row: Row = { ...existing };
    for (const k of columns)
      if (k in c) row[k] = String(c[k as keyof Contrato] ?? "");
    Object.assign(row, {
      id_contrato: contractId,
      ruta_sharepoint: relative,
      fecha_registro: ctx.hoy ?? new Date().toISOString().slice(0, 10),
      fuente: "buzon",
    });
    if (existing) all[all.indexOf(existing)] = row;
    else all.push(row);
    await saveRows(ctx, all);
    await log(
      ctx,
      {
        id_contrato: contractId,
        accion: v.clasificacion,
        cambios: v.diferencias,
        mensaje_id: mensajeId,
      },
      "sharepoint/historial.jsonl",
    );
    await mark(ctx, mensajeId);
    return {
      id_contrato: contractId,
      accion: v.clasificacion,
      ruta_archivo: "out/sharepoint/" + relative,
    };
  },
);
export const alertas = wrapped(
  "Genera alertas de vencimiento, pólizas pendientes y registros posteriores al corte.",
  {
    hoy: z
      .string()
      .refine(validDate)
      .describe("Fecha de referencia YYYY-MM-DD para reproducir el reporte"),
  },
  async (a, ctx) => {
    const hoy = a.hoy as string,
      all = await rows(ctx);
    const vencen = all.filter((r) => {
      const days = (Date.parse(r.fecha_fin) - Date.parse(hoy)) / 86400000;
      return days >= 0 && days <= 60;
    });
    const polizas_pendientes = all.filter(
      (r) => r.requiere_poliza === "true" && r.estado_poliza !== "vigente",
    );
    const registrados_desde_corte = all.filter(
      (r) => r.fecha_registro >= "2026-05-30",
    );
    const section = (title: string, data: Row[]) =>
      `## ${title}\n\n` +
      (data.length
        ? data
            .map(
              (r) =>
                `- ${r.id_contrato} · ${r.cliente} · fin ${r.fecha_fin} · póliza ${r.estado_poliza}`,
            )
            .join("\n")
        : "Sin casos.") +
      "\n";
    await atomic(
      output(ctx, "alertas.md"),
      `# Alertas de contratos\n\nFecha de referencia: ${hoy}\n\n` +
        section("Vencen en los próximos 60 días", vencen) +
        section("Pólizas pendientes o vencidas", polizas_pendientes) +
        section("Registrados desde 2026-05-30", registrados_desde_corte),
    );
    return {
      ruta: "out/alertas.md",
      vencen,
      polizas_pendientes,
      registrados_desde_corte,
    };
  },
);
export const tools: Record<string, Tool> = {
  contratos_leer_buzon: leer_buzon,
  contratos_extraer: extraer,
  contratos_validar: validar,
  contratos_registrar: registrar,
  contratos_alertas: alertas,
};
