export const toolLabels = {
  contratos_leer_buzon: "Leer los correos pendientes",
  contratos_extraer: "Extraer datos del contrato",
  contratos_validar: "Verificar datos y detectar duplicados",
  contratos_registrar: "Resolver el registro y archivar el documento",
  contratos_alertas: "Preparar alertas de vencimientos y pólizas",
};
export const statusLabels = {
  nuevo: "Contrato nuevo",
  actualizacion: "Modificación de contrato",
  duplicado: "Ya estaba registrado",
  rechazado: "No es un contrato",
  ya_procesado: "Procesado anteriormente",
};
export function summarize(calls) {
  const cases = new Map();
  let alerts = null;
  for (const t of calls || []) {
    if (!t.result?.ok) continue;
    const data = t.result.data;
    if (t.name === "contratos_leer_buzon")
      for (const m of data.mensajes || [])
        cases.set(m.id, {
          id: m.id,
          subject: m.asunto,
          sender: m.de,
          status: "Por revisar",
        });
    const id = t.arguments?.mensaje_id;
    if (id) {
      const c = cases.get(id) || { id, subject: "Contrato " + id };
      if (t.name === "contratos_extraer") {
        c.client = data.cliente;
        c.contractId = data.id_contrato;
        c.value = data.valor;
        c.currency = data.moneda;
      }
      if (t.name === "contratos_validar") {
        c.kind = data.clasificacion;
        c.review = data.requiere_revision || [];
        c.status = c.review.length
          ? "Necesita tu revisión"
          : statusLabels[data.clasificacion];
        c.tone = c.review.length ? "warning" : "neutral";
      }
      if (t.name === "contratos_registrar") {
        c.action = data.accion;
        c.review = [];
        c.status =
          data.accion === "nuevo"
            ? "Registrado"
            : data.accion === "actualizacion"
              ? "Actualizado"
              : statusLabels[data.accion] || "Procesado";
        c.tone = ["nuevo", "actualizacion"].includes(data.accion)
          ? "success"
          : "neutral";
      }
      cases.set(id, c);
    }
    if (t.name === "contratos_alertas")
      alerts = {
        due: data.vencen?.length || 0,
        policies: data.polizas_pendientes?.length || 0,
      };
  }
  const items = [...cases.values()];
  return {
    items,
    alerts,
    registered: items.filter((c) =>
      ["nuevo", "actualizacion"].includes(c.action),
    ).length,
    pending: items.filter((c) => c.review?.length).length,
    unchanged: items.filter((c) =>
      ["duplicado", "rechazado", "ya_procesado"].includes(c.action),
    ).length,
  };
}
