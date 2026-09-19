import test from "node:test";
import assert from "node:assert/strict";
import { applyReview } from "../server/review.js";
import { graph } from "./fixtures.js";
test("review changes only allowlisted text and preserves original graph", () => {
  const raw = graph();
  const edited = applyReview(raw, {
    corrections: [
      {
        path: "focus.claim",
        before: raw.focus.claim,
        after: "Una condizione più precisa",
        reason: "Specificità",
      },
    ],
  });
  assert.notEqual(edited.focus.claim, raw.focus.claim);
  assert.deepEqual(edited.nodes, raw.nodes);
  for (const path of [
    "edges.0.from",
    "__proto__.x",
    "financial.calculations.0.expression",
    "nodes.99.label",
  ]) {
    assert.throws(() =>
      applyReview(raw, {
        corrections: [{ path, before: "x", after: "y", reason: "Test" }],
      }),
    );
  }
  assert.throws(() =>
    applyReview(raw, {
      corrections: [{ path: "summary", after: "", reason: "Test" }],
    }),
  );
});
