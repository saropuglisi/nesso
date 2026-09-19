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
