import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { tools } from "../src/tools/contratos.js";
import { extract } from "../src/extract.js";
import { rows, output, processed } from "../src/storage.js";
import { Agent } from "../src/agent.js";
import type { Contrato, Ctx, Result, Validation } from "../src/types.js";
import type { LlmAdapter } from "../src/llm/adapter.js";

test("El lote conserva las herramientas y termina sin otra ronda de herramientas del modelo", async () => {
  const ctx = await setup();
  try {
    let requests = 0;
    const adapter: LlmAdapter = {
      async enviar(messages, available) {
        requests++;
        if (requests === 1) {
          assert.ok(available.contratos_procesar_buzon);
          return {
            content: null,
            calls: [
              {
                id: "batch-1",
                name: "contratos_procesar_buzon",
                arguments: { hoy: "2026-09-03" },
              },
            ],
            tokens: 100,
          };
        }
        assert.equal(Object.keys(available).length, 0);
        assert.equal(messages.at(-1)?.role, "tool");
        return {
          content:
            "Los contratos claros fueron registrados. Falta confirmar el contrato marco.",
          calls: [],
          tokens: 100,
        };
      },
    };
    const a = new Agent(ctx.directory, "test", adapter),
      s = await a.session(),
      r = await a.turn(s, "Procesa el buzón");
    assert.equal(requests, 2);
    assert.equal(r.toolCalls.length, 20);
    assert.equal(r.pending.length, 1);
    assert.equal((await rows(ctx)).length, 10);
    assert.equal((await processed(ctx)).length, 5);
  } finally {
    await fs.rm(ctx.directory, { recursive: true, force: true });
  }
});

test("Un correo corrupto no impide listar ni procesar los demás", async () => {
  const ctx = await setup();
  try {
    await fs.writeFile(
      path.join(ctx.directory, "fixtures/reto-02/buzon/msg-001/correo.json"),
      "{",
    );
    const inbox = await call<{ mensajes: { id: string; error?: string }[] }>(
      ctx,
      "contratos_leer_buzon",
      {},
    );
    assert.ok(inbox.ok);
    assert.equal(inbox.data.mensajes.length, 6);
    assert.ok(inbox.data.mensajes[0].error);
    assert.equal(
      (await call(ctx, "contratos_extraer", { mensaje_id: "msg-001" })).ok,
      false,
    );
    assert.equal(
      (await call(ctx, "contratos_extraer", { mensaje_id: "msg-002" })).ok,
      true,
    );
  } finally {
    await fs.rm(ctx.directory, { recursive: true, force: true });
  }
});
async function setup(): Promise<Ctx> {
  const directory = await fs.mkdtemp(path.join(process.cwd(), ".test-run-"));
  await fs.cp(
    path.join(process.cwd(), "fixtures"),
    path.join(directory, "fixtures"),
    { recursive: true },
  );
  await fs.cp(
    path.join(process.cwd(), "agent"),
    path.join(directory, "agent"),
    { recursive: true },
  );
  await fs.mkdir(path.join(directory, "src", "knowledge"), { recursive: true });
  await fs.copyFile(
    "src/knowledge/registro-contratos.md",
    path.join(directory, "src", "knowledge", "registro-contratos.md"),
  );
  return { directory, sessionId: "test", hoy: "2026-09-03" };
}
async function call<T>(ctx: Ctx, name: string, args: Record<string, unknown>) {
  return JSON.parse(await tools[name].execute(args, ctx)) as Result<T>;
}
test("Seis casos, aprobación humana, auditoría, alertas e idempotencia", async () => {
  const ctx = await setup();
  try {
    const expected = [
      "nuevo",
      "nuevo",
      "actualizacion",
      "duplicado",
      "rechazado",
      "nuevo",
    ];
    const contracts: Contrato[] = [];
    for (let i = 1; i <= 6; i++) {
      const id = `msg-00${i}`,
        c = await extract(ctx, id);
      contracts.push(c);
      const r = await call<Validation>(ctx, "contratos_validar", {
        mensaje_id: id,
        contrato: c,
      });
      assert.ok(r.ok);
      assert.equal(r.data.clasificacion, expected[i - 1]);
      if (i < 6) {
        assert.deepEqual(r.data.requiere_revision, []);
        assert.ok(
          (
            await call(ctx, "contratos_registrar", {
              mensaje_id: id,
              contrato: c,
            })
          ).ok,
        );
      } else {
        assert.deepEqual(r.data.requiere_revision.sort(), [
          "fecha_fin",
          "fecha_inicio",
          "valor",
        ]);
        assert.equal(
          (
            await call(ctx, "contratos_registrar", {
              mensaje_id: id,
              contrato: c,
              confirmado: true,
            })
          ).ok,
          false,
        );
      }
    }
    assert.equal((await rows(ctx)).length, 10);
    assert.equal(
      (await rows(ctx)).find((r) => r.id_contrato === "CT-2026-011")!.valor,
      "520000",
    );
    const c = structuredClone(contracts[5]);
    c.valor = 0;
    c.fecha_inicio = "2026-08-31";
    c.fecha_fin = "2027-08-31";
    for (const k of ["valor", "fecha_inicio", "fecha_fin"]) {
      c.confianza[k] = 1;
      c.fuente[k] = "Usuario";
    }
    assert.equal(
      (
        await call(ctx, "contratos_registrar", {
          mensaje_id: "msg-006",
          contrato: c,
          confirmado: true,
        })
      ).ok,
      false,
    );
    ctx.autorizacion = { mensajeId: "msg-006", contrato: c };
    assert.ok(
      (
        await call(ctx, "contratos_registrar", {
          mensaje_id: "msg-006",
          contrato: c,
          confirmado: true,
        })
      ).ok,
    );
    assert.ok(
      (
        await call(ctx, "contratos_registrar", {
          mensaje_id: "msg-006",
          contrato: c,
          confirmado: true,
        })
      ).ok,
    );
    assert.equal((await rows(ctx)).length, 11);
    assert.equal((await processed(ctx)).length, 6);
    assert.ok((await call(ctx, "contratos_alertas", { hoy: ctx.hoy })).ok);
    assert.match(
      await fs.readFile(output(ctx, "alertas.md"), "utf8"),
      /CT-2026-009/,
    );
    assert.equal(
      (await fs.readFile(output(ctx, "sharepoint", "historial.jsonl"), "utf8"))
        .trim()
        .split("\n").length,
      4,
    );
  } finally {
    await fs.rm(ctx.directory, { recursive: true, force: true });
  }
});
test("La extracción no admite cambios del modelo y las herramientas devuelven errores tipados", async () => {
  const ctx = await setup();
  try {
    const c = await extract(ctx, "msg-001");
    c.valor = 1;
    assert.equal(
      (
        await call(ctx, "contratos_registrar", {
          mensaje_id: "msg-001",
          contrato: c,
        })
      ).ok,
      false,
    );
    assert.equal(
      (await call(ctx, "contratos_extraer", { mensaje_id: "../../secret" })).ok,
      false,
    );
    assert.equal(
      (await call(ctx, "contratos_alertas", { hoy: "2026-02-30" })).ok,
      false,
    );
    assert.equal(
      (await call(ctx, "contratos_extraer", { mensaje_id: "msg-999" })).ok,
      false,
    );
    assert.ok(
      (await call(ctx, "contratos_extraer", { mensaje_id: "msg-002" })).ok,
    );
  } finally {
    await fs.rm(ctx.directory, { recursive: true, force: true });
  }
});
test("Chat de práctica: exige turno posterior, consume la confirmación y preserva historial", async () => {
  const ctx = await setup();
  try {
    const agent = new Agent(ctx.directory, "mock"),
      s = await agent.session();
    const first = await agent.turn(s, "Procesá el buzón");
    assert.equal(first.needsConfirmation, true);
    assert.equal(first.pending.length, 1);
    const token = first.pending[0].token;
    const done = await agent.turn(s, "Confirmo", {
      token,
      values: { valor: 0, fecha_inicio: "2026-08-31", fecha_fin: "2027-08-31" },
    });
    assert.match(done.reply, /Registrado/);
    assert.equal(done.needsConfirmation, false);
    const repeat = await agent.turn(s, "Confirmo otra vez", {
      token,
      values: { valor: 0 },
    });
    assert.match(repeat.reply, /venció/);
    assert.equal((await rows(ctx)).length, 11);
    assert.ok(first.toolCalls.length >= 18);
  } finally {
    await fs.rm(ctx.directory, { recursive: true, force: true });
  }
});
test("El ciclo real ejecuta las llamadas del adaptador y conserva el protocolo", async () => {
  const ctx = await setup();
  try {
    let i = 0;
    const adapter: LlmAdapter = {
      async enviar(messages) {
        i++;
        if (i === 1)
          return {
            content: null,
            calls: [
              { id: "call-1", name: "contratos_leer_buzon", arguments: {} },
            ],
            tokens: 100,
          };
        assert.equal(messages.at(-1)?.role, "tool");
        assert.equal(messages.at(-1)?.tool_call_id, "call-1");
        return {
          content: "Hay seis mensajes pendientes según el buzón.",
          calls: [],
          tokens: 100,
        };
      },
    };
    const agent = new Agent(ctx.directory, "test", adapter),
      s = await agent.session();
    const r = await agent.turn(s, "Leé el buzón");
    assert.equal(r.toolCalls.length, 1);
    assert.equal(r.tokens, 200);
    assert.match(r.reply, /seis/);
  } finally {
    await fs.rm(ctx.directory, { recursive: true, force: true });
  }
});
