let sessionId = sessionStorage.getItem("contratos-session") || undefined;
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
function traces(calls) {
  for (const t of calls || []) {
    const d = el("details", null, "trace");
    d.append(
      el("summary", (t.result.ok ? "✓ " : "! ") + t.name),
      el(
        "pre",
        JSON.stringify(
          { argumentos: t.arguments, resultado: t.result },
          null,
          2,
        ),
      ),
    );
    messages.append(d);
  }
}
function review(items) {
  pending.replaceChildren();
  for (const p of items || []) {
    const f = el("form", null, "review");
    f.append(
      el("h3", "Revisión requerida · " + p.mensajeId),
      el(
        "p",
        "Confirmá el valor por demanda y las fechas exactas. La fecha del correo no acredita el día de firma.",
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
    const b = el("button", "Confirmar estos valores y registrar");
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
    traces(data.toolCalls);
    bubble("assistant", data.reply);
    review(data.pending);
    input.value = "";
  } catch (e) {
    bubble("assistant", e.message);
  } finally {
    thinking.remove();
    document.querySelectorAll("button").forEach((b) => (b.disabled = false));
    messages.scrollTop = messages.scrollHeight;
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
          if (m.toolCalls) traces(m.toolCalls);
          bubble(m.role, m.content);
        }
        review(s.pending);
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
