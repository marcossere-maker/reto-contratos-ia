import { toolLabels, statusLabels, summarize } from "./presenter.js";
let sessionId = sessionStorage.getItem("contratos-session") || undefined;
const allCalls = [];
const messages = document.querySelector("#messages"),
  pending = document.querySelector("#pending"),
  input = document.querySelector("#message"),
  form = document.querySelector("#chat-form");
const el = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};
function bubble(role, text) {
  const b = el("div", null, "bubble " + role);
  b.append(
    el("span", role === "user" ? "VOS" : "ASISTENTE", "bubble-label"),
    document.createTextNode(text),
  );
  messages.append(b);
  messages.scrollTop = messages.scrollHeight;
}
function readableReply(reply, calls) {
  const report = summarize(calls);
  return reply.startsWith("Modo de práctica:") && report.items.length
    ? `Revisé ${report.items.length} correos. Hay ${report.registered} registros creados o actualizados, ${report.unchanged} casos sin cambios en el maestro y ${report.pending} pendientes de tu revisión. Encontrás el detalle y tu próximo paso arriba.`
    : reply;
}
function traces(calls) {
  if (!calls?.length) return;
  const group = el("details", null, "activity");
  group.append(
    el("summary", `Ver actividad del asistente · ${calls.length} pasos`),
    el(
      "p",
      "Estos pasos muestran cómo se obtuvo el resultado. Una operación completada puede terminar en registro, duplicado, descarte o revisión.",
      "activity-note",
    ),
  );
  for (const t of calls || []) {
    const d = el("details", null, "trace");
    d.append(
      el(
        "summary",
        (t.result.ok ? "Completado · " : "No se completó · ") +
          (toolLabels[t.name] || t.name) +
          (t.arguments?.mensaje_id ? " · " + t.arguments.mensaje_id : ""),
      ),
      el("p", "Herramienta: " + t.name),
      el(
        "pre",
        JSON.stringify(
          { argumentos: t.arguments, resultado: t.result },
          null,
          2,
        ),
      ),
    );
    group.append(d);
  }
  messages.append(group);
}
function renderResults() {
  const report = summarize(allCalls),
    root = document.querySelector("#results");
  if (!report.items.length) return;
  root.hidden = false;
  root.replaceChildren();
  root.append(
    el("span", "RESULTADO DEL BUZÓN", "eyebrow"),
    el(
      "h2",
      report.pending
        ? "Hay " + report.pending + " contrato que necesita tu decisión"
        : "El buzón ya fue revisado",
    ),
  );
  const cards = el("div", null, "result-cards");
  for (const [count, label] of [
    [report.registered, "Creados o actualizados"],
    [report.pending, "Pendientes de tu revisión"],
    [report.unchanged, "Sin cambios en el maestro"],
  ]) {
    const card = el("div", null, "result-card");
    card.append(el("strong", String(count)), el("span", label));
    cards.append(card);
  }
  root.append(cards);
  const wrap = el("div", null, "table-scroll"),
    table = el("table"),
    head = el("thead"),
    tr = el("tr");
  for (const title of ["Correo / cliente", "Resultado", "Qué significa"])
    tr.append(el("th", title));
  head.append(tr);
  table.append(head);
  const body = el("tbody");
  for (const c of report.items) {
    const row = el("tr"),
      name = el("td");
    name.append(
      el("strong", c.client || c.subject),
      el("small", c.id + (c.contractId ? " · " + c.contractId : "")),
    );
    const status = el("td");
    status.append(el("span", c.status, "case-status " + (c.tone || "neutral")));
    const note = el("td");
    note.textContent = c.review?.length
      ? "Faltan confirmar el valor y las fechas. No se registró."
      : c.action === "nuevo"
        ? "Se agregó al maestro."
        : c.action === "actualizacion"
          ? "Se modificó el contrato existente y se guardó el historial."
          : c.action === "duplicado"
            ? "El contrato ya existía; no se creó otro."
            : c.action === "rechazado"
              ? "El adjunto es una cotización, no un contrato."
              : c.action === "ya_procesado"
                ? "Este correo ya se había resuelto."
                : "Revisando los datos.";
    if (c.review?.length) {
      const button = el("button", "Revisar ahora", "review-jump");
      button.addEventListener("click", () => {
        pending.scrollIntoView({ behavior: "smooth", block: "start" });
        pending.querySelector("input")?.focus({ preventScroll: true });
      });
      note.append(el("br"), button);
    }
    row.append(name, status, note);
    body.append(row);
  }
  table.append(body);
  wrap.append(table);
  root.append(wrap);
  if (report.alerts)
    root.append(
      el(
        "p",
        `${report.alerts.due} contratos vencen en los próximos 60 días · ${report.alerts.policies} pólizas necesitan atención. Podés descargar el reporte de alertas.`,
        "alert-line",
      ),
    );
}
function review(items) {
  pending.replaceChildren();
  for (const p of items || []) {
    const f = el("form", null, "review");
    f.append(
      el("span", "TU PRÓXIMO PASO", "eyebrow"),
      el("h3", "Revisá el contrato de " + (p.contrato.cliente || p.mensajeId)),
      el(
        "p",
        "Este contrato no tiene un monto fijo y no indica el día exacto de firma. Por eso quedó sin registrar. Confirmá estos datos con una fuente válida para continuar.",
      ),
    );
    const controls = {};
    for (const [key, label, type] of [
      ["valor", "Valor contractual (0 si es por demanda)", "number"],
      ["fecha_inicio", "Fecha de inicio confirmada", "date"],
      ["fecha_fin", "Fecha de fin confirmada", "date"],
    ]) {
      const l = el("label", label),
        i = el("input");
      i.type = type;
      i.required = true;
      i.value = p.contrato[key] ?? "";
      if (type === "number") {
        i.min = "0";
        i.step = "0.01";
      }
      l.append(i);
      f.append(l);
      controls[key] = i;
    }
    const d = el("details");
    d.append(
      el("summary", "Ver evidencia y confianza por campo"),
      el("pre", JSON.stringify(p.contrato, null, 2)),
    );
    f.append(d);
    f.append(
      el(
        "p",
        "Para ensayar con los datos ficticios, podés asumir inicio 31/08/2026 y fin 31/08/2027. Son valores de prueba que vos confirmás; no fueron extraídos del contrato.",
        "demo-assumption",
      ),
    );
    const b = el("button", "Confirmar datos y registrar este contrato");
    b.type = "submit";
    f.append(b);
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      send("Confirmo expresamente los valores revisados de " + p.mensajeId, {
        token: p.token,
        values: {
          valor: Number(controls.valor.value),
          fecha_inicio: controls.fecha_inicio.value,
          fecha_fin: controls.fecha_fin.value,
        },
      });
    });
    pending.append(f);
  }
}
async function send(message, confirmation) {
  let completed = false;
  document.querySelectorAll("button").forEach((b) => (b.disabled = true));
  bubble("user", message);
  const thinking = el("p", "Procesando el buzón…", "footnote");
  messages.append(thinking);
  try {
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message, confirmation }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Error al enviar el mensaje.");
    sessionId = data.sessionId;
    sessionStorage.setItem("contratos-session", sessionId);
    allCalls.push(...(data.toolCalls || []));
    const reply = readableReply(data.reply, data.toolCalls);
    bubble("assistant", reply);
    traces(data.toolCalls);
    renderResults();
    review(data.pending);
    input.value = "";
    completed = true;
  } catch (e) {
    bubble("assistant", e.message);
  } finally {
    thinking.remove();
    document.querySelectorAll("button").forEach((b) => (b.disabled = false));
    messages.scrollTop = messages.scrollHeight;
    if (completed && !document.querySelector("#results").hidden)
      document
        .querySelector("#results")
        .scrollIntoView({ behavior: "smooth", block: "start" });
  }
}
form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (input.value.trim()) send(input.value.trim());
});
document
  .querySelector("#process")
  .addEventListener("click", () =>
    send(
      "Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo limpio, muestra lo que requiere revisión campo por campo y termina con el reporte de alertas. No registres nada dudoso sin preguntarme.",
    ),
  );
document.querySelector("#new-session").addEventListener("click", () => {
  sessionStorage.removeItem("contratos-session");
  location.reload();
});
document.querySelector("#reset-demo").addEventListener("click", async () => {
  if (
    !confirm(
      "¿Reiniciar los datos ficticios? Se borrarán los registros y conversaciones de esta demo compartida.",
    )
  )
    return;
  try {
    const response = await fetch("/api/demo/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "reiniciar-datos-ficticios" }),
    });
    if (!response.ok) throw new Error("No se pudo reiniciar la demo.");
    sessionStorage.removeItem("contratos-session");
    location.reload();
  } catch (e) {
    bubble("assistant", e.message);
  }
});
async function boot() {
  try {
    const h = await (await fetch("/api/health")).json();
    if (h.storage === "supabase")
      document.querySelector(".footnote").textContent =
        "Datos ficticios guardados en Supabase. Se conservan entre reinicios y publicaciones.";
    document.querySelector("#mode-notice").textContent =
      h.provider === "mock"
        ? "Demostración: seis correos ficticios y un flujo programado. No hay conexión a un correo real ni a un modelo de IA."
        : "Demostración con seis correos ficticios. El asistente usa " +
          h.model +
          "; no está conectado a un correo real.";
    document.querySelector("#provider").textContent =
      h.provider === "mock"
        ? "Práctica guiada · sin IA"
        : h.model + (h.configured ? " · configurado" : " · falta configurar");
    if (sessionId) {
      const r = await fetch("/api/sessions/" + sessionId);
      if (r.ok) {
        const s = await r.json();
        messages.replaceChildren();
        for (const m of s.history) {
          bubble(
            m.role,
            m.role === "assistant"
              ? readableReply(m.content, m.toolCalls)
              : m.content,
          );
          if (m.toolCalls) {
            traces(m.toolCalls);
            allCalls.push(...m.toolCalls);
          }
        }
        review(s.pending);
        renderResults();
      } else {
        sessionId = undefined;
        sessionStorage.removeItem("contratos-session");
      }
    }
  } catch {
    document.querySelector("#provider").textContent = "Servidor no disponible";
  }
}
boot();
