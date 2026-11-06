import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { Agent, type Session } from "./agent.js";
import { init, output, rows, withOutputDirectory } from "./storage.js";
import type { Row } from "./types.js";

type Snapshot = {
  files: Record<string, string>;
  sessions: Session[];
  contracts?: Row[];
  dailyTokens: number;
  day: string;
};
type StateRow = {
  id: string;
  state: Snapshot;
  version: number;
  lock_owner: string | null;
  locked_until: string | null;
};
export class WorkspaceBusy extends Error {}
export const cloudEnabled = () => process.env.STORAGE_PROVIDER === "supabase";
export class CloudState {
  constructor(
    private url = process.env.SUPABASE_URL,
    private key = process.env.SUPABASE_PUBLISHABLE_KEY,
    private token = process.env.STORAGE_ACCESS_TOKEN,
    public readonly workspaceId = "demo",
  ) {
    if (!/^(demo|v_[a-f0-9]{64})$/.test(workspaceId))
      throw new Error("Espacio inválido.");
  }
  async rpc(name: string, body: unknown): Promise<unknown> {
    if (!this.url || !this.key || !this.token)
      throw new Error("Persistencia sin configurar.");
    const response = await fetch(`${this.url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: this.key,
        "x-reto-token": this.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error("No se pudo autorizar la operación de la demo.");
    return response.json();
  }
  async ensure() {
    await this.rpc("reto02_create_workspace", { p_id: this.workspaceId });
  }
  async takeRate(bucket: string, limit: number, seconds: number) {
    return (
      (await this.rpc("reto02_take_rate", {
        p_bucket: bucket,
        p_limit: limit,
        p_seconds: seconds,
      })) === true
    );
  }
  async request(
    query: string,
    method = "GET",
    body?: unknown,
  ): Promise<StateRow[]> {
    if (!this.url || !this.key || !this.token)
      throw new Error(
        "Falta configurar la persistencia de Supabase en el backend.",
      );
    const response = await fetch(`${this.url}/rest/v1/reto02_state?${query}`, {
      method,
      headers: {
        apikey: this.key,
        "x-reto-token": this.token,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(
        `No se pudo acceder a la persistencia (HTTP ${response.status}).`,
      );
    return (await response.json()) as StateRow[];
  }
  async read() {
    const row = (
      await this.request(
        `id=eq.${this.workspaceId}&select=id,state,version,lock_owner,locked_until`,
      )
    )[0];
    if (!row)
      throw new Error(
        "No se encontró el entorno del reto o falta autorización.",
      );
    return row;
  }
  async acquire() {
    const row = await this.read(),
      owner = randomUUID(),
      now = new Date().toISOString();
    const acquired = await this.request(
      `id=eq.${this.workspaceId}&version=eq.${row.version}&or=(locked_until.is.null,locked_until.lt.${now})`,
      "PATCH",
      {
        lock_owner: owner,
        locked_until: new Date(Date.now() + 360000).toISOString(),
      },
    );
    if (!acquired.length)
      throw new WorkspaceBusy(
        "Hay otra operación en curso. Esperá a que termine y volvé a intentar.",
      );
    return { ...row, lock_owner: owner };
  }
  async commit(row: StateRow, state: Snapshot) {
    const result = await this.request(
      `id=eq.${this.workspaceId}&version=eq.${row.version}&lock_owner=eq.${row.lock_owner}&locked_until=gt.${new Date().toISOString()}`,
      "PATCH",
      {
        state,
        version: row.version + 1,
        lock_owner: null,
        locked_until: null,
        updated_at: new Date().toISOString(),
      },
    );
    if (!result.length)
      throw new Error(
        "La operación perdió su autorización de escritura. Los cambios no se confirmaron.",
      );
    return row.version + 1;
  }
  async release(row: StateRow) {
    await this.request(
      `id=eq.${this.workspaceId}&lock_owner=eq.${row.lock_owner}`,
      "PATCH",
      {
        lock_owner: null,
        locked_until: null,
      },
    );
  }
}
async function collect(
  directory: string,
  prefix = "",
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name,
      absolute = path.join(directory, entry.name);
    if (entry.isDirectory())
      Object.assign(result, await collect(absolute, relative + "/"));
    else if (entry.isFile() && !entry.name.endsWith(".tmp"))
      result[relative] = await fs.readFile(absolute, "utf8");
  }
  return result;
}
export async function withCloudWorkspace<T>(
  directory: string,
  run: (agent: Agent, version: number) => Promise<T>,
  readOnly = false,
  store = new CloudState(),
): Promise<T> {
  const row = readOnly ? await store.read() : await store.acquire();
  let committed = false;
  const scratch = await fs.mkdtemp(
    path.join(process.env.RETO_SCRATCH_DIR ?? os.tmpdir(), ".test-run-cloud-"),
  );
  try {
    return await withOutputDirectory(path.join(scratch, "out"), async () => {
      const ctx = { directory, sessionId: "cloud" };
      for (const [relative, content] of Object.entries(row.state.files ?? {})) {
        if (
          relative.startsWith("/") ||
          relative.includes("\\") ||
          relative.split("/").includes("..")
        )
          throw new Error("Ruta almacenada inválida.");
        const file = output(ctx, relative);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, content);
      }
      await init(ctx);
      const agent = new Agent(directory);
      agent.sessions = new Map(
        (row.state.sessions ?? []).map((s) => [s.id, s]),
      );
      agent.dailyTokens = row.state.dailyTokens ?? 0;
      agent.day = row.state.day ?? new Date().toISOString().slice(0, 10);
      const result = await run(agent, row.version);
      if (!readOnly) {
        const state: Snapshot = {
          files: await collect(output(ctx)),
          sessions: [...agent.sessions.values()].slice(-30),
          contracts: await rows(ctx),
          dailyTokens: agent.dailyTokens,
          day: agent.day,
        };
        if (JSON.stringify(state).length > 8_000_000)
          throw new Error(
            "El entorno de demostración alcanzó su capacidad. Exportá los resultados y reiniciá los datos ficticios.",
          );
        await store.commit(row, state);
        committed = true;
      }
      return result;
    });
  } finally {
    if (!readOnly && !committed)
      await store.release(row).catch(() => undefined);
    await fs.rm(scratch, { recursive: true, force: true });
  }
}
