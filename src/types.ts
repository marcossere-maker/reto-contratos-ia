import { z } from "zod";

export const fields = {
  id_contrato: z.string().nullable(),
  cliente: z.string().nullable(),
  nit_cliente: z.string().nullable(),
  pais: z.enum(["CO", "EC", "PE", "PA", "HN"]).nullable(),
  objeto: z.string().max(200).nullable(),
  valor: z.number().nonnegative().nullable(),
  moneda: z.enum(["COP", "USD", "PEN", "PAB", "HNL"]).nullable(),
  fecha_inicio: z.string().nullable(),
  fecha_fin: z.string().nullable(),
  requiere_poliza: z.boolean().nullable(),
  tipo_poliza: z.string().nullable(),
  estado_poliza: z
    .enum(["vigente", "pendiente", "vencida", "no_aplica"])
    .nullable(),
  comercial: z.string().nullable(),
  valor_indeterminado: z.boolean(),
};
export const contratoSchema = z.object(fields).extend({
  confianza: z.record(z.number().min(0).max(1)),
  fuente: z.record(z.string()),
  es_otrosi: z.boolean(),
  observaciones: z.array(z.string()),
});
export type Contrato = z.infer<typeof contratoSchema>;
export type Field = keyof typeof fields;
export type Row = Record<string, string>;
export type Correo = {
  id: string;
  de: string;
  asunto: string;
  fecha: string;
  cuerpo: string;
  adjuntos: string[];
};
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
export type Validation = {
  clasificacion: "nuevo" | "actualizacion" | "duplicado" | "rechazado";
  id_contrato_existente?: string;
  requiere_revision: string[];
  diferencias: Record<string, { antes: string; despues: unknown }>;
  motivo?: string;
};
export type Confirmation = {
  mensajeId: string;
  contrato: Contrato;
  token: string;
};
export type Ctx = {
  directory: string;
  sessionId: string;
  hoy?: string;
  autorizacion?: { mensajeId: string; contrato: Contrato };
};
export type Tool = {
  description: string;
  args: Record<string, z.ZodTypeAny>;
  execute: (args: Record<string, unknown>, ctx: Ctx) => Promise<string>;
};
export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};
export type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
};
