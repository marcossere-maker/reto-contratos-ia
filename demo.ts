import { promises as fs } from "node:fs";
import { tools } from "./src/tools/contratos.js";
import type { Contrato, Ctx, Result, Validation } from "./src/types.js";
import { output, log } from "./src/storage.js";
const ctx: Ctx = {
  directory: process.cwd(),
  sessionId: "demo-sin-modelo",
  hoy: "2026-09-03",
};
await fs.rm(output(ctx), { recursive: true, force: true });
async function call<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const r = JSON.parse(await tools[name].execute(args, ctx)) as Result<T>;
  await log(ctx, {
    herramienta: name,
    mensaje_id: args.mensaje_id,
    ok: r.ok,
    resumen: r.ok ? "Completado" : r.error,
  });
  if (!r.ok) throw new Error(r.error);
  return r.data;
}
const inbox = await call<{ mensajes: { id: string }[] }>(
  "contratos_leer_buzon",
  {},
);
const pending: { id: string; c: Contrato }[] = [];
for (const m of inbox.mensajes) {
  try {
    const c = await call<Contrato>("contratos_extraer", { mensaje_id: m.id });
    const v = await call<Validation>("contratos_validar", {
      mensaje_id: m.id,
      contrato: c,
    });
    if (v.requiere_revision.length) {
      pending.push({ id: m.id, c });
      console.log(
        `${m.id}: ${v.clasificacion} · NO REGISTRADO · revisión: ${v.requiere_revision.join(", ")}`,
      );
    } else {
      await call("contratos_registrar", { mensaje_id: m.id, contrato: c });
      console.log(`${m.id}: ${v.clasificacion} · procesado`);
    }
  } catch (e) {
    console.log(
      `${m.id}: error recuperable · ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
for (const p of pending.slice(0, 1)) {
  const c = structuredClone(p.c);
  c.valor = 0;
  c.fecha_inicio = "2026-08-31";
  c.fecha_fin = "2027-08-31";
  for (const k of ["valor", "fecha_inicio", "fecha_fin"]) {
    c.confianza[k] = 1;
    c.fuente[k] = "Confirmación simulada del operador en demo.ts";
  }
  ctx.autorizacion = { mensajeId: p.id, contrato: c };
  console.log(
    "Segunda pasada: operador de demo confirma valor 0, inicio 2026-08-31 y fin 2027-08-31.",
  );
  console.log(
    await call("contratos_registrar", {
      mensaje_id: p.id,
      contrato: c,
      confirmado: true,
    }),
  );
}
const a = await call<{
  vencen: unknown[];
  polizas_pendientes: unknown[];
  registrados_desde_corte: unknown[];
}>("contratos_alertas", { hoy: ctx.hoy });
console.log(
  `Alertas: ${a.vencen.length} vencimientos próximos, ${a.polizas_pendientes.length} pólizas pendientes, ${a.registrados_desde_corte.length} registros desde el corte.`,
);
