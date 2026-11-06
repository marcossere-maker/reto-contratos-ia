import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { CloudState, withCloudWorkspace } from "../src/cloud-state.js";
import { rows } from "../src/storage.js";

test("El estado restaurado conserva registros y confirmaciones entre instancias", async () => {
  process.env.RETO_SCRATCH_DIR = process.cwd();
  const oldProvider = process.env.LLM_PROVIDER;
  process.env.LLM_PROVIDER = "mock";
  // Sustituto del transporte; las reglas del agente y los archivos son reales.
  const store = new CloudState();
  let saved = {
    id: "demo",
    state: { files: {}, sessions: [], dailyTokens: 0, day: "2026-09-03" },
    version: 0,
    lock_owner: null,
    locked_until: null,
  } as Awaited<ReturnType<CloudState["read"]>>;
  store.read = async () => structuredClone(saved);
  store.acquire = async () => ({
    ...structuredClone(saved),
    lock_owner: "00000000-0000-4000-8000-000000000001",
  });
  store.commit = async (row, state) => {
    saved = {
      ...row,
      state: structuredClone(state),
      version: row.version + 1,
      lock_owner: null,
    };
    return saved.version;
  };
  store.release = async () => {};
  try {
    // Primera instancia procesa el buzón y persiste la revisión.
    const first = await withCloudWorkspace(
      process.cwd(),
      async (agent) => {
        const s = await agent.session();
        return agent.turn(s, "Procesa el buzón");
      },
      false,
      store,
    );
    assert.equal(saved.state.contracts?.length, 10);
    assert.equal(saved.state.sessions.length, 1);
    assert.equal(first.pending.length, 1);
    // Otra instancia reconstruye archivos y sesión desde el estado persistido.
    await withCloudWorkspace(
      process.cwd(),
      async (agent) => {
        const s = await agent.session(first.sessionId);
        assert.equal(s.pending[0].token, first.pending[0].token);
        const done = await agent.turn(s, "Confirmo", {
          token: s.pending[0].token,
          values: {
            valor: 0,
            fecha_inicio: "2026-08-31",
            fecha_fin: "2027-08-31",
          },
        });
        assert.match(done.reply, /Registrado/);
        assert.equal(
          (await rows({ directory: process.cwd(), sessionId: s.id })).length,
          11,
        );
      },
      false,
      store,
    );
    assert.equal(saved.version, 2);
    assert.equal(saved.state.contracts?.length, 11);
    assert.ok(
      saved.state.files[
        "sharepoint/Contratos/2026/distribuidora-caribe-s-a-s/CM-2026-03.txt"
      ],
    );
    await withCloudWorkspace(
      process.cwd(),
      async (agent) => {
        assert.equal(agent.sessions.get(first.sessionId)?.pending.length, 0);
      },
      true,
      store,
    );
    assert.equal(saved.version, 2);
  } finally {
    if (oldProvider === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = oldProvider;
  }
});
