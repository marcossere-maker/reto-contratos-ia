import express from "express";
import path from "node:path";
import { promises as fs } from "node:fs";
import { z } from "zod";
import { Agent } from "./agent.js";
import { init, output, rows, processed } from "./storage.js";
import {
  cloudEnabled,
  withCloudWorkspace,
  WorkspaceBusy,
} from "./cloud-state.js";
const directory = process.cwd(),
  localAgent = new Agent(directory),
  app = express();
let localQueue = Promise.resolve();
async function workspace<T>(
  run: (agent: Agent, version: number) => Promise<T>,
  readOnly = false,
) {
  if (cloudEnabled()) return withCloudWorkspace(directory, run, readOnly);
  let result: T;
  const task = async () => {
    await init({ directory, sessionId: "local" });
    result = await run(localAgent, 0);
  };
  const promise = localQueue.then(task, task);
  localQueue = promise.catch(() => undefined);
  await promise;
  return result!;
}
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  );
  next();
});
const chatSchema = z.object({
  sessionId: z.string().uuid().optional(),
  message: z.string().min(1).max(5000),
  confirmation: z
    .object({ token: z.string().uuid(), values: z.record(z.unknown()) })
    .optional(),
});
function fail(res: express.Response, error: unknown) {
  res
    .status(error instanceof WorkspaceBusy ? 409 : 503)
    .json({
      error:
        error instanceof Error
          ? error.message
          : "No se pudo completar la operación.",
    });
}
const rates = new Map<string, { ts: number; n: number }>();
app.post("/api/chat", async (req, res) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Petición inválida." });
    return;
  }
  const ip = req.ip ?? "local",
    now = Date.now(),
    rate = rates.get(ip);
  if (rate && now - rate.ts < 60000 && rate.n >= 10) {
    res.status(429).json({ error: "Esperá un minuto antes de continuar." });
    return;
  }
  rates.set(
    ip,
    rate && now - rate.ts < 60000
      ? { ...rate, n: rate.n + 1 }
      : { ts: now, n: 1 },
  );
  if (rates.size > 1000)
    for (const [k, r] of rates) if (now - r.ts > 60000) rates.delete(k);
  try {
    const data = await workspace(async (agent) => {
      const s = await agent.session(parsed.data.sessionId);
      return agent.turn(s, parsed.data.message, parsed.data.confirmation);
    });
    res.json(data);
  } catch (e) {
    fail(res, e);
  }
});
app.post("/api/demo/reset", async (req, res) => {
  if (req.body?.confirm !== "reiniciar-datos-ficticios") {
    res
      .status(400)
      .json({ error: "Falta confirmar el reinicio de los datos ficticios." });
    return;
  }
  try {
    await workspace(async (agent) => {
      await fs.rm(output({ directory, sessionId: "reset" }), {
        recursive: true,
        force: true,
      });
      await init({ directory, sessionId: "reset" });
      agent.sessions.clear();
    });
    res.json({ ok: true });
  } catch (e) {
    fail(res, e);
  }
});
app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    provider: process.env.LLM_PROVIDER ?? "mock",
    model:
      process.env.LLM_PROVIDER && process.env.LLM_PROVIDER !== "mock"
        ? process.env.LLM_MODEL
        : "flujo programado (sin IA)",
    configured:
      !process.env.LLM_PROVIDER ||
      process.env.LLM_PROVIDER === "mock" ||
      !!(process.env.LLM_API_KEY && process.env.LLM_BASE_URL),
    storage: cloudEnabled() ? "supabase" : "local",
  }),
);
app.get("/api/sessions/:id", async (req, res) => {
  try {
    const data = await workspace(async (agent) => {
      const s = agent.sessions.get(req.params.id);
      return s
        ? { sessionId: s.id, history: s.history, pending: s.pending }
        : null;
    }, true);
    if (!data) {
      res.status(404).json({ error: "Sesión inexistente." });
      return;
    }
    res.json(data);
  } catch (e) {
    fail(res, e);
  }
});
app.get("/api/state", async (_req, res) => {
  try {
    res.json(
      await workspace(
        async (agent, revision) => ({
          storage: cloudEnabled() ? "supabase" : "local",
          revision,
          contracts: (await rows({ directory, sessionId: "status" })).length,
          processed: (await processed({ directory, sessionId: "status" }))
            .length,
          sessions: agent.sessions.size,
        }),
        true,
      ),
    );
  } catch (e) {
    fail(res, e);
  }
});
app.get("/api/report", async (_req, res) => {
  try {
    const data = await workspace(
      async () =>
        fs.readFile(
          output({ directory, sessionId: "report" }, "alertas.md"),
          "utf8",
        ),
      true,
    );
    res.attachment("alertas.md").type("text/markdown").send(data);
  } catch {
    res.status(404).json({ error: "Primero generá las alertas." });
  }
});
app.get("/api/master", async (_req, res) => {
  try {
    const data = await workspace(
      async () =>
        fs.readFile(
          output(
            { directory, sessionId: "master" },
            "sharepoint",
            "maestro-contratos.csv",
          ),
          "utf8",
        ),
      true,
    );
    res.attachment("maestro-contratos.csv").type("text/csv").send(data);
  } catch (e) {
    fail(res, e);
  }
});
app.use(express.static(path.join(directory, "web")));
app.use(
  (
    _err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    res.status(400).json({ error: "Solicitud no válida." });
  },
);
export default app;
