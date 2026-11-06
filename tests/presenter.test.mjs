import test from "node:test";
import assert from "node:assert/strict";
import { summarize, toolLabels } from "../web/presenter.js";
const call = (name, id, data) => ({
  name,
  arguments: { mensaje_id: id },
  result: { ok: true, data },
});
test("El resultado distingue registros, duplicados y revisión, sin contar cada paso técnico", () => {
  const calls = [
    call("contratos_leer_buzon", undefined, {
      mensajes: [
        { id: "msg-001", asunto: "Nuevo" },
        { id: "msg-004", asunto: "Reenvío" },
        { id: "msg-006", asunto: "Marco" },
      ],
    }),
    call("contratos_extraer", "msg-001", { cliente: "Cliente A" }),
    call("contratos_validar", "msg-001", {
      clasificacion: "nuevo",
      requiere_revision: [],
    }),
    call("contratos_registrar", "msg-001", { accion: "nuevo" }),
    call("contratos_validar", "msg-004", {
      clasificacion: "duplicado",
      requiere_revision: [],
    }),
    call("contratos_registrar", "msg-004", { accion: "duplicado" }),
    call("contratos_validar", "msg-006", {
      clasificacion: "nuevo",
      requiere_revision: ["valor", "fecha_fin"],
    }),
  ];
  const before = summarize(calls);
  assert.equal(before.items.length, 3);
  assert.equal(before.registered, 1);
  assert.equal(before.pending, 1);
  assert.equal(before.unchanged, 1);
  assert.equal(before.items[1].status, "Ya estaba registrado");
  const after = summarize([
    ...calls,
    call("contratos_registrar", "msg-006", { accion: "nuevo" }),
  ]);
  assert.equal(after.pending, 0);
  assert.equal(after.registered, 2);
  assert.equal(after.items.length, 3);
  assert.ok(toolLabels.contratos_extraer);
  assert.ok(toolLabels.contratos_registrar);
});
