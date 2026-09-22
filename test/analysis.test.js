import test from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../server/analysis.js";
import { config } from "../server/provider.js";
import { validateGraph } from "../server/domain.js";
import { graph, input } from "./fixtures.js";

for (const defect of ["none", "trailing-zero", "inline-citation", "citation-as-number", "uncited-reference", "lowercase-reference", "metadata-number", "unknown-source", "uncited-number", "discovery-source", "multiple-numbers", "requested-period", "asserted-period", "requested-value"]) {
  test(`research evidence grounding: ${defect}`, async () => {
    const plan = { scenario: { kind: "generic", currency: "", values: [] }, conclusion: "Controllare il nesso", limitation: "Dati parziali", calculations: [] };
    const raw = graph();
    raw.financial = plan;
    raw.nodes = raw.nodes.map(({ id, ...node }, i) => ({ ...node, parentIndex: i ? 0 : null, mechanism: i ? "Meccanismo" : "", relation: i ? (i === 1 ? "supports" : "challenges") : null, sourceIds: i === 1 ? ["R1"] : [] }));
    delete raw.edges;
    raw.nodes[1].label = defect === "trailing-zero" ? "La misura osservata è 4.0" : "La misura osservata è 3.25";
    if (defect === "inline-citation") raw.nodes[1].label += " (R1)";
    if (defect === "requested-period") raw.nodes[2].evidenceNeeded = ["Dati sulla produttività nel periodo 2014-2025, da recuperare per un confronto omogeneo."];
    const bad = structuredClone(raw);
    if (defect === "unknown-source") bad.nodes[1].sourceIds = ["R6"];
    if (defect === "uncited-number") bad.nodes[1].sourceIds = [];
    if (defect === "discovery-source") bad.nodes[1].sourceIds = ["R2"];
    if (defect === "citation-as-number") bad.nodes[1].label = "La misura osservata è 1";
    if (defect === "uncited-reference") bad.nodes[2].challenge = "Come verificare R1?";
    if (defect === "lowercase-reference") bad.nodes[2].challenge = "Come verificare r1?";
    if (defect === "metadata-number") bad.nodes[1].label = "La misura osservata è 2026";
    if (defect === "asserted-period") bad.nodes[2].label = "La produttività cresce nel periodo 2014-2025";
    if (defect === "requested-value") bad.nodes[2].evidenceNeeded = ["Confrontare la produttività con una soglia di 3.25"];
    if (defect === "multiple-numbers") {
      bad.nodes[1].sourceIds = [];
      bad.nodes[2].challenge = "Il dato supera 47.82?";
    }
    const evidence = { sources: [{ id: "R1", kind: "data", data: { value: defect === "trailing-zero" ? 4 : 3.25 } }, { id: "R2", kind: "discovery", data: { value: 3.25 } }] };
    evidence.sources[0].retrievedAt = "2026-09-21T08:40:00.000Z";
    evidence.sources[0].url = "https://example.org/observations?year=2026&limit=20";
    evidence.sources[0].data.observations = [{ date: "2014", value: null }, { date: "2025", value: null }];
    let calls = 0;
    const result = await analyze(config({ NESSO_PROVIDER: "openai-compatible", NESSO_MODEL: "fixture" }), { ...input, evidence }, undefined, async (_, request) => {
      calls++;
      if (calls > 1) {
        const payload = JSON.parse(request.body);
        assert.deepEqual(JSON.parse(payload.messages[1].content).evidence, evidence);
        assert.ok(payload.response_format.json_schema.schema.properties.nodes.items.required.includes("sourceIds"));
        assert.match(payload.messages[0].content, /plannerNotes.*NON VERIFICATE/);
        if (calls === 3 && defect === "multiple-numbers") {
          const correction = JSON.parse(payload.messages[1].content).correction;
          assert.match(correction, /nodes\[1\]\.label: numero 3\.25/);
          assert.match(correction, /nodes\[2\]\.challenge: numero 47\.82/);
        }
        if (calls === 3 && defect === "citation-as-number")
          assert.match(JSON.parse(payload.messages[1].content).correction, /numero 1 non presente/);
      }
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(calls === 1 ? plan : calls === 2 ? bad : raw) } }] });
    });
    assert.equal(calls, ["none", "trailing-zero", "inline-citation", "requested-period"].includes(defect) ? 2 : 3);
    assert.deepEqual(validateGraph(result.graph, "low").nodes[1].sourceIds, ["R1"]);
  });
}

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
    relation: i === 0 ? null : i === 1 ? "supports" : "challenges",
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
        assert.equal(
          payload.response_format.json_schema.schema.properties.nodes.minItems,
          3,
        );
        assert.equal(
          supplied.originalThesis,
          input.thesis,
        );
        assert.equal(supplied.context, input.context);
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
  assert.equal(result.graph.nodes[0].label, input.thesis);
  assert.equal(result.graph.edges[0].relation, "supports");
  assert.equal(result.graph.interpretation.horizon, "");
  assert.equal(result.graph.interpretation.deadline, input.deadline);
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

for (const defect of ["root-cause", "invented-number", "empty-challenge"]) {
test(`analysis corrects ${defect} once before returning a valid graph`, async () => {
  const plan = {
    scenario: { kind: "generic", currency: "", values: [] },
    conclusion: "Controllare il nesso",
    limitation: "Dati mancanti",
    calculations: [],
  };
  const raw = graph();
  raw.financial = plan;
  raw.nodes = raw.nodes.map(({ id, ...node }, index) => ({
    ...node,
    parentIndex: index === 0 ? null : 0,
    mechanism: index === 0 ? "" : "Il passaggio va osservato.",
    relation: index === 0 ? null : index === 1 ? "supports" : "challenges",
  }));
  delete raw.edges;
  const invalid = structuredClone(raw);
  if (defect === "root-cause") invalid.nodes[1].relation = "causes";
  if (defect === "invented-number") invalid.nodes[1].label = "Retention superiore del 50%";
  if (defect === "empty-challenge") invalid.nodes[0].challenge = "";
  let calls = 0;
  const result = await analyze(
    config({ NESSO_PROVIDER: "openai-compatible", NESSO_MODEL: "fixture" }),
    input,
    undefined,
    async (_, request) => {
      calls++;
      const payload = JSON.parse(request.body);
      if (calls === 3) {
        assert.match(payload.messages[0].content, /correzione|falsifier/i);
        assert.equal(
          JSON.parse(payload.messages[1].content).originalThesis,
          input.thesis,
        );
      }
      const body = calls === 1 ? plan : calls === 2 ? invalid : raw;
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(body) },
          },
        ],
        usage: { cost: 0.01, prompt_tokens: 1, completion_tokens: 1 },
      });
    },
  );
  assert.equal(calls, 3);
  assert.equal(result.graph.nodes[0].label, input.thesis);
  assert.equal(result.provenance.stages.length, 3);
  assert.equal(result.provenance.usage.cost, 0.03);
});
}
