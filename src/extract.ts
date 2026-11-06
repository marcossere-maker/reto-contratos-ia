import { promises as fs } from "node:fs";
import { fixture, json, rows, safeId, validDate } from "./storage.js";
import type { Contrato, Correo, Ctx, Field } from "./types.js";

const months = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
export function dates(text: string): string[] {
  return [...text.matchAll(/\((\d{1,2})\)\s+de\s+(\w+)\s+de\s+(\d{4})/gi)]
    .map(
      (m) =>
        `${m[3]}-${String(months.indexOf(m[2].toLowerCase()) + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`,
    )
    .filter(validDate);
}
export async function document(ctx: Ctx, id: string) {
  safeId(id);
  const correo = await json<Correo>(fixture(ctx, "buzon", id, "correo.json"));
  const attachment = correo.adjuntos.find((a) =>
    /^(contrato|otrosi)\.txt$/.test(a),
  );
  return {
    correo,
    attachment,
    text: attachment
      ? await fs.readFile(fixture(ctx, "buzon", id, attachment), "utf8")
      : "",
  };
}
export async function extract(ctx: Ctx, id: string): Promise<Contrato> {
  const { correo, text, attachment } = await document(ctx, id);
  const c: Contrato = {
    id_contrato: null,
    cliente: null,
    nit_cliente: null,
    pais: null,
    objeto: null,
    valor: null,
    moneda: null,
    fecha_inicio: null,
    fecha_fin: null,
    requiere_poliza: null,
    tipo_poliza: null,
    estado_poliza: null,
    comercial: null,
    valor_indeterminado: false,
    confianza: {},
    fuente: {},
    es_otrosi: /OTROS[IÍ]/i.test(text),
    observaciones: [],
  };
  function set<K extends Field>(
    key: K,
    value: Contrato[K],
    source: string,
    confidence = 0.98,
  ) {
    c[key] = value;
    c.confianza[key] = value === null ? 0 : confidence;
    c.fuente[key] = source;
  }
  for (const key of Object.keys(c).filter(
    (k) => !["confianza", "fuente", "es_otrosi", "observaciones"].includes(k),
  )) {
    c.confianza[key] = 0;
    c.fuente[key] = "No consta";
  }
  if (!text.trim()) {
    c.observaciones.push("Sin adjunto de contrato reconocible.");
    return c;
  }
  set(
    "id_contrato",
    text.match(/(?:CT|CM)-\d{4}-\d+/)?.[0] ?? null,
    attachment!,
  );
  const party = text.match(
    /Entre\s+(?:los suscritos,\s*)?(.+?),\s*(?:identificad[ao]\s+con\s+)?(NIT|RUC|RTN)\s+([\d.]+(?:-\d)?)/i,
  );
  if (party) {
    set("cliente", party[1].trim(), party[0]);
    set("nit_cliente", party[3].split("-")[0].replace(/\./g, ""), party[0]);
    const country =
      party[2] === "NIT"
        ? "CO"
        : c.nit_cliente?.length === 13
          ? "EC"
          : c.nit_cliente?.length === 11
            ? "PE"
            : party[2] === "RTN"
              ? "HN"
              : "PA";
    set("pais", country, party[0], 0.9);
  }
  const object = text
    .match(/PRIMERA\.\s*OBJETO\.\s*([\s\S]+?)(?=\n\s*SEGUNDA\.)/i)?.[1]
    ?.trim();
  set(
    "objeto",
    object?.replace(/\s+/g, " ").slice(0, 200) ?? null,
    object ?? "No consta",
  );
  const amount = text.match(/\b(COP|USD|PEN|PAB|HNL)\s*\$?([\d.,]+)/);
  if (amount) {
    const n = amount[2].includes(",")
      ? Number(amount[2].replace(/,/g, ""))
      : Number(amount[2].replace(/\./g, ""));
    set("valor", n, amount[0]);
    set("moneda", amount[1] as Contrato["moneda"], amount[0]);
  }
  if (/no tiene un valor determinado/i.test(text)) {
    set("valor", 0, "Cláusula VALOR: contrato por demanda", 0.5);
    set("valor_indeterminado", true, "Cláusula VALOR");
    set("moneda", "COP", "Tarifas y garantías expresadas en COP", 0.85);
  }
  const plazo =
    text.match(/TERCERA\.\s*PLAZO\.([\s\S]+?)(?=\n\s*CUARTA\.)/i)?.[1] ?? "";
  const dt = dates(plazo);
  set("fecha_inicio", dt[0] ?? null, plazo || "Fecha de firma sin día exacto");
  set(
    "fecha_fin",
    dt[1] ?? null,
    plazo || "Plazo en meses sin fecha de firma exacta",
  );
  const hasPolicy = /p[oó]liza|garant[ií]as de cumplimiento/i.test(text);
  set(
    "requiere_poliza",
    hasPolicy,
    "Cláusulas de garantías; ausencia explícita del requerimiento",
    hasPolicy ? 0.98 : 0.85,
  );
  set(
    "tipo_poliza",
    hasPolicy
      ? [
          "cumplimiento",
          ...(/responsabilidad civil/i.test(text)
            ? ["responsabilidad_civil"]
            : []),
        ].join(";")
      : "",
    "Cláusula de garantías",
  );
  set(
    "estado_poliza",
    hasPolicy ? "pendiente" : "no_aplica",
    "Regla: póliza nueva o ampliación pendiente",
  );
  if (/Para cada orden de servicio/i.test(text))
    c.observaciones.push(
      "Póliza condicional por orden de servicio; revisar al superar COP 100.000.000.",
    );
  const comerciales = await json<{ email: string; nombre: string }[]>(
    fixture(ctx, "comerciales.json"),
  );
  const comercial = comerciales.find((x) => x.email === correo.de);
  set("comercial", comercial?.nombre ?? null, `correo.de: ${correo.de}`);
  if (!comercial)
    c.observaciones.push("Remitente no registrado: no bloquea por sí solo.");
  if (c.es_otrosi) {
    const original = (await rows(ctx)).find(
      (r) => r.id_contrato === c.id_contrato,
    );
    if (original) {
      for (const key of ["objeto", "fecha_inicio", "moneda"] as const)
        set(key, original[key] as never, `maestro.${c.id_contrato}.${key}`);
      const change = dates(
        text.match(/PRIMERA\.([\s\S]+?)(?=\n\s*SEGUNDA\.)/)?.[1] ?? "",
      );
      set("fecha_fin", change[0] ?? null, "Otrosí: modificación del plazo");
      c.observaciones.push(
        "Otrosí: se heredan campos no modificados del maestro; ampliación de garantías pendiente.",
      );
    }
  }
  return c;
}
