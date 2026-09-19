import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { graphIncremental, readProviderStream } from "../server/stream.js";
import { infer, config } from "../server/provider.js";
import { createApp } from "../server/index.js";
import { openStore } from "../server/store.js";
import { graph, input } from "./fixtures.js";

test("decisive point arrives before graph nodes and rejects incomplete focus", () => {
  const events = [];
  const append = graphIncremental((type, data) => events.push({ type, data }));
  const prefix = JSON.stringify({ focus: graph().focus }).slice(0, -1);
  for (const char of prefix) append(char);
  assert.deepEqual(events, [{ type: "focus", data: graph().focus }]);
  append(',"nodes":[' + JSON.stringify(graph().nodes[0]) + "]}");
  assert.equal(events[1].type, "node");
  assert.throws(
    () =>
      graphIncremental(() => {})(JSON.stringify({ focus: { claim: "test" } })),
    /Punto decisivo/,
  );
});

test("incremental graph emits complete objects once, respecting escaped strings and chunk splits", () => {
  const g = graph();
  g.nodes[0].label = 'Test { [ \\"nodes\\": [ ] } è';
  const items = [],
    append = graphIncremental((type, data) => items.push({ type, data }));
  for (const char of JSON.stringify(g)) append(char);
  assert.deepEqual(
    items.filter((x) => x.type === "node").map((x) => x.data),
    g.nodes,
  );
  assert.deepEqual(
    items.filter((x) => x.type === "edge").map((x) => x.data),
    g.edges,
  );
});

test("OpenRouter emits nodes before completion, preserves UTF-8 and validates terminal events", async () => {
  const encoder = new TextEncoder();
  let wire;
  const body = new ReadableStream({
    start(c) {
      wire = c;
    },
  });
  const items = [];
  const c = config({
    NESSO_PROVIDER: "openai-compatible",
    NESSO_MODEL: "fixture",
  });
  const source = JSON.stringify(graph()),
    split = source.indexOf("},{", source.indexOf('"nodes"')) + 1;
  const frame = (delta) =>
    `data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\r\n\r\n`;
  const result = infer(
    c,
    input,
    undefined,
    async (_, req) => {
      assert.equal(JSON.parse(req.body).stream, true);
      return new Response(body);
    },
    (type, data) => items.push({ type, data }),
  );
  for (const byte of encoder.encode(
    ": keepalive\r\n\r\n" + frame(source.slice(0, split)),
  ))
    wire.enqueue(new Uint8Array([byte]));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    items.filter((x) => x.type === "node").length,
    1,
    "a node must arrive while provider connection remains open",
  );
  wire.enqueue(
    encoder.encode(
      frame(source.slice(split)) +
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":42}}\n\ndata: [DONE]\n\n',
    ),
  );
  wire.close();
  const complete = await result;
  assert.equal(complete.graph.nodes[0].label, graph().nodes[0].label);
  assert.equal(complete.provenance.usage.total_tokens, 42);
  for (const invalid of [
    frame(source),
    'data: {"error":{"message":"secret"}}\n\n',
    'data: {"choices":[{"finish_reason":"length"}]}\n\n',
  ]) {
    await assert.rejects(
      () =>
        readProviderStream(
          new Response(invalid),
          "openai-compatible",
          () => {},
        ),
      (e) => !e.message.includes("secret"),
    );
  }
});

test("Ollama and Responses streaming decode completed graphs", async () => {
  const source = JSON.stringify(graph());
  for (const [provider, wire] of [
    [
      "ollama",
      JSON.stringify({ message: { content: source }, done: true }) + "\n",
    ],
    [
      "openai",
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: source })}\n\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n`,
    ],
  ]) {
    const result = await readProviderStream(
      new Response(wire),
      provider,
      () => {},
    );
    assert.equal(result.content, source);
  }
});

test("disconnecting the browser aborts inference without saving a draft", async (t) => {
  const store = openStore(":memory:");
  let aborted;
  const disconnected = new Promise((resolve) => {
    aborted = resolve;
  });
  const app = createApp({
    store,
    provider: config({ NESSO_MODEL: "fixture" }),
    inference: async (_, __, signal, ___, emit) => {
      emit("node", graph().nodes[0]);
      await new Promise((resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => {
            aborted();
            reject(new Error("cancelled"));
          },
          { once: true },
        ),
      );
    },
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  t.after(() => {
    app.server.closeAllConnections();
    app.server.close();
    store.close();
  });
  const abort = new AbortController();
  const response = await fetch(
    `http://127.0.0.1:${app.server.address().port}/api/analyze/stream`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: abort.signal,
    },
  );
  await response.body.getReader().read();
  abort.abort();
  await Promise.race([
    disconnected,
    new Promise((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error("abort not propagated")),
        2000,
      );
      timer.unref();
    }),
  ]);
  assert.equal(store.list("analysis").length, 0);
});

test("HTTP stream sends progress before completion and never saves invalid drafts", async (t) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const store = openStore(":memory:");
  let invalid = false;
  const app = createApp({
    store,
    provider: config({ NESSO_MODEL: "fixture" }),
    inference: async (_, __, signal, ___, emit) => {
      emit("node", graph().nodes[0]);
      await gate;
      return {
        graph: invalid ? {} : graph(),
        provenance: { model: "fixture" },
      };
    },
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  t.after(() => {
    app.server.closeAllConnections();
    app.server.close();
    store.close();
  });
  const request = () =>
    fetch(`http://127.0.0.1:${app.server.address().port}/api/analyze/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  const response = await request(),
    reader = response.body.getReader(),
    decoder = new TextDecoder();
  let received = decoder.decode((await reader.read()).value);
  assert.match(received, /"type":"node"/);
  assert.equal(store.list("analysis").length, 0);
  release();
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    received += decoder.decode(next.value);
  }
  assert.match(received, /"type":"complete"/);
  assert.equal(store.list("analysis").length, 1);
  invalid = true;
  const failed = await (await request()).text();
  assert.match(failed, /"type":"error"/);
  assert.equal(store.list("analysis").length, 1);
});
