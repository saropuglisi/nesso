import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { analyze } from "../server/analysis.js";
import { config } from "../server/provider.js";
import { validateGraph } from "../server/domain.js";
import { createApp } from "../server/index.js";
import { openStore } from "../server/store.js";
import { graph, input } from "./fixtures.js";

const provider = config({ NESSO_PROVIDER: "openai-compatible", NESSO_MODEL: "fixture" });
const plan = {
  scenario: { kind: "generic", currency: "", values: [] },
  conclusion: "Controllare il nesso", limitation: "Dati mancanti", calculations: [],
};
const usage = { prompt_tokens: 10, completion_tokens: 20, cost: 0.01 };
const jsonResponse = (value) => Response.json({
  choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }], usage,
});
const frame = (delta) => `data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`;
const terminal = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage })}\n\ndata: [DONE]\n\n`;
function wireMap() {
  const raw = graph();
  raw.nodes = raw.nodes.map(({ id, ...node }, index) => ({
    ...node,
    parentIndex: index === 0 ? null : 0,
    mechanism: index === 0 ? "" : "Il collegamento è da verificare.",
    relation: index === 0 ? null : index === 1 ? "requires" : "challenges",
  }));
  delete raw.edges;
  return raw;
}

for (const defect of ["self-parent", "forward-parent", "null-parent", "invalid-focus", "invalid-json"]) {
  test(`streaming analysis repairs ${defect} once and clears the invalid draft`, async () => {
    const valid = wireMap(), invalid = structuredClone(valid);
    if (defect === "self-parent") invalid.nodes[2].parentIndex = 2;
    if (defect === "forward-parent") invalid.nodes[2].parentIndex = 8;
    if (defect === "null-parent") invalid.nodes[2].parentIndex = null;
    if (defect === "invalid-focus") invalid.focus = { claim: "Test" };
    const badText = defect === "invalid-json" ? '{"focus":' : JSON.stringify(invalid);
    const events = [];
    let calls = 0, cancellations = 0;
    const result = await analyze(provider, input, undefined, async (_, request) => {
      calls++;
      const payload = JSON.parse(request.body);
      if (calls === 1) return jsonResponse(plan);
      assert.equal(payload.stream, true);
      if (calls === 2) {
        if (defect === "invalid-json") return new Response(frame(badText) + terminal);
        // Deliberately keep this stream open. A rejected prefix must be
        // cancelled, not drained or left waiting for the provider to finish.
        return new Response(new ReadableStream({
          start(controller) { controller.enqueue(new TextEncoder().encode(frame(badText))); },
          cancel() { cancellations++; },
        }));
      }
      assert.equal(calls, 3);
      assert.equal(cancellations, defect === "invalid-json" ? 0 : 1);
      const correction = JSON.parse(payload.messages[1].content);
      assert.equal(correction.originalThesis, input.thesis);
      assert.equal(correction.previousAttempt.partial, true);
      assert.equal(correction.previousAttempt.content, badText);
      assert.match(correction.correction, /parentIndex|Punto decisivo|JSON/);
      assert.equal(events.at(-2).type, "reset");
      return new Response(frame(JSON.stringify(valid)) + terminal);
    }, (type, data) => events.push({ type, data }));
    assert.equal(calls, 3);
    const reset = events.findIndex((event) => event.type === "reset");
    assert.ok(reset >= 0);
    assert.equal(events.filter((event) => event.type === "reset").length, 1);
    assert.ok(!events.slice(0, reset).some((event) => event.type === "node" && event.data.id === "n2"));
    assert.deepEqual(events.slice(reset).filter((event) => event.type === "node").map((event) => event.data.id), ["n0", "n1", "n2"]);
    assert.deepEqual(result.graph.edges.map(({ from, to }) => [from, to]), [["n0", "n1"], ["n0", "n2"]]);
    assert.equal(validateGraph(result.graph, "low").nodes.length, 3);
    assert.equal(result.graph.nodes[0].label, input.thesis);
    assert.equal(result.provenance.stages.length, 3);
    assert.equal(result.provenance.stages[1].status, "invalid");
    assert.equal(result.provenance.usage.cost, defect === "invalid-json" ? 0.03 : null);
    assert.equal(result.provenance.usage.completion_tokens, defect === "invalid-json" ? 60 : null);
  });
}

test("HTTP streaming repairs before saving and never saves two invalid attempts", async (t) => {
  const store = openStore(":memory:");
  let calls = 0, alwaysInvalid = false;
  const valid = wireMap(), invalid = structuredClone(valid);
  invalid.nodes[2].parentIndex = 2;
  const app = createApp({
    store, provider,
    inference: (c, supplied, signal, _, emit) => analyze(c, supplied, signal, async () => {
      calls++;
      assert.equal(store.list("analysis").length, alwaysInvalid ? 1 : 0);
      if (calls % 3 === 1) return jsonResponse(plan);
      const raw = alwaysInvalid || calls % 3 === 2 ? invalid : valid;
      return new Response(frame(JSON.stringify(raw)) + terminal);
    }, emit),
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  t.after(() => { app.server.closeAllConnections(); app.server.close(); store.close(); });
  const request = async () => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/analyze/stream`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
    });
    return (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  };
  const success = await request();
  assert.equal(success.filter((event) => event.type === "reset").length, 1);
  assert.equal(success.at(-1).type, "complete");
  assert.equal(calls, 3);
  assert.equal(store.list("analysis").length, 1);
  alwaysInvalid = true;
  const failed = await request();
  assert.equal(failed.filter((event) => event.type === "reset").length, 1);
  assert.equal(failed.at(-1).type, "error");
  assert.match(JSON.stringify(failed.at(-1)), /parentIndex/);
  assert.equal(calls, 6);
  assert.equal(store.list("analysis").length, 1);
});

for (const failure of ["transport", "abort", "abort-during-repair"]) {
  test(`streaming analysis does not retry ${failure}`, async () => {
    let calls = 0;
    const events = [], controller = new AbortController();
    await assert.rejects(analyze(provider, input, controller.signal, async () => {
      calls++;
      if (calls === 1) return jsonResponse(plan);
      if (failure === "transport") return new Response('data: {"error":{"message":"private-provider-detail"}}\n\n');
      if (failure === "abort") controller.abort();
      const invalid = wireMap();
      invalid.nodes[2].parentIndex = 2;
      return new Response(frame(JSON.stringify(invalid)) + terminal);
    }, (type, data) => {
      events.push({ type, data });
      if (failure === "abort-during-repair" && type === "reset") controller.abort();
    }));
    assert.equal(calls, 2);
    assert.equal(events.some((event) => event.type === "reset"), failure === "abort-during-repair");
  });
}

test("the shared timeout aborts a stalled stream without another generation", async () => {
  let calls = 0;
  const shortProvider = { ...provider, timeout: 1000 };
  await assert.rejects(analyze(shortProvider, input, undefined, async (_, request) => {
    calls++;
    if (calls === 1) return jsonResponse(plan);
    return new Response(new ReadableStream({
      start(controller) {
        request.signal.addEventListener("abort", () => controller.error(request.signal.reason), { once: true });
      },
    }));
  }, () => {}), (error) => error.name === "TimeoutError");
  assert.equal(calls, 2);
});
