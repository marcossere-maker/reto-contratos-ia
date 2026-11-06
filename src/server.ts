import express from "express";
import path from "node:path";
import { promises as fs } from "node:fs";
import { z } from "zod";
import os from "node:os";
import {
  issueVisitor,
  visitorId,
  requestVisitor,
  visitorCookie,
  ipBucket,
  takeRate,
  securityHeaders,
} from "./security.js";
import { Agent } from "./agent.js";
import {
  init,
  output,
  rows,
  processed,
  exportCsv,
  withOutputDirectory,
} from "./storage.js";
import {
  CloudState,
  cloudEnabled,
  withCloudWorkspace,
  WorkspaceBusy,
} from "./cloud-state.js";
const directory = process.cwd(),
  app = express();
const localAgents = new Map<string, Agent>();
const localQueues = new Map<string, Promise<void>>();
async function workspace<T>(
  id: string,
  run: (agent: Agent, version: number) => Promise<T>,
  readOnly = false,
) {
  if (cloudEnabled())
    return withCloudWorkspace(
      directory,
      run,
      readOnly,
      new CloudState(undefined, undefined, undefined, id),
    );
  let result: T;
  const task = () =>
    withOutputDirectory(
      path.join(
        process.env.RETO_SCRATCH_DIR ?? os.tmpdir(),
        "reto02-visitors",
        id,
      ),
      async () => {
        await init({ directory, sessionId: "local" });
        let agent = localAgents.get(id);
        if (!agent) {
          agent = new Agent(directory);
          localAgents.set(id, agent);
        }
        result = await run(agent, 0);
      },
    );
  const promise = (localQueues.get(id) ?? Promise.resolve()).then(task, task);
  localQueues.set(
    id,
    promise.catch(() => undefined),
  );
  await promise;
  return result!;
}
app.disable("x-powered-by");
// Se aplican antes del parser: incluso los errores JSON reciben las cabeceras.
app.use((_req, res, next) => {
  for (const [key, value] of Object.entries(securityHeaders))
    res.setHeader(key, value);
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use("/api", (req, res, next) => {
  if (req.method === "POST") {
    const origin = req.get("origin");
    const ownOrigin = `${process.env.VERCEL ? "https" : req.protocol}://${req.get("host")}`;
    if (
      (origin && origin !== ownOrigin) ||
      req.get("sec-fetch-site") === "cross-site"
    ) {
      res.status(403).json({ error: "Origen no permitido." });
      return;
    }
    if (!req.is("application/json")) {
      res.status(415).json({ error: "Se requiere JSON." });
      return;
    }
  }
  next();
});
app.use(express.json({ limit: "32kb" }));
app.get("/api/health", (_req, res) => res.json({ ok: true }));
const configuration = () => ({
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
});
app.post("/api/visitor", async (req, res) => {
  try {
    const ip = ipBucket(req);
    if (!(await takeRate("boot:" + ip, 30, 60))) {
      res.status(429).json({ error: "Esper� un minuto antes de continuar." });
      return;
    }
    let id = requestVisitor(req);
    if (!id) {
      if (!(await takeRate("new:" + ip, 10, 86400))) {
        res
          .status(429)
          .json({ error: "L�mite diario de espacios de prueba alcanzado." });
        return;
      }
      const value = issueVisitor();
      id = visitorId(value)!;
      if (cloudEnabled())
        await new CloudState(undefined, undefined, undefined, id).ensure();
      res.setHeader("Set-Cookie", visitorCookie(value));
    }
    res.json({ ok: true, ...configuration() });
  } catch (e) {
    fail(res, e);
  }
});
app.use("/api", (req, res, next) => {
  const id = requestVisitor(req);
  if (!id) {
    res
      .status(401)
      .json({ error: "Abr� la demo para iniciar tu espacio de prueba." });
    return;
  }
  res.locals.visitorId = id;
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
  res.status(error instanceof WorkspaceBusy ? 409 : 503).json({
    error:
      error instanceof Error
        ? error.message
        : "No se pudo completar la operación.",
  });
}
app.post("/api/chat", async (req, res) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Petici�n inv�lida." });
    return;
  }
  try {
    if (
      !(await takeRate("chat-ip:" + ipBucket(req), 10, 60)) ||
      !(await takeRate("chat-visitor:" + res.locals.visitorId, 6, 60)) ||
      !(await takeRate("chat-day:" + res.locals.visitorId, 30, 86400)) ||
      !(await takeRate("chat-global", 100, 86400))
    ) {
      res
        .status(429)
        .json({
          error: "Se alcanz� un l�mite de uso de la demo. Prob� m�s tarde.",
        });
      return;
    }
    const data = await workspace(res.locals.visitorId, async (agent) => {
      if (parsed.data.sessionId && !agent.sessions.has(parsed.data.sessionId)) {
        res.status(404);
        throw new Error("Sesi�n inexistente en este espacio.");
      }
      const s = await agent.session(parsed.data.sessionId);
      return agent.turn(s, parsed.data.message, parsed.data.confirmation);
    });
    res.json(data);
  } catch (e) {
    if (res.statusCode === 404)
      res.json({ error: "Sesi�n inexistente en este espacio." });
    else fail(res, e);
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
    if (!(await takeRate("reset:" + res.locals.visitorId, 3, 60))) {
      res.status(429).json({ error: "Esper� antes de reiniciar nuevamente." });
      return;
    }
    await workspace(res.locals.visitorId, async (agent) => {
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
app.get("/api/sessions/:id", async (req, res) => {
  try {
    const data = await workspace(
      res.locals.visitorId,
      async (agent) => {
        const s = agent.sessions.get(req.params.id);
        return s
          ? { sessionId: s.id, history: s.history, pending: s.pending }
          : null;
      },
      true,
    );
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
        res.locals.visitorId,
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
      res.locals.visitorId,
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
      res.locals.visitorId,
      async () => {
        const data = await rows({ directory, sessionId: "master" });
        // Solo la descarga se neutraliza; el maestro can�nico conserva los datos originales.
        return exportCsv(data);
      },
      true,
    );
    res.attachment("maestro-contratos.csv").type("text/csv").send(data);
  } catch (e) {
    fail(res, e);
  }
});
app.use(express.static(path.join(directory, "web")));
app.use((_req, res) => {
  res.status(404).json({ error: "Recurso inexistente." });
});
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
