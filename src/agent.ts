import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { tools } from "./tools/contratos.js";
import { log } from "./storage.js";
import { extract } from "./extract.js";
import { QwenAdapter, type LlmAdapter } from "./llm/adapter.js";
import type {
  Confirmation,
  Contrato,
  Ctx,
  Message,
  ToolCall,
  Validation,
} from "./types.js";

export type Trace = {
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
};
export type Session = {
  id: string;
  history: { role: string; content: string; toolCalls?: Trace[] }[];
  messages: Message[];
  pending: Confirmation[];
  tokens: number;
  hoy: string;
};
export class Agent {
  sessions = new Map<string, Session>();
  dailyTokens = 0;
  day = new Date().toISOString().slice(0, 10);
  constructor(
    public directory: string,
    public provider = process.env.LLM_PROVIDER ?? "mock",
    private adapter: LlmAdapter = new QwenAdapter(),
  ) {}
  async session(id?: string) {
    if (id && this.sessions.has(id)) return this.sessions.get(id)!;
    if (this.sessions.size >= 200)
      throw new Error("Límite de sesiones alcanzado.");
    const s: Session = {
      id: randomUUID(),
      history: [],
      messages: [
        {
          role: "system",
          content:
            (await fs.readFile(
              path.join(this.directory, "agent", "prompt.md"),
              "utf8",
            )) +
            "\n" +
            (await fs.readFile(
              path.join(
                this.directory,
                "src",
                "knowledge",
                "registro-contratos.md",
              ),
              "utf8",
            )),
        },
      ],
      pending: [],
      tokens: 0,
      hoy: "2026-09-03",
    };
    this.sessions.set(s.id, s);
    return s;
  }
  async call(s: Session, t: ToolCall, traces: Trace[], ctx: Ctx) {
    let raw: string;
    const tool = tools[t.name];
    raw = tool
      ? await tool.execute(t.arguments, ctx)
      : JSON.stringify({ ok: false, error: "Herramienta desconocida." });
    const result = JSON.parse(raw) as {
      ok: boolean;
      data?: unknown;
      error?: string;
    };
    traces.push({ name: t.name, arguments: t.arguments, result });
    await log(ctx, {
      herramienta: t.name,
      mensaje_id: t.arguments.mensaje_id,
      ok: result.ok,
      resumen: result.ok ? "Operación completada" : result.error,
    });
    if (t.name === "contratos_validar" && result.ok) {
      const v = result.data as Validation;
      if (
        v.requiere_revision.length &&
        !s.pending.some((p) => p.mensajeId === t.arguments.mensaje_id)
      )
        s.pending.push({
          mensajeId: t.arguments.mensaje_id as string,
          contrato: t.arguments.contrato as Contrato,
          token: randomUUID(),
        });
    }
    return raw;
  }
  async turn(
    s: Session,
    message: string,
    confirmation?: { token: string; values: Record<string, unknown> },
  ) {
    const traces: Trace[] = [],
      ctx: Ctx = { directory: this.directory, sessionId: s.id, hoy: s.hoy };
    s.history.push({ role: "user", content: message });
    const pending = s.pending;
    s.pending = [];
    let reply = "";
    try {
      if (confirmation) {
        const p = pending.find((p) => p.token === confirmation.token);
        if (!p)
          throw new Error(
            "La confirmación venció. Volvé a validar el contrato.",
          );
        const c = structuredClone(p.contrato);
        const allowed = ["valor", "fecha_inicio", "fecha_fin"];
        for (const [k, v] of Object.entries(confirmation.values)) {
          if (!allowed.includes(k))
            throw new Error("Campo de revisión no permitido.");
          if (k === "valor") {
            if (typeof v !== "number" || !Number.isFinite(v) || v < 0)
              throw new Error("Valor inválido.");
            c.valor = v;
          } else if (k === "fecha_inicio" || k === "fecha_fin") {
            if (typeof v !== "string") throw new Error("Fecha inválida.");
            c[k] = v;
          }
          c.confianza[k] = 1;
          c.fuente[k] = "Confirmación explícita del usuario";
        }
        ctx.autorizacion = { mensajeId: p.mensajeId, contrato: c };
        const raw = await this.call(
          s,
          {
            id: randomUUID(),
            name: "contratos_registrar",
            arguments: {
              mensaje_id: p.mensajeId,
              contrato: c,
              confirmado: true,
            },
          },
          traces,
          ctx,
        );
        if (!(JSON.parse(raw) as { ok: boolean }).ok) {
          s.pending.push({ ...p, token: randomUUID() });
          throw new Error((JSON.parse(raw) as { error: string }).error);
        }
        s.pending.push(
          ...pending
            .filter((x) => x !== p)
            .map((x) => ({ ...x, token: randomUUID() })),
        );
        const alerts = await this.call(
          s,
          {
            id: randomUUID(),
            name: "contratos_alertas",
            arguments: { hoy: s.hoy },
          },
          traces,
          ctx,
        );
        reply = `Registrado ${c.id_contrato} con los valores confirmados. El reporte de alertas fue actualizado.\n\n${this.alertSummary(alerts)}`;
        s.messages.push(
          { role: "user", content: message },
          { role: "assistant", content: reply },
        );
      } else if (this.provider === "mock") {
        s.messages.push({ role: "user", content: message });
        reply = await this.practice(s, traces, ctx);
        s.messages.push({ role: "assistant", content: reply });
      } else {
        s.messages.push({ role: "user", content: message });
        const max = Number(process.env.MAX_ITERATIONS ?? 25),
          budget = Number(process.env.MAX_SESSION_TOKENS ?? 150000);
        if (this.day !== new Date().toISOString().slice(0, 10)) {
          this.day = new Date().toISOString().slice(0, 10);
          this.dailyTokens = 0;
        }
        for (let i = 0; i < max; i++) {
          const reservation =
            Math.ceil(JSON.stringify(s.messages).length / 2) + 2500;
          if (
            s.tokens + reservation > budget ||
            this.dailyTokens + reservation >
              Number(process.env.MAX_DAILY_TOKENS ?? 1000000)
          )
            throw new Error("Se alcanzó el presupuesto de tokens.");
          const r = await this.adapter.enviar(s.messages, tools);
          s.tokens += r.tokens;
          this.dailyTokens += r.tokens;
          s.messages.push({
            role: "assistant",
            content: r.content,
            tool_calls: r.calls.length
              ? r.calls.map((t) => ({
                  id: t.id,
                  type: "function",
                  function: {
                    name: t.name,
                    arguments: JSON.stringify(t.arguments),
                  },
                }))
              : undefined,
          });
          if (!r.calls.length) {
            reply = r.content ?? "Sin respuesta del modelo.";
            break;
          }
          for (const t of r.calls.slice(0, 30)) {
            const raw = await this.call(s, t, traces, ctx);
            s.messages.push({ role: "tool", content: raw, tool_call_id: t.id });
          }
        }
        if (!reply)
          reply =
            "Alcancé el límite de iteraciones. Revisá las operaciones completadas en el historial.";
      }
    } catch (e) {
      reply = e instanceof Error ? e.message : "No se pudo completar el turno.";
    }
    if (s.pending.length)
      reply +=
        "\n\nHay contratos pendientes. Revisá los campos y confirmá expresamente sus valores antes de registrarlos.";
    s.history.push({ role: "assistant", content: reply, toolCalls: traces });
    return {
      sessionId: s.id,
      reply,
      toolCalls: traces,
      needsConfirmation: s.pending.length > 0,
      pending: s.pending,
      tokens: s.tokens,
    };
  }
  alertSummary(raw: string) {
    const r = JSON.parse(raw) as {
      data?: {
        vencen: unknown[];
        polizas_pendientes: unknown[];
        registrados_desde_corte: unknown[];
      };
    };
    return r.data
      ? `Vencen en 60 días: ${r.data.vencen.length}. Pólizas pendientes: ${r.data.polizas_pendientes.length}. Registros desde el corte: ${r.data.registrados_desde_corte.length}.`
      : "";
  }
  async practice(s: Session, traces: Trace[], ctx: Ctx) {
    const call = async (name: string, args: Record<string, unknown>) =>
      JSON.parse(
        await this.call(
          s,
          { id: randomUUID(), name, arguments: args },
          traces,
          ctx,
        ),
      ) as { ok: boolean; data: unknown; error?: string };
    const inbox = await call("contratos_leer_buzon", {});
    if (!inbox.ok) return inbox.error!;
    const summary: string[] = [
      "Modo de práctica: flujo programado sin modelo de IA.",
    ];
    for (const m of (inbox.data as { mensajes: { id: string }[] }).mensajes) {
      const e = await call("contratos_extraer", { mensaje_id: m.id });
      if (!e.ok) {
        summary.push(`${m.id}: ${e.error}`);
        continue;
      }
      const v = await call("contratos_validar", {
        mensaje_id: m.id,
        contrato: e.data,
      });
      if (!v.ok) {
        summary.push(`${m.id}: ${v.error}`);
        continue;
      }
      const validation = v.data as Validation;
      if (validation.requiere_revision.length)
        summary.push(
          `${m.id}: ${validation.clasificacion} · revisión de ${validation.requiere_revision.join(", ")}.`,
        );
      else {
        const r = await call("contratos_registrar", {
          mensaje_id: m.id,
          contrato: e.data,
        });
        summary.push(
          `${m.id}: ${validation.clasificacion} · ${r.ok ? "procesado" : r.error}.`,
        );
      }
    }
    const a = await call("contratos_alertas", { hoy: s.hoy });
    if (a.ok) summary.push(this.alertSummary(JSON.stringify(a)));
    return summary.join("\n\n");
  }
}
