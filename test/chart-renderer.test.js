import test from "node:test";
import assert from "node:assert/strict";
import { renderAnalysisView } from "../public/charts.js";

function record() {
  return { body: {
    input: { thesis: "La tesi da discutere", effort: "medium" },
    graph: { title: "Dossier", summary: "Un confronto provvisorio", uncertainties: [] },
    research: { sources: [{ id: "R1", provider: "fred", kind: "data", title: "Serie", url: "https://fred.stlouisfed.org/series/TEST", retrievedAt: "2026-09-21T10:00:00Z" }] },
    charts: { version: "nesso-charts-v1", items: [{
      id: "chart-r1-test", title: "Osservazioni", type: "line", unit: "Percent", frequency: "Monthly",
      sourceIds: ["R1"], notes: ["Serie osservata, non previsione."],
      points: [{ label: "2026-01-01", value: 1 }, { label: "2026-02-01", value: null }, { label: "2026-03-01", value: 3 }],
    }] },
  } };
}
const render = (value) => {
  const container = { innerHTML: "" };
  renderAnalysisView(container, value);
  return container.innerHTML;
};

test("chart lines break at missing observations and expose a data table", () => {
  const html = render(record());
  assert.equal((html.match(/<polyline /g) || []).length, 2);
  assert.match(html, /GAP/);
  assert.match(html, /<table/);
  assert.match(html, /2026-02-01/);
  assert.match(html, /role="img"/);
  assert.match(html, /aria-labelledby/);
});

test("renderer escapes external labels and refuses non-HTTPS source links", () => {
  const value = record();
  value.body.charts.items[0].title = '<img src=x onerror="alert(1)">';
  value.body.research.sources[0].url = "javascript:alert(1)";
  const html = render(value);
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes("&lt;img"));
});

test("planner limits are labeled as unverified, escaped, and bounded", () => {
  const value = record();
  value.body.research.plannerNotes = [
    '<img src=x onerror="alert(1)">',
    `PLANNER_LONG_${"z".repeat(1200)}`,
    ...Array.from({ length: 9 }, (_, index) => `planner-note-${index}`),
  ];
  const html = render(value);
  assert.match(html, /Limiti proposti dal modello · non verificati/);
  assert.match(html, /<details><summary>Limiti proposti dal modello · non verificati \(8\)<\/summary>/);
  assert.match(html, /Note prodotte durante la ricerca: possono essere superate dalle letture successive\./);
  assert.match(html, /Non sono dati o fonti/);
  assert.ok(!html.includes("note tecniche"));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes("&lt;img src=x"));
  assert.ok(html.includes("planner-note-5"));
  assert.ok(!html.includes("planner-note-6"));
  assert.ok(!html.includes("z".repeat(1001)));
});

test("small non-zero values remain visible as non-zero and old records stay readable", () => {
  const value = record();
  value.body.charts.items[0].points[0].value = 0.0000001;
  const html = render(value);
  assert.ok(html.includes("0,0000001") || /1(?:,0+)?e-0?7/.test(html));
  assert.ok(!html.includes("NaN"));
  const legacy = render({ body: { input: { thesis: "Una tesi archiviata senza dati" }, graph: { title: "Archivio", summary: "Sintesi già salvata" } } });
  assert.match(legacy, /Una tesi archiviata senza dati/);
  assert.match(legacy, /Sintesi già salvata/);
  assert.match(legacy, /Nessun grafico/);
});

test("dossier links claims to bounded source cards and reports evidence coverage", () => {
  const value = record();
  value.body.research.sources[0].publishedAt = "2026-09-01";
  value.body.research.sources[0].data = {
    units: "Percent",
    frequency: "Monthly",
    excerpts: [{ text: "Estratto originale <non verificato>" }, { text: "Secondo estratto" }],
  };
  value.body.graph.reasoning = {
    supporting: [{ claim: "La serie è compatibile con il passaggio.", sourceIds: ["R1"] }],
    opposing: [{ claim: "Manca una spiegazione concorrente.", sourceIds: ["R9"] }],
    assumptions: [{ claim: "Il campione è comparabile.", howToTest: "Confrontare gruppi e periodo." }],
    nextChecks: [{ question: "Quale misura osservare?", whyItMatters: "Distingue le ipotesi." }],
  };
  value.body.evidenceAudit = {
    version: "nesso-evidence-audit-v1",
    researchStatus: "partial",
    counts: { retrieved: 1, read: 1, discovery: 0, cited: 1, uncitedClaims: 1, unresolvedClaims: 1 },
    claims: [{ id: "supporting-0", side: "supporting", claim: "La serie è compatibile con il passaggio.", sourceIds: ["R1"], validSourceIds: ["R1"], citationState: "cited", issues: [] }, { id: "opposing-0", side: "opposing", claim: "Manca una spiegazione concorrente.", sourceIds: ["R9"], validSourceIds: [], citationState: "unresolved", issues: ["Fonte non presente"] }],
    sources: [{ id: "R1", citationCount: 1, kind: "data", available: true }],
    warnings: ["Copertura parziale."],
  };
  const html = render(value);
  assert.match(html, /href="#source-card-r1"/);
  assert.match(html, /id="source-card-r1"/);
  assert.match(html, /Estratti originali della fonte/);
  assert.match(html, /2026-09-01/);
  assert.match(html, /Fonti lette/);
  assert.match(html, /Riferimenti da risolvere/);
  assert.match(html, /data-investigate-kind="assumption"/);
  assert.match(html, /data-investigate-kind="nextCheck"/);
  assert.ok(!html.includes("href=\"#source-card-r9\""));
});

test("legacy dossier explicitly reports unavailable evidence audit", () => {
  const html = render({ body: { input: { thesis: "Una tesi archiviata senza dati" }, graph: { title: "Archivio", summary: "Sintesi già salvata" } } });
  assert.match(html, /Report di copertura non disponibile/);
});

test("investigation callbacks are opt-in, preserve the record and replace old listeners", () => {
  const value = record();
  value.body.input.context = "Contesto da conservare";
  value.body.graph.reasoning = {
    nextChecks: [{ question: "Quale misura distingue le ipotesi?" }],
  };
  const listeners = new Map();
  const container = {
    innerHTML: "",
    contains: () => true,
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
  };
  const selected = [];
  const before = JSON.stringify(value);
  renderAnalysisView(container, value, { onInvestigate: (detail) => selected.push(detail) });
  assert.equal(selected.length, 0);
  const button = { dataset: { investigateKind: "nextCheck", investigateIndex: "0" } };
  listeners.get("click")({ target: { closest: () => button } });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].record, value);
  assert.equal(selected[0].thesis, value.body.input.thesis);
  assert.equal(selected[0].context, value.body.input.context);
  assert.equal(selected[0].question, "Quale misura distingue le ipotesi?");
  assert.equal(JSON.stringify(value), before);
  renderAnalysisView(container, value);
  assert.equal(listeners.has("click"), false);
});

test("source excerpts keep fiscal periods, units, filing dates and original date precision", () => {
  const value = record();
  value.body.research.sources[0] = {
    id: "R1", provider: "sec", kind: "data", title: "Metriche XBRL",
    url: "https://data.sec.gov/api/xbrl/example.json", retrievedAt: "2026-09-21T10:00:00Z",
    data: {
      reportDate: "2025", filed: "2026-01-05",
      caveat: "Non sommare periodi sovrapposti.",
      units: { USD: [{ start: "2025-01-01", end: "2025-12-31", filed: "2026-01-05", val: 100 }] },
    },
  };
  const html = render(value);
  assert.match(html, /depositata 2026-01-05/);
  assert.match(html, /periodo del report 2025/);
  assert.match(html, /2025-01-01 → 2025-12-31/);
  assert.match(html, /100 USD/);
  assert.match(html, /Non sommare periodi sovrapposti/);
  assert.ok(!html.includes("[object Object]"));
});

test("ambiguous source identifiers are not silently linked to one of the sources", () => {
  const value = record();
  value.body.research.sources.push({ ...value.body.research.sources[0], title: "Fonte in conflitto" });
  value.body.graph.reasoning = { supporting: [{ claim: "Da verificare", sourceIds: ["R1"] }] };
  const html = render(value);
  assert.ok(!html.includes('href="#source-card-r1"'));
  assert.match(html, /fonte non presente o ambigua/);
});
