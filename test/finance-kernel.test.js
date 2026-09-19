import test from "node:test";
import assert from "node:assert/strict";
import { computeScenario } from "../server/finance-kernel.js";

function assertCalculations(result, expected) {
  assert.ok(result.calculations.length <= 3);
  assert.deepEqual(
    result.calculations.map((calculation) => calculation.result),
    expected,
  );
  assert.ok(
    result.calculations.every((calculation) => calculation.arithmeticValid),
  );
}

test("pricing computes before and after economics plus quantity preserving profit", () => {
  const result = computeScenario({
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
  });

  assert.equal(result.facts.before.revenue, 100000);
  assert.equal(result.facts.before.profit, 20000);
  assert.equal(result.facts.after.revenue, 104000);
  assert.equal(result.facts.after.profit, 6000);
  assert.equal(result.facts.targetQuantityPreservingBeforeProfit, 2000);
  assertCalculations(result, [104000, 6000, 2000]);
  assert.match(result.conclusion, /104\.000/);
  assert.match(result.conclusion, /6000/);
  assert.match(result.conclusion, /2000/);
  for (const key of ["claim", "why", "assumption", "test"])
    assert.ok(result.focus[key]);
  for (const key of ["label", "assumption", "challenge", "falsifier"])
    assert.ok(result.alternative[key]);
});

test("marketplace separates marketplace commission revenue from direct revenue", () => {
  const result = computeScenario({
    kind: "marketplace",
    values: { gmv: 100000000, marketplacePercent: 70, commissionPercent: 15 },
  });

  assert.equal(result.facts.marketplaceGmv, 70000000);
  assert.equal(result.facts.directGmv, 30000000);
  assert.equal(result.facts.marketplaceRevenue, 10500000);
  assert.equal(result.facts.directRevenue, 30000000);
  assert.equal(result.facts.totalRevenue, 40500000);
  assertCalculations(result, [10500000, 30000000, 40500000]);
  assert.equal(Object.hasOwn(result.facts, "profit"), false);
  assert.match(result.conclusion, /40\.500\.000/);
});

test("earnings keeps quarterly and annual comparisons separate and avoids price causality", () => {
  const result = computeScenario({
    kind: "earnings",
    values: {
      reportedEps: 1.1,
      consensusEps: 1,
      guidanceEps: 4,
      consensusGuidance: 5,
    },
  });

  assert.equal(result.facts.quarterly.surprisePercent, 10);
  assert.equal(result.facts.annual.surprisePercent, -20);
  assertCalculations(result, [10, -20]);
  assert.match(result.conclusion, /10/);
  assert.match(result.conclusion, /20/);
  assert.match(result.conclusion, /non implicano che il prezzo debba salire/);
  assert.equal(
    result.facts.priceConclusion,
    "non determinabile da questi soli confronti",
  );
});

test("bond uses duration first order, reports unchanged-yield scenario and no convexity", () => {
  const result = computeScenario({
    kind: "bond",
    currency: "USD",
    values: { modifiedDuration: 7, price: 100, yieldChangeBp: -50 },
  });

  assert.equal(result.facts.linearDeltaPrice, 3.5);
  assert.equal(result.facts.approximatePrice, 103.5);
  assert.equal(result.facts.unchangedYieldChangeBp, 0);
  assert.equal(result.facts.unchangedPrice, 100);
  assertCalculations(result, [3.5, 103.5, 100]);
  assert.match(result.conclusion, /103.5/);
  assert.match(result.limitations, /convessità/);
  assert.match(result.conclusion, /rendimento richiesto/);
});

test("rejects missing, non-finite, out-of-range and zero-denominator values", () => {
  const cases = [
    { kind: "pricing", values: { price: 100 } },
    {
      kind: "pricing",
      values: {
        price: 100,
        quantity: 1000,
        variableCost: 95,
        fixedCost: 20,
        discountPercent: 20,
        newQuantity: 1300,
      },
    },
    {
      kind: "pricing",
      values: {
        price: 100,
        quantity: 1000,
        variableCost: 60,
        fixedCost: 20,
        discountPercent: 101,
        newQuantity: 1300,
      },
    },
    {
      kind: "marketplace",
      values: { gmv: 100, marketplacePercent: -1, commissionPercent: 15 },
    },
    {
      kind: "marketplace",
      values: { gmv: 100, marketplacePercent: 70, commissionPercent: 101 },
    },
    {
      kind: "earnings",
      values: {
        reportedEps: 1,
        consensusEps: 0,
        guidanceEps: 4,
        consensusGuidance: 5,
      },
    },
    {
      kind: "earnings",
      values: {
        reportedEps: 1,
        consensusEps: -1,
        guidanceEps: 4,
        consensusGuidance: 5,
      },
    },
    {
      kind: "earnings",
      values: {
        reportedEps: NaN,
        consensusEps: 1,
        guidanceEps: 4,
        consensusGuidance: 5,
      },
    },
    {
      kind: "bond",
      values: { modifiedDuration: 0, price: 100, yieldChangeBp: -50 },
    },
    {
      kind: "bond",
      values: { modifiedDuration: 7, price: 0, yieldChangeBp: -50 },
    },
  ];
  for (const scenario of cases)
    assert.throws(
      () => computeScenario(scenario),
      (error) => error instanceof Error && error.status === 422,
    );
});

test("uses the explicit currency and returns null for generic scenarios", () => {
  const result = computeScenario({
    kind: "pricing",
    values: {
      price: 10,
      quantity: 10,
      variableCost: 2,
      fixedCost: 1,
      discountPercent: 0,
      newQuantity: 10,
    },
  });
  assert.equal(result.facts.currency, "unità monetarie");
  assert.equal(computeScenario({ kind: "generic", values: {} }), null);
});
