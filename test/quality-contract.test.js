import test from "node:test";
import assert from "node:assert/strict";
import { computeScenario } from "../server/finance-kernel.js";
import { scenarioGraph } from "../server/scenario.js";
import { EFFORT, validateGraph } from "../server/domain.js";

const input = {
  thesis: "Verifica finanziaria condizionale sui dati forniti.",
  effort: "low",
  domain: null,
  deadline: null,
  referenceDate: "2026-09-20",
  context: "",
};

const scenarios = [
  {
    kind: "pricing",
    currency: "EUR",
    values: {
      price: 100,
      quantity: 1000,
      variableCost: 60,
      fixedCost: 20000,
      discountPercent: 20,
      newQuantity: 1300,
    },
  },
  {
    kind: "marketplace",
    currency: "EUR",
    values: { gmv: 100000000, marketplacePercent: 70, commissionPercent: 15 },
  },
  {
    kind: "earnings",
    currency: "EUR",
    values: {
      reportedEps: 1.1,
      consensusEps: 1,
      guidanceEps: 4,
      consensusGuidance: 5,
    },
  },
  {
    kind: "bond",
    currency: "USD",
    values: { modifiedDuration: 7, price: 100, yieldChangeBp: -50 },
  },
];

test("deterministic finance graphs validate at every effort without node inflation", () => {
  for (const scenario of scenarios) {
    const computed = computeScenario(scenario);
    const graph = scenarioGraph(
      { ...input, thesis: `Scenario ${scenario.kind}: ${input.thesis}` },
      scenario,
      computed,
    );

    // The deterministic graph is intentionally compact: root, two computed
    // consequences and one alternative. Effort controls model exploration,
    // not a requirement to manufacture extra finance nodes.
    assert.equal(graph.nodes.length, 4, scenario.kind);
    for (const effort of Object.keys(EFFORT)) {
      assert.doesNotThrow(
        () => validateGraph(graph, effort),
        `${scenario.kind}/${effort}`,
      );
    }
  }
});
