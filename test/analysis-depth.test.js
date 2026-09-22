import test from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../server/analysis.js";
import { config } from "../server/provider.js";
import { graph, input } from "./fixtures.js";

const plan = {
  scenario: { kind: "generic", currency: "", values: [] },
  conclusion: "Verificare il nesso", limitation: "Mancano osservazioni", calculations: [],
};
const brief = {
  question: "La settimana breve cambia davvero le dimissioni?",
  provisionalConclusion: "La tesi resta condizionata al carico di lavoro e alla composizione del gruppo.",
  supporting: [{ claim: "Più tempo libero potrebbe rendere il lavoro più sostenibile.", sourceIds: [] }],
  opposing: [{ claim: "La concentrazione delle attività potrebbe aumentare lo stress.", sourceIds: [] }],
  assumptions: [{ claim: "Le mansioni restano comparabili.", howToTest: "Confrontare attività e carichi nei gruppi osservati." }],
  scenarios: [
    { name: "Maggiore sostenibilità", mechanism: "Il riposo aggiuntivo favorisce la permanenza.", observableDifference: "Dimissioni inferiori senza aumento del carico." },
    { name: "Selezione del gruppo", mechanism: "Aderiscono soprattutto persone già propense a restare.", observableDifference: "Il divario scompare confrontando gruppi inizialmente simili." },
  ],
  nextChecks: [{ question: "I gruppi sono comparabili prima del cambiamento?", whyItMatters: "Distingue l'effetto organizzativo dalla selezione.", sourceHint: "Dati interni delle coorti da richiedere." }],
  limitations: ["Nessuna osservazione recuperata; sono ipotesi, non risultati verificati."],
};
function wire() {
  const raw = graph();
  raw.nodes = raw.nodes.map(({ id, ...node }, index) => ({
    ...node, parentIndex: index ? 0 : null,
    mechanism: index ? "Collegamento ipotetico da verificare" : "",
    relation: index ? (index === 1 ? "requires" : "challenges") : null,
  }));
  delete raw.edges;
  return raw;
}
const response = (value) => Response.json({
  choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }],
  usage: { prompt_tokens: 10, completion_tokens: 20, cost: 0 },
});
const provider = config({ NESSO_PROVIDER: "openai-compatible", NESSO_MODEL: "fixture" });

test("medium effort passes a validated critical brief to the map without treating it as a new source", async () => {
  let calls = 0;
  const result = await analyze(provider, { ...input, effort: "medium" }, undefined, async (_, request) => {
    calls++;
    if (calls === 1) return response(plan);
    if (calls === 2) return response(brief);
    assert.equal(calls, 3);
    const messages = JSON.parse(request.body).messages;
    const supplied = JSON.parse(messages.find((message) => message.role === "user").content);
    assert.deepEqual(supplied.criticalBrief, brief);
    assert.equal(supplied.originalThesis, input.thesis);
    assert.match(messages[0].content, /NON una nuova fonte/);
    return response(wire());
  });
  assert.deepEqual(result.reasoning, brief);
  assert.equal(result.provenance.deepening.status, "complete");
  assert.equal(result.provenance.stages.length, 3);
  assert.equal(result.graph.nodes[0].label, input.thesis);
});

test("invalid critical brief falls back explicitly without contaminating the map", async () => {
  let calls = 0;
  const result = await analyze(provider, { ...input, effort: "medium" }, undefined, async (_, request) => {
    calls++;
    if (calls === 1) return response(plan);
    if (calls === 2) return response({ unvalidated: "Do not use this as evidence" });
    assert.equal(calls, 3);
    const supplied = JSON.parse(JSON.parse(request.body).messages.find((message) => message.role === "user").content);
    assert.equal(supplied.criticalBrief, undefined);
    return response(wire());
  });
  assert.equal(result.reasoning, undefined);
  assert.equal(result.provenance.deepening.status, "unavailable");
  assert.equal(result.provenance.deepening.failureType, "validation");
  assert.ok(result.provenance.deepening.diagnostic.length > 0);
  assert.equal(result.graph.nodes.length, 3);
});

test("a small shared timeout reserves the budget for the map, not another model call", async () => {
  let calls = 0;
  const result = await analyze({ ...provider, timeout: 1000 }, { ...input, effort: "max" }, undefined, async () => {
    calls++;
    return response(calls === 1 ? plan : wire());
  });
  assert.equal(calls, 2);
  assert.equal(result.reasoning, undefined);
  assert.equal(result.provenance.deepening.status, "unavailable");
});

test("user cancellation during deepening prevents a graph request", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(analyze(provider, { ...input, effort: "medium" }, controller.signal, async () => {
    calls++;
    if (calls === 1) return response(plan);
    controller.abort();
    throw controller.signal.reason;
  }), (error) => error.name === "AbortError");
  assert.equal(calls, 2);
});
