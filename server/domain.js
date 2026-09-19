import { createHash } from "node:crypto";

export const EFFORT = Object.freeze({
  low: { label: "Basso", depth: 2, nodes: 6, tokens: 5000 },
  medium: { label: "Medio", depth: 3, nodes: 10, tokens: 8000 },
  high: { label: "Alto", depth: 4, nodes: 16, tokens: 12000 },
  max: { label: "Massimo", depth: 5, nodes: 24, tokens: 18000 },
});
export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export function requireThat(condition, message, status = 400) {
  if (!condition) throw new AppError(message, status);
}
export function text(value, name, max = 8000) {
  requireThat(
    typeof value === "string" && value.trim().length > 0 && value.length <= max,
    `${name}: testo obbligatorio (max ${max} caratteri).`,
  );
  return value.trim();
}
export function date(value, name) {
  requireThat(
    typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value,
    `${name}: data non valida.`,
  );
  return value;
}
export function inputSpec(raw) {
  requireThat(raw && typeof raw === "object", "Richiesta non valida.");
  const thesis = text(raw.thesis, "Tesi", 6000);
  requireThat(
    thesis.length >= 15,
    "La tesi deve contenere almeno 15 caratteri.",
  );
  requireThat(Object.hasOwn(EFFORT, raw.effort), "Effort non valido.");
  requireThat(
    ["general", "trading"].includes(raw.domain),
    "Ambito non valido.",
  );
  return {
    thesis,
    effort: raw.effort,
    domain: raw.domain,
    deadline: date(raw.deadline, "Scadenza"),
    context: typeof raw.context === "string" ? raw.context.slice(0, 12000) : "",
  };
}
const str = { type: "string" };
const strings = { type: "array", items: str };
const object = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
export const GRAPH_SCHEMA = object({
  title: str,
  summary: str,
  nodes: {
    type: "array",
    items: object({
      id: str,
      label: str,
      kind: { type: "string", enum: ["thesis", "consequence", "alternative"] },
      assumptions: strings,
      challenge: str,
      falsifier: str,
      evidenceNeeded: strings,
    }),
  },
  edges: {
    type: "array",
    items: object({ from: str, to: str, mechanism: str }),
  },
  uncertainties: strings,
  trading: object({
    instruments: strings,
    catalysts: strings,
    pricedIn: str,
    invalidation: str,
    timingRisks: strings,
    marketVsThesis: str,
  }),
});
export function validateGraph(g, effort) {
  requireThat(
    g && typeof g === "object",
    "Il modello non ha restituito una mappa.",
    422,
  );
  text(g.title, "Titolo", 500);
  text(g.summary, "Sintesi", 4000);
  requireThat(
    Array.isArray(g.nodes) &&
      g.nodes.length >= 3 &&
      g.nodes.length <= EFFORT[effort].nodes,
    "Numero di nodi fuori dal budget selezionato.",
    422,
  );
  requireThat(
    Array.isArray(g.edges) && g.edges.length <= EFFORT[effort].nodes * 3,
    "Archi non validi.",
    422,
  );
  const ids = new Set(),
    levels = new Map();
  const checkStrings = (v, name) => {
    requireThat(
      Array.isArray(v) && v.length <= 20,
      `${name}: elenco non valido.`,
      422,
    );
    v.forEach((s) => text(s, name, 2000));
  };
  for (const n of g.nodes) {
    requireThat(
      n && typeof n === "object" && !Array.isArray(n),
      "Nodo non valido.",
      422,
    );
    requireThat(
      typeof n.id === "string" &&
        /^[a-zA-Z0-9_-]{1,50}$/.test(n.id) &&
        !ids.has(n.id),
      "ID nodo non valido o duplicato.",
      422,
    );
    ids.add(n.id);
    text(n.label, "Nodo", 500);
    requireThat(
      ["thesis", "consequence", "alternative"].includes(n.kind),
      "Tipo nodo non valido.",
      422,
    );
    checkStrings(n.assumptions, "Assunzioni");
    checkStrings(n.evidenceNeeded, "Evidenze richieste");
    text(n.challenge, "Domanda critica", 2000);
    text(n.falsifier, "Invalidazione", 2000);
  }
  const roots = g.nodes.filter((n) => n.kind === "thesis");
  requireThat(
    roots.length === 1 && g.nodes.some((n) => n.kind === "alternative"),
    "Servono una tesi e almeno uno scenario alternativo.",
    422,
  );
  const root = roots[0].id,
    seenEdges = new Set();
  for (const e of g.edges) {
    requireThat(
      e && typeof e === "object" && !Array.isArray(e),
      "Arco non valido.",
      422,
    );
    requireThat(
      ids.has(e.from) && ids.has(e.to) && e.from !== e.to && e.to !== root,
      "Arco con riferimento non valido.",
      422,
    );
    const key = `${e.from}:${e.to}`;
    requireThat(!seenEdges.has(key), "Arco duplicato.", 422);
    seenEdges.add(key);
    text(e.mechanism, "Meccanismo", 2000);
  }
  const visiting = new Set();
  function visit(id) {
    requireThat(
      !visiting.has(id),
      "La mappa contiene un ciclo: rappresentare i feedback come nodi futuri distinti.",
      422,
    );
    if (levels.has(id)) return levels.get(id);
    visiting.add(id);
    const parents = g.edges.filter((e) => e.to === id);
    requireThat(
      id === root || parents.length > 0,
      "Nodo scollegato dalla tesi.",
      422,
    );
    const depth =
      id === root ? 0 : 1 + Math.max(...parents.map((e) => visit(e.from)));
    visiting.delete(id);
    levels.set(id, depth);
    return depth;
  }
  g.nodes.forEach((n) => visit(n.id));
  requireThat(
    Math.max(...levels.values()) <= EFFORT[effort].depth,
    "La mappa supera la profondità richiesta.",
    422,
  );
  checkStrings(g.uncertainties, "Incertezze");
  requireThat(
    g.trading && typeof g.trading === "object",
    "Contesto trading mancante.",
    422,
  );
  for (const k of ["instruments", "catalysts", "timingRisks"])
    checkStrings(g.trading[k], k);
  for (const k of ["pricedIn", "invalidation", "marketVsThesis"])
    requireThat(
      typeof g.trading[k] === "string" && g.trading[k].length <= 4000,
      `Campo ${k} non valido.`,
      422,
    );
  return {
    title: g.title,
    summary: g.summary,
    nodes: g.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      kind: n.kind,
      assumptions: n.assumptions,
      challenge: n.challenge,
      falsifier: n.falsifier,
      evidenceNeeded: n.evidenceNeeded,
      depth: levels.get(n.id),
      evidenceStatus: "unverified",
    })),
    edges: g.edges.map((e) => ({
      from: e.from,
      to: e.to,
      mechanism: e.mechanism,
    })),
    uncertainties: g.uncertainties,
    trading: g.trading,
  };
}
export function validateCriteria(rows, now = new Date()) {
  requireThat(
    Array.isArray(rows) && rows.length > 0 && rows.length <= 20,
    "Definisci da 1 a 20 criteri.",
  );
  const ids = new Set();
  const result = rows.map((c) => {
    requireThat(
      c && typeof c === "object" && !Array.isArray(c),
      "Criterio non valido.",
    );
    const id = text(c.id, "ID criterio", 60);
    requireThat(!ids.has(id), "ID criterio duplicato.");
    ids.add(id);
    requireThat(
      Number.isFinite(c.weight) && c.weight > 0 && c.weight <= 100,
      "Peso non valido.",
    );
    requireThat(["gte", "lte"].includes(c.operator), "Operatore non valido.");
    requireThat(Number.isFinite(c.threshold), "Soglia numerica obbligatoria.");
    const due = date(c.due, "Scadenza criterio");
    requireThat(
      due > now.toISOString().slice(0, 10),
      "La scadenza deve essere successiva a oggi: vietata la preregistrazione retroattiva.",
    );
    return {
      id,
      name: text(c.name, "Nome", 300),
      metric: text(c.metric, "Definizione della misura", 2000),
      source: text(c.source, "Fonte prevista", 2000),
      unit: text(c.unit, "Unità", 100),
      weight: c.weight,
      operator: c.operator,
      threshold: c.threshold,
      due,
    };
  });
  requireThat(
    Math.abs(result.reduce((s, c) => s + c.weight, 0) - 100) < 0.00001,
    "La somma dei pesi deve essere 100.",
  );
  return result;
}
export function evaluate(snapshot, observations, now = new Date()) {
  requireThat(
    Array.isArray(observations) &&
      observations.length <= snapshot.criteria.length,
    "Osservazioni non valide.",
  );
  const ids = new Set();
  const clean = observations.map((o) => {
    requireThat(
      o && typeof o === "object" && !Array.isArray(o),
      "Osservazione non valida.",
    );
    requireThat(
      snapshot.criteria.some((c) => c.id === o.criterionId) &&
        !ids.has(o.criterionId),
      "Criterio sconosciuto o duplicato.",
    );
    ids.add(o.criterionId);
    requireThat(
      o.value === null || Number.isFinite(o.value),
      "Valore numerico o null richiesto.",
    );
    const observedAt = date(o.observedAt, "Data osservazione");
    requireThat(
      observedAt <= now.toISOString().slice(0, 10),
      "Non puoi registrare osservazioni future.",
    );
    return {
      criterionId: o.criterionId,
      value: o.value,
      observedAt,
      source: text(o.source, "Fonte osservata", 2000),
      note: typeof o.note === "string" ? o.note.slice(0, 4000) : "",
    };
  });
  const results = snapshot.criteria.map((c) => {
    const o = clean.find((o) => o.criterionId === c.id);
    const available =
      o && o.value !== null && o.observedAt === c.due && o.source === c.source;
    if (!available)
      return {
        id: c.id,
        status: "not_evaluated",
        points: null,
        weight: c.weight,
        reason:
          "Serve una misura alla data fissata, dalla fonte preregistrata. Nessuna inferenza sui dati mancanti.",
      };
    const met =
      c.operator === "gte" ? o.value >= c.threshold : o.value <= c.threshold;
    return {
      id: c.id,
      status: met ? "supported" : "not_supported",
      points: met ? c.weight : 0,
      weight: c.weight,
      reason: `${o.value} ${c.unit}; soglia ${c.operator === "gte" ? "≥" : "≤"} ${c.threshold} ${c.unit}.`,
    };
  });
  const coverage = results
    .filter((r) => r.points !== null)
    .reduce((s, r) => s + r.weight, 0);
  return {
    observations: clean,
    results,
    coverage,
    score:
      Math.abs(coverage - 100) < 0.00001
        ? results.reduce((s, r) => s + r.points, 0)
        : null,
    evidenceOrigin: "user_supplied_unverified",
    ruleVersion: "numeric-threshold-v1",
  };
}
export const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
