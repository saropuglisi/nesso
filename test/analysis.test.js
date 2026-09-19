import test from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../server/analysis.js";
import { config } from "../server/provider.js";
import { validateGraph } from "../server/domain.js";
import { graph, input } from "./fixtures.js";

test("analysis computes plan before the model receives it and compiles only declared parent links", async () => {
  let calls = 0;
  const plan = {
    scenario: { kind: "generic", currency: "", values: [] },
    conclusion: "Controllare profitto",
    limitation: "Scenario",
    calculations: [
      {
        label: "Profitto",
        expression: "1300*(80-60)-20000",
        unit: "EUR",
        basis: "Dati utente",
      },
    ],
  };
  const raw = graph();
  raw.financial = plan;
  raw.nodes = raw.nodes.map(({ id, ...n }, i) => ({
    ...n,
    parentIndex: i === 0 ? null : 0,
    mechanism: i === 0 ? "" : "Meccanismo",
  }));
  delete raw.edges;
  const result = await analyze(
    config({ NESSO_PROVIDER: "openai-compatible", NESSO_MODEL: "fixture" }),
    input,
    undefined,
    async (_, request) => {
      const payload = JSON.parse(request.body);
      calls++;
      if (calls === 2) {
        const supplied = JSON.parse(payload.messages[1].content);
        assert.equal(supplied.computed.calculations[0].result, 6000);
        assert.equal(
          payload.response_format.json_schema.schema.properties.edges,
          undefined,
        );
      }
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify(
                calls === 1 ? plan : calls === 2 ? raw : { corrections: [] },
              ),
            },
          },
        ],
        usage: { cost: 0.01, prompt_tokens: 100, completion_tokens: 100 },
      });
    },
  );
  assert.equal(calls, 2);
  assert.equal(result.provenance.stages.length, 2);
  assert.equal(result.provenance.usage.cost, 0.02);
  assert.equal(
    validateGraph(result.graph, "low").financial.calculations[0].result,
    6000,
  );
});

test("supported financial scenario uses extracted evidence and code, without narrative regeneration", async () => {
  const supplied = {
    ...input,
    thesis:
      "100 milioni di euro, 70% marketplace, commissione 15%, resto diretto al lordo.",
  };
  const plan = {
    conclusion: "",
    limitation: "",
    calculations: [],
    scenario: {
      kind: "marketplace",
      currency: "EUR",
      values: [
        { key: "gmv", value: 100000000, sourceQuote: "100 milioni di euro" },
        {
          key: "marketplacePercent",
          value: 70,
          sourceQuote: "70% marketplace",
        },
        { key: "commissionPercent", value: 15, sourceQuote: "commissione 15%" },
      ],
    },
  };
  let calls = 0;
  const events = [];
  const result = await analyze(
    config({ NESSO_PROVIDER: "openai-compatible", NESSO_MODEL: "fixture" }),
    supplied,
    undefined,
    async () => {
      calls++;
      return Response.json({
        choices: [
          { finish_reason: "stop", message: { content: JSON.stringify(plan) } },
        ],
      });
    },
    (type, data) => events.push({ type, data }),
  );
  assert.equal(calls, 1);
  const valid = validateGraph(result.graph, "low");
  assert.equal(valid.financial.calculations[2].result, 40500000);
  assert.equal(
    result.provenance.extractedScenario.sources.gmv,
    "100 milioni di euro",
  );
  assert.equal(events.filter((e) => e.type === "node").length, 4);
});
