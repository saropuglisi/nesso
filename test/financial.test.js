import test from "node:test";
import assert from "node:assert/strict";
import { validateFinancial } from "../server/domain.js";
import { graphIncremental } from "../server/stream.js";

test("financial calculations are recomputed rather than trusting a model result", () => {
  const f = validateFinancial({
    conclusion: "Esempio condizionale",
    limitation: "Dati sintetici",
    calculations: [
      {
        label: "Unità per mantenere il profitto",
        expression: "(20000+20000)/(80-60)",
        result: 1500,
        unit: "unità",
        basis: "Profitto obiettivo20000, fissi20000, prezzo80, costo60",
      },
      {
        label: "Profitto dopo",
        expression: "1300*(80-60)-20000",
        unit: "EUR",
        basis: "Dati forniti",
      },
    ],
  });
  assert.equal(f.calculations[0].result, 2000);
  assert.equal(f.calculations[1].result, 6000);
  assert.ok(f.calculations.every((c) => c.arithmeticValid));
});

test("invalid calculation stays explicitly unverified and cannot execute code", () => {
  const f = validateFinancial({
    conclusion: "Test",
    limitation: "Test",
    calculations: [
      {
        label: "Invalid",
        expression: "process.exit()",
        unit: "EUR",
        basis: "Test",
      },
    ],
  });
  assert.equal(f.calculations[0].arithmeticValid, false);
  assert.equal(f.calculations[0].result, null);
  assert.throws(() =>
    validateFinancial({
      conclusion: "Test",
      limitation: "Test",
      calculations: [null],
    }),
  );
});

test("financial streaming exposes computed values before nodes", () => {
  const events = [];
  graphIncremental((type, data) => events.push({ type, data }))(
    JSON.stringify({
      financial: {
        conclusion: "Ricavo marketplace",
        limitation: "Caso sintetico",
        calculations: [
          {
            label: "Ricavo",
            expression: "1000000*0.15",
            unit: "EUR",
            basis: "GMV e commissione forniti",
          },
        ],
      },
    }),
  );
  assert.equal(events[0].type, "financial");
  assert.equal(events[0].data.calculations[0].result, 150000);
});
