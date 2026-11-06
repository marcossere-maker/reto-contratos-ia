import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Message, Tool, ToolCall } from "../types.js";
export type LlmResponse = {
  content: string | null;
  calls: ToolCall[];
  tokens: number;
};
export interface LlmAdapter {
  enviar(
    messages: Message[],
    tools: Record<string, Tool>,
  ): Promise<LlmResponse>;
}
const responseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                id: z.string(),
                function: z.object({ name: z.string(), arguments: z.string() }),
              }),
            )
            .optional(),
        }),
      }),
    )
    .min(1),
  usage: z.object({ total_tokens: z.number() }).optional(),
});
export class QwenAdapter implements LlmAdapter {
  async enviar(
    messages: Message[],
    tools: Record<string, Tool>,
  ): Promise<LlmResponse> {
    const key = process.env.LLM_API_KEY;
    if (!key) throw new Error("Falta LLM_API_KEY en el entorno del backend.");
    const base = process.env.LLM_BASE_URL;
    if (!base) throw new Error("Falta LLM_BASE_URL del proveedor de tu clave.");
    const options = base.includes("api.groq.com")
      ? { reasoning_effort: "none", max_completion_tokens: 1200 }
      : { enable_thinking: false, max_tokens: 2500 };
    const resp = await fetch(base.replace(/\/$/, "") + "/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS ?? 45000)),
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL ?? "qwen/qwen3.8-27b",
        messages,
        ...(Object.keys(tools).length
          ? {
              tools: Object.entries(tools).map(([name, t]) => ({
                type: "function",
                function: {
                  name,
                  description: t.description,
                  parameters: zodToJsonSchema(z.object(t.args), {
                    $refStrategy: "none",
                  }),
                },
              })),
            }
          : { tool_choice: "none" }),
        ...options,
        temperature: 0,
      }),
    });
    if (resp.status === 429)
      throw new Error(
        "Groq alcanzó el límite de uso de esta cuenta. Esperá un minuto y volvé a intentar; tu clave puede ser válida aunque la cuota esté agotada.",
      );
    if (!resp.ok)
      throw new Error(
        `El proveedor del modelo respondió HTTP ${resp.status}. Revisá modelo, URL, cuota y clave en el backend.`,
      );
    const parsed = responseSchema.parse(await resp.json()),
      m = parsed.choices[0].message;
    return {
      content: m.content ?? null,
      calls: (m.tool_calls ?? []).map((t) => ({
        id: t.id,
        name: t.function.name,
        arguments: JSON.parse(t.function.arguments) as Record<string, unknown>,
      })),
      tokens:
        parsed.usage?.total_tokens ??
        Math.ceil(JSON.stringify(messages).length / 3) + 2500,
    };
  }
}
