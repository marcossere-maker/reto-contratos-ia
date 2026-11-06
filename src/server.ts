import express from "express";
import path from "node:path";
import { promises as fs } from "node:fs";
import { z } from "zod";
import { Agent } from "./agent.js";
import { init, output } from "./storage.js";
const directory = process.cwd(),
  agent = new Agent(directory),
  app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  );
  next();
});
const body = z.object({
  sessionId: z.string().uuid().optional(),
  message: z.string().min(1).max(5000),
  confirmation: z
    .object({ token: z.string().uuid(), values: z.record(z.unknown()) })
    .optional(),
});
const rates = new Map<string, { ts: number; n: number }>();
let queue = Promise.resolve();
app.post("/api/demo/reset", async (req, res) => {
  if (req.body?.confirm !== "reiniciar-datos-ficticios") {
    res
      .status(400)
      .json({ error: "Falta confirmar el reinicio de los datos ficticios." });
    return;
  }
  const run = async () => {
    try {
      await fs.rm(output({ directory, sessionId: "reset" }), {
        recursive: true,
        force: true,
      });
      await init({ directory, sessionId: "reset" });
      agent.sessions.clear();
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "No se pudo reiniciar la demo." });
    }
  };
  queue = queue.then(run, run);
  await queue;
});
app.post("/api/chat", async (req, res) => {
  const parsed = body.safeParse(req.body);
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
    for (const [key, r] of rates) if (now - r.ts > 60000) rates.delete(key);
  const run = async () => {
    try {
      const s = await agent.session(parsed.data.sessionId);
      res.json(
        await agent.turn(s, parsed.data.message, parsed.data.confirmation),
      );
    } catch {
      res.status(500).json({ error: "No se pudo iniciar la sesión." });
    }
  };
  queue = queue.then(run, run);
  await queue;
});
app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    provider: agent.provider,
    model:
      agent.provider === "mock"
        ? "flujo programado (sin IA)"
        : (process.env.LLM_MODEL ?? "qwen3.5-plus"),
    configured:
      agent.provider === "mock" ||
      !!(process.env.LLM_API_KEY && process.env.LLM_BASE_URL),
  }),
);
app.get("/api/sessions/:id", (req, res) => {
  const s = agent.sessions.get(req.params.id);
  if (!s) {
    res.status(404).json({ error: "Sesión inexistente." });
    return;
  }
  res.json({ sessionId: s.id, history: s.history, pending: s.pending });
});
app.get("/api/report", (_req, res) =>
  res.download(
    output({ directory, sessionId: "report" }, "alertas.md"),
    "alertas.md",
    (e) => {
      if (e && !res.headersSent)
        res.status(404).json({ error: "Primero generá las alertas." });
    },
  ),
);
app.use(express.static(path.join(directory, "web")));
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    res.status(400).json({ error: "Solicitud no válida." });
  },
);
await init({ directory, sessionId: "startup" });
app.listen(Number(process.env.PORT ?? 3000), "0.0.0.0", () =>
  console.log(
    `Contratos listo en http://localhost:${process.env.PORT ?? 3000} · proveedor ${agent.provider}`,
  ),
);
