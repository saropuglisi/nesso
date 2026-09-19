import test from "node:test";
import assert from "node:assert/strict";
import { readScenario } from "../server/scenario.js";
test("extracted numbers require verbatim evidence and matching numeric amount", () => {
  const raw = {
    kind: "marketplace",
    currency: "EUR",
    values: [
      { key: "gmv", value: 100000000, sourceQuote: "100 milioni di euro" },
    ],
  };
  assert.equal(
    readScenario(raw, "Scenario: 100 milioni di euro").values.gmv,
    100000000,
  );
  assert.throws(() => readScenario(raw, "Nessun dato fornito"));
  raw.values[0].value = 100;
  assert.throws(() => readScenario(raw, "Scenario: 100 milioni di euro"));
  raw.values[0].value = 400000000;
  assert.throws(() => readScenario(raw, "Scenario: 100 milioni di euro"));
});

test("policy-rate evidence cannot substitute for a bond yield scenario", () => {
  const thesis = "Taglio tasso ufficiale di 50 bp, rendimento invariato.";
  assert.throws(
    () =>
      readScenario(
        {
          kind: "bond",
          currency: "",
          values: [
            {
              key: "yieldChangeBp",
              value: -50,
              sourceQuote: "tasso ufficiale di 50 bp",
            },
          ],
        },
        thesis,
      ),
    /rendimento del titolo/,
  );
});
