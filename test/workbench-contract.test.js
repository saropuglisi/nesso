// Offline regression coverage prepared alongside the feature; not run in this iteration.
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../server/index.js";
import { openStore } from "../server/store.js";
import { config } from "../server/provider.js";
import { graph, input } from "./fixtures.js";

test("workbench persists only server-derived charts with original missing observations", async (t) => {
  const store = openStore(":memory:");
  const evidence = {
    status: "collected", warnings: [], attempts: [], sources: [{
      id: "R1", provider: "fred", kind: "data", title: "Serie di prova", url: "https://fred.stlouisfed.org/series/TEST",
      retrievedAt: "2026-09-21T10:00:00.000Z", data: {
        id: "TEST", units: "Percent", frequency: "Monthly", seasonalAdjustment: "Not Seasonally Adjusted",
        observations: [
          { date: "2026-03-01", value: 3.5 },
          { date: "2026-02-01", value: null },
          { date: "2026-01-01", value: 3 },
        ],
      },
    }],
  };
  const reasoning = {
    question: "Quale osservazione distingue le ipotesi?",
    provisionalConclusion: "La tesi richiede una verifica sul gruppo interessato.",
    supporting: [{ claim: "Il tempo libero potrebbe favorire la permanenza.", sourceIds: [] }],
    opposing: [{ claim: "Un maggiore carico potrebbe annullare il beneficio.", sourceIds: [] }],
    assumptions: [{ claim: "I gruppi sono comparabili.", howToTest: "Confrontare mansioni e carichi iniziali." }],
    scenarios: [
      { name: "Effetto organizzativo", mechanism: "Maggiore sostenibilità del lavoro.", observableDifference: "Minori dimissioni senza maggior carico." },
      { name: "Selezione", mechanism: "Aderiscono dipendenti già propensi a restare.", observableDifference: "Nessun divario su gruppi inizialmente simili." },
    ],
    nextChecks: [{ question: "Chi ha aderito?", whyItMatters: "Verifica l'effetto di selezione.", sourceHint: "Dati interni da raccogliere." }],
    limitations: ["Nessun dato sul gruppo di confronto è disponibile."],
  };
  const app = createApp({
    store, provider: config({ NESSO_MODEL: "fixture" }),
    researcher: async () => evidence,
    inference: async (_provider, received) => {
      assert.equal(received.charts, undefined);
      assert.equal(received.reasoning, undefined);
      assert.equal(received.evidenceAudit, undefined);
      return { graph: graph(), reasoning, provenance: { deepening: { status: "complete" } } };
    },
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  t.after(() => { app.server.closeAllConnections(); app.server.close(); store.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const configuration = await (await fetch(base + "/api/config")).json();
  assert.deepEqual(configuration.features, { charts: true, reasoning: true, evidenceAudit: true });
  const asset = await fetch(base + "/charts.js");
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get("content-type"), /javascript/);
  const response = await fetch(base + "/api/analyze", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...input, research: true, charts: { forged: true }, reasoning: { forged: true }, evidenceAudit: { forged: true } }),
  });
  assert.equal(response.status, 201);
  const record = await response.json();
  assert.deepEqual(record.body.graph.reasoning, reasoning);
  assert.equal(record.body.charts.version, "nesso-charts-v1");
  assert.deepEqual(record.body.charts.items[0].points, [
    { label: "2026-01-01", value: 3 },
    { label: "2026-02-01", value: null },
    { label: "2026-03-01", value: 3.5 },
  ]);
  assert.deepEqual(record.body.charts.items[0].sourceIds, ["R1"]);
  assert.deepEqual(store.get(record.id).body.charts, record.body.charts);
  assert.deepEqual(store.get(record.id).body.graph.reasoning, reasoning);
  assert.equal(record.body.evidenceAudit.version, "nesso-evidence-audit-v1");
  assert.equal(record.body.evidenceAudit.counts.read, 1);
  assert.equal(record.body.evidenceAudit.counts.uncitedClaims, 2);
  assert.equal(record.body.evidenceAudit.counts.cited, 1);
  assert.equal(record.body.evidenceAudit.forged, undefined);
  assert.deepEqual(store.get(record.id).body.evidenceAudit, record.body.evidenceAudit);
});
