import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { parse } from "csv-parse/sync";
import { issueVisitor, visitorId } from "../src/security.js";
import { exportCsv } from "../src/storage.js";
import type { Row } from "../src/types.js";

test("La capacidad de visitante no se puede inventar, modificar ni reutilizar vencida", () => {
  const now = Date.now();
  const a = issueVisitor(now),
    b = issueVisitor(now);
  assert.notEqual(visitorId(a, now), visitorId(b, now));
  assert.match(visitorId(a, now)!, /^v_[a-f0-9]{64}$/);
  const pieces = a.split(".");
  pieces[1] = "f".repeat(64);
  assert.equal(visitorId(pieces.join("."), now), null);
  assert.equal(visitorId(a, now + 8 * 86400000), null);
  assert.equal(visitorId(a, now - 2000), null);
  assert.equal(visitorId("inventado"), null);
});

test("El CSV descargado neutraliza fórmulas y conserva el valor canónico", () => {
  for (const attack of [
    '=HYPERLINK("https://example.invalid")',
    "+SUM(1,1)",
    "-1+1",
    "@SUM(1)",
    "  =1",
    "\t=1",
    "\r=1",
  ]) {
    const row = { cliente: attack, valor: "200", nit_cliente: "00123" } as Row;
    const exported = parse(exportCsv([row]), { columns: true })[0];
    assert.equal(exported.cliente, "'" + attack);
    assert.equal(row.cliente, attack);
    assert.equal(exported.valor, "200");
    assert.equal(exported.nit_cliente, "00123");
  }
});

test("API: dos visitantes, confirmación ajena, reinicio aislado, cuotas y cabeceras", async () => {
  process.env.STORAGE_PROVIDER = "local";
  process.env.LLM_PROVIDER = "mock";
  const scratch = await fs.mkdtemp(
    path.join(process.cwd(), ".test-run-security-"),
  );
  process.env.RETO_SCRATCH_DIR = scratch;
  const { default: app } = await import("../src/server.js");
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const post = (url: string, body: unknown, cookie?: string) =>
    fetch(base + url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    });
  try {
    for (const url of [
      "/api/master",
      "/api/report",
      "/api/state",
      "/api/sessions/00000000-0000-4000-8000-000000000001",
    ]) {
      assert.equal((await fetch(base + url)).status, 401);
    }
    assert.equal((await post("/api/chat", { message: "Procesa" })).status, 401);
    assert.equal(
      (await post("/api/demo/reset", { confirm: "reiniciar-datos-ficticios" }))
        .status,
      401,
    );
    assert.deepEqual(await (await fetch(base + "/api/health")).json(), {
      ok: true,
    });
    const bootA = await post("/api/visitor", {}),
      bootB = await post("/api/visitor", {});
    const cookieA = bootA.headers.get("set-cookie")!.split(";")[0];
    const cookieB = bootB.headers.get("set-cookie")!.split(";")[0];
    assert.match(bootA.headers.get("set-cookie")!, /HttpOnly; SameSite=Lax/);
    assert.notEqual(cookieA, cookieB);
    const runA = await post(
      "/api/chat",
      { message: "Procesa el buzón" },
      cookieA,
    );
    assert.equal(runA.status, 200);
    const a = await runA.json();
    assert.equal(a.pending.length, 1);
    assert.equal(
      (
        await fetch(base + "/api/sessions/" + a.sessionId, {
          headers: { Cookie: cookieB },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await post(
          "/api/chat",
          {
            sessionId: a.sessionId,
            message: "Confirmo",
            confirmation: { token: a.pending[0].token, values: { valor: 0 } },
          },
          cookieB,
        )
      ).status,
      404,
    );
    const state = async (cookie: string) =>
      (
        await fetch(base + "/api/state", { headers: { Cookie: cookie } })
      ).json();
    assert.equal((await state(cookieA)).processed, 5);
    assert.equal((await state(cookieB)).processed, 0);
    await post(
      "/api/demo/reset",
      { confirm: "reiniciar-datos-ficticios" },
      cookieB,
    );
    assert.equal((await state(cookieA)).processed, 5);
    assert.equal(
      (await fetch(base + "/api/report", { headers: { Cookie: cookieB } }))
        .status,
      404,
    );
    assert.equal(
      (await fetch(base + "/api/report", { headers: { Cookie: cookieA } }))
        .status,
      200,
    );
    assert.equal(
      (await fetch(base + "/api/master", { headers: { Cookie: cookieA } }))
        .status,
      200,
    );
    const forbidden = await fetch(base + "/api/demo/reset", {
      method: "POST",
      headers: {
        Origin: "https://attacker.invalid",
        "Content-Type": "application/json",
        Cookie: cookieA,
      },
      body: "{}",
    });
    assert.equal(forbidden.status, 403);
    const badJson = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    assert.equal(badJson.status, 400);
    assert.equal(badJson.headers.get("x-frame-options"), "DENY");
    assert.match(
      badJson.headers.get("content-security-policy")!,
      /frame-ancestors 'none'/,
    );
    for (const url of ["/does-not-exist", "/.env", "/package.json"])
      assert.equal((await fetch(base + url)).status, 404);
    const home = await fetch(base + "/");
    assert.equal(home.status, 200);
    assert.equal(home.headers.get("x-frame-options"), "DENY");
    for (let i = 0; i < 5; i++)
      assert.equal(
        (await post("/api/chat", { message: "Procesa" }, cookieA)).status,
        200,
      );
    assert.equal(
      (await post("/api/chat", { message: "Procesa" }, cookieA)).status,
      429,
    );
    assert.equal((await state(cookieA)).processed, 5);
  } finally {
    server.close();
    await once(server, "close");
    // Únicamente el directorio temporal creado por esta prueba dentro del repositorio.
    assert.equal(path.dirname(scratch), process.cwd());
    await fs.rm(scratch, { recursive: true, force: true });
  }
});
