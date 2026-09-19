import test from "node:test";
import assert from "node:assert/strict";
import {
  validateGraph,
  validateCriteria,
  evaluate,
  inputSpec,
} from "../server/domain.js";
import { graph, input, criterion } from "./fixtures.js";

test("generic graph preserves arbitrary IDs and marks all generated nodes unverified", () => {
  const result = validateGraph(graph(), "low");
  assert.equal(result.nodes[1].id, "retention");
  assert.equal(result.nodes[1].depth, 1);
  assert.ok(result.nodes.every((n) => n.evidenceStatus === "unverified"));
});
test("reject duplicate IDs, cycles, dangling refs, orphan nodes and excessive depth", () => {
  for (const mutate of [
    (g) => (g.nodes[1].id = "root"),
    (g) => (g.edges[0].to = "missing"),
    (g) => (g.edges = []),
    (g) =>
      g.edges.push(
        { from: "retention", to: "alternative", mechanism: "test" },
        { from: "alternative", to: "retention", mechanism: "test" },
      ),
  ]) {
    const g = graph();
    mutate(g);
    assert.throws(() => validateGraph(g, "low"));
  }
  const g = graph();
  g.nodes.push(
    { ...g.nodes[1], id: "depth2" },
    { ...g.nodes[1], id: "depth3" },
  );
  g.edges.push(
    { from: "retention", to: "depth2", mechanism: "m" },
    { from: "depth2", to: "depth3", mechanism: "m" },
  );
  assert.throws(() => validateGraph(g, "low"), /profondità/);
});
test("validate preregistration weights and future measurement dates", () => {
  assert.equal(validateCriteria([criterion]).length, 1);
  assert.throws(
    () => validateCriteria([{ ...criterion, weight: 99 }]),
    /somma/,
  );
  assert.throws(
    () => validateCriteria([{ ...criterion, due: "2000-01-01" }]),
    /retroattiva/,
  );
  assert.throws(() => inputSpec({ ...input, deadline: "2027-02-30" }), /data/);
});
test("missing data is not zero; future observations and wrong dates cannot earn points", () => {
  const snapshot = { criteria: [criterion] },
    now = new Date("2100-01-01T12:00:00Z");
  const observation = {
    criterionId: "c1",
    value: 0,
    source: criterion.source,
    observedAt: criterion.due,
  };
  assert.equal(evaluate(snapshot, [observation], now).score, 0);
  assert.equal(
    evaluate(snapshot, [{ ...observation, value: null }], now).score,
    null,
  );
  assert.equal(evaluate(snapshot, [], now).coverage, 0);
  assert.equal(
    evaluate(snapshot, [{ ...observation, value: 95 }], now).score,
    100,
  );
  assert.equal(
    evaluate(
      snapshot,
      [{ ...observation, value: 95, source: "altra fonte" }],
      now,
    ).score,
    null,
  );
  assert.equal(
    evaluate(
      snapshot,
      [{ ...observation, value: 95, observedAt: "2099-12-30" }],
      now,
    ).score,
    null,
  );
  assert.throws(
    () => evaluate(snapshot, [observation], new Date("2026-09-19T12:00:00Z")),
    /future/,
  );
});
test("partial evidence does not renormalize to a full score", () => {
  const s = {
    criteria: [
      { ...criterion, weight: 50 },
      { ...criterion, id: "c2", weight: 50 },
    ],
  };
  const r = evaluate(
    s,
    [
      {
        criterionId: "c1",
        value: 100,
        observedAt: criterion.due,
        source: criterion.source,
      },
    ],
    new Date("2100-01-01"),
  );
  assert.equal(r.coverage, 50);
  assert.equal(r.score, null);
  assert.equal(r.results[1].points, null);
});
test("malformed nested values return intentional validation errors", () => {
  assert.throws(
    () => validateCriteria([null]),
    (e) => e.status === 400,
  );
  assert.throws(
    () => evaluate({ criteria: [criterion] }, [null]),
    (e) => e.status === 400,
  );
  const g = graph();
  g.nodes[1] = null;
  assert.throws(
    () => validateGraph(g, "low"),
    (e) => e.status === 422,
  );
  const h = graph();
  h.edges[0] = null;
  assert.throws(
    () => validateGraph(h, "low"),
    (e) => e.status === 422,
  );
});
