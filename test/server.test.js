import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { once } from "node:events";
import http from "node:http";
import { createApp } from "../server/index.js";
import { openStore } from "../server/store.js";
import { config } from "../server/provider.js";
import { graph, input, criterion } from "./fixtures.js";

test("research is opt-in server-side, cannot be forged by client, and persists with citations", async (t) => {
  const store = openStore(":memory:");
  const evidence = { status: "collected", sources: [{ id: "R1", provider: "worldbank", kind: "data", title: "Observation", url: "https://api.worldbank.org/", data: { value: 3.25 } }], attempts: [], warnings: [] };
  let researches = 0;
  const app = createApp({ store, provider: config({ NESSO_MODEL: "test" }), sourcesConfig: { secUserAgent: "private@test.example", fredKey: "f".repeat(32) },
    researcher: async () => { researches++; return evidence; },
    inference: async (_provider, received) => {
      assert.equal(Boolean(received.evidence), received.research);
      if (received.research) assert.deepEqual(received.evidence, evidence);
      const g = graph();
      if (received.research) g.nodes[1].sourceIds = ["R1"];
      return { graph: g, provenance: {} };
    },
  });
  app.server.listen(0, "127.0.0.1"); await once(app.server, "listening");
  t.after(() => { app.server.closeAllConnections(); app.server.close(); store.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const publicInfo = await (await fetch(base + "/api/config")).text();
  assert.ok(!publicInfo.includes("private@test.example"));
  assert.ok(!publicInfo.includes("f".repeat(32)));
  for (const enabled of [false, true]) {
    const response = await fetch(base + "/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, research: enabled, evidence: { forged: true } }) });
    assert.equal(response.status, 201);
    const record = await response.json();
    assert.equal(Boolean(record.body.research), enabled);
    if (enabled) {
      assert.deepEqual(record.body.research, evidence);
      assert.deepEqual(record.body.graph.nodes[1].sourceIds, ["R1"]);
      assert.deepEqual(store.get(record.id).body.research, evidence);
    }
  }
  assert.equal(researches, 1);
});

test("full HTTP workflow persists genuine provider output, freezes criteria, rejects cross-origin", async (t) => {
  const store = openStore(":memory:"),
    provider = config({ NESSO_MODEL: "test" });
  const app = createApp({
    store,
    provider,
    inference: async () => ({
      graph: graph(),
      provenance: {
        model: "test",
        provider: "test",
        generatedAt: new Date().toISOString(),
      },
    }),
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  t.after(() => {
    app.server.closeAllConnections();
    app.server.close();
    store.close();
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = (path, body, extra = {}) =>
    fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json", ...extra },
      body: JSON.stringify(body),
    });
  const a = await post("/api/analyze", input);
  assert.equal(a.status, 201);
  const analysis = await a.json();
  assert.equal(analysis.body.graph.nodes.length, 3);
  const s = await post("/api/snapshots", {
    analysisId: analysis.id,
    criteria: [criterion],
    confirmed: true,
  });
  assert.equal(s.status, 201);
  const snapshot = await s.json();
  assert.equal(snapshot.body.analysisHash, analysis.sha256);
  const duplicate = await post("/api/snapshots", {
    analysisId: analysis.id,
    criteria: [criterion],
    confirmed: true,
  });
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).id, snapshot.id);
  assert.equal(
    (
      await post("/api/snapshots", {
        analysisId: analysis.id,
        criteria: [{ ...criterion, due: "2100-01-01" }],
        confirmed: true,
      })
    ).status,
    400,
  );
  assert.equal(
    (await post("/api/snapshots", { criteria: [criterion], confirmed: true }))
      .status,
    400,
  );
  assert.equal(
    (
      await post("/api/evaluations", {
        snapshotId: snapshot.id,
        observations: [],
      })
    ).status,
    400,
  );
  const v = await post("/api/evaluations", {
    snapshotId: snapshot.id,
    observations: [],
    confirmed: true,
  });
  assert.equal(v.status, 201);
  assert.equal((await v.json()).body.score, null);
  const journal = await (await fetch(base + "/api/journal")).json();
  assert.equal(journal.analyses.length, 1);
  assert.equal(journal.analyses[0].id, analysis.id);
  assert.equal(journal.snapshots.length, 1);
  assert.equal(journal.evaluations.length, 1);
  assert.equal(
    (await post("/api/analyze", input, { origin: "https://attacker.example" }))
      .status,
    403,
  );
  const wrongHostStatus = await new Promise((resolve, reject) => {
    http
      .get(
        base + "/api/config",
        { headers: { host: "attacker.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      )
      .on("error", reject);
  });
  assert.equal(wrongHostStatus, 403);
  assert.equal(
    (await fetch(base + "/api/records/" + snapshot.id, { method: "PUT" }))
      .status,
    405,
  );
  assert.equal((await fetch(base + "/.env")).status, 404);
});
test("invalid model output never enters storage", async (t) => {
  const store = openStore(":memory:"),
    app = createApp({
      store,
      provider: config({ NESSO_MODEL: "test" }),
      inference: async () => ({ graph: {}, provenance: {} }),
    });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  t.after(() => {
    app.server.closeAllConnections();
    app.server.close();
    store.close();
  });
  const r = await fetch(
    `http://127.0.0.1:${app.server.address().port}/api/analyze`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  assert.ok(r.status >= 400);
  assert.equal(store.list("analysis").length, 0);
});
test("dialogue preserves thesis/context, does not save a provisional map, and releases busy on failure", async (t) => {
  const store = openStore(":memory:");
  let fail = true;
  const response = { observation: "Osservazione", question: "Quale esito?", options: ["Uno", "Due"] };
  const app = createApp({
    store,
    provider: config({ NESSO_MODEL: "fixture" }),
    dialogue: async (_, received) => {
      assert.equal(received.thesis, input.thesis);
      assert.equal(received.context, "Risposta dell’utente");
      if (fail) throw new Error("provider offline");
      return response;
    },
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  t.after(() => { app.server.closeAllConnections(); app.server.close(); store.close(); });
  const endpoint = `http://127.0.0.1:${app.server.address().port}/api/critique`;
  const post = (body, headers = {}) => fetch(endpoint, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  });
  const body = { ...input, context: "Risposta dell’utente" };
  assert.equal((await post(body)).status, 500);
  fail = false;
  const result = await post(body);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), response);
  assert.equal(store.list("analysis").length, 0);
  assert.equal((await post({ ...body, thesis: "x" })).status, 400);
  assert.equal((await post(body, { origin: "https://attacker.example" })).status, 403);
});

test("SQLite persists across restart and rejects updates and deletes", () => {
  const dir = mkdtempSync(join(tmpdir(), "nesso-test-")),
    file = join(dir, "journal.sqlite");
  let store = openStore(file);
  const record = store.add("analysis", { input });
  store.close();
  store = openStore(file);
  assert.deepEqual(store.get(record.id), record);
  store.close();
  const db = new DatabaseSync(file);
  assert.throws(() => db.exec("UPDATE records SET body='{}'"), /immutable/);
  assert.throws(() => db.exec("DELETE FROM records"), /immutable/);
  db.close();
});
