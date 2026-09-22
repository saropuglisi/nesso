import test from "node:test";
import assert from "node:assert/strict";
import {
  deepen,
  REASONING_SCHEMA,
  validateReasoningBrief,
} from "../server/reasoning.js";

const evidence = {
  status: "collected",
  sources: [
    {
      id: "R1",
      provider: "fixture",
      kind: "data",
      title: "Osservazione",
      retrievedAt: "2026-09-20",
      data: { value: 12.5, unit: "percento" },
    },
    {
      id: "R2",
      provider: "fixture",
      kind: "discovery",
      title: "Risultato da esplorare",
      data: { value: 99 },
    },
  ],
};

const financial = {
  conclusion: "Il calcolo è condizionato ai dati inseriti.",
  limitation: "Manca una misura osservata del meccanismo.",
  calculations: [
    {
      label: "Differenza",
      expression: "12.5 - 10",
      unit: "unità",
      basis: "Dati forniti dall’utente",
      result: 2.5,
      arithmeticValid: true,
    },
  ],
};

const input = {
  thesis: "La variabile osservata supera la soglia dichiarata",
  context: "Il confronto usa 10 come base.",
  domain: "general",
  effort: "medium",
  referenceDate: "2026-09-20",
  evidence,
};

function brief(overrides = {}) {
  return {
    question: "La differenza osservata dipende davvero dal meccanismo ipotizzato?",
    provisionalConclusion: "Il dato è compatibile con la tesi, ma non identifica da solo la causa.",
    supporting: [
      { claim: "La fonte riporta 12.5, sopra la base 10 dichiarata.", sourceIds: ["R1"] },
    ],
    opposing: [
      { claim: "Il confronto numerico non separa la causa da una spiegazione concorrente.", sourceIds: [] },
    ],
    assumptions: [
      {
        claim: "La misura della fonte usa la stessa definizione della tesi.",
        howToTest: "Confrontare unità, periodo e definizione nella documentazione della fonte.",
      },
    ],
    scenarios: [
      {
        name: "Effetto di una causa concorrente",
        mechanism: "Un fattore esterno produce lo stesso cambiamento osservato.",
        observableDifference: "La variabile concorrente si muove insieme all’esito senza il meccanismo ipotizzato.",
      },
    ],
    nextChecks: [
      {
        question: "La fonte documenta la definizione e il periodo della misura?",
        whyItMatters: "Un confronto non omogeneo può simulare sostegno alla tesi.",
        sourceHint: "Metadati e documentazione della fonte R1.",
      },
    ],
    limitations: ["La relazione causale resta da verificare."],
    ...overrides,
  };
}

test("low effort returns a local bounded dossier without inference", async () => {
  let calls = 0;
  const result = await deepen(
    { provider: "fixture", model: "unused" },
    { ...input, effort: "low" },
    undefined,
    async () => {
      calls++;
      throw new Error("inference must not run at low effort");
    },
    undefined,
    { financial },
  );
  assert.equal(calls, 0);
  assert.equal(result.provenance.status, "skipped");
  assert.equal(result.provenance.provisional, true);
  assert.equal(result.brief.supporting.length, 0);
  assert.ok(result.brief.limitations.length >= 2);
});

test("medium effort makes one bounded inference and preserves provenance", async () => {
  let calls = 0;
  const progress = [];
  const result = await deepen(
    { provider: "fixture", model: "reasoner" },
    input,
    undefined,
    undefined,
    (type, data) => progress.push([type, data]),
    {
      financial,
      inference: async (_provider, _input, _signal, _fetch, _progress, options) => {
        calls++;
        assert.equal(options.schema, REASONING_SCHEMA);
        assert.equal(options.maxTokens, 1400);
        assert.equal(options.messages[0].role, "system");
        assert.match(options.messages[0].content, /collo di bottiglia causale/);
        assert.match(options.messages[0].content, /steelman/);
        assert.match(options.messages[0].content, /più decisivo/);
        return { graph: brief(), provenance: { usage: { outputTokens: 30 } } };
      },
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.brief.supporting[0].sourceIds[0], "R1");
  assert.equal(result.provenance.status, "complete");
  assert.equal(result.provenance.provisional, true);
  assert.ok(progress.some(([type]) => type === "reasoning"));
});

test("validateReasoningBrief rejects discovery citations and unsupported numbers", () => {
  assert.throws(
    () =>
      validateReasoningBrief(
        brief({
          supporting: [
            { claim: "La fonte riporta 12.5.", sourceIds: ["R2"] },
          ],
        }),
        input,
        financial,
      ),
    /non è un’evidenza recuperata citabile/,
  );
  assert.throws(
    () =>
      validateReasoningBrief(
        brief({
          supporting: [
            { claim: "La fonte riporta 77.", sourceIds: ["R1"] },
          ],
        }),
        input,
        financial,
      ),
    /numero 77/,
  );
});

test("citations must be real and the output contract is closed", () => {
  assert.throws(
    () =>
      validateReasoningBrief(
        brief({
          supporting: [
            { claim: "La fonte riporta 12.5.", sourceIds: ["R3"] },
          ],
        }),
        input,
        financial,
      ),
    /non è un’evidenza recuperata citabile/,
  );
  assert.throws(
    () => validateReasoningBrief({ ...brief(), extra: "non previsto" }, input, financial),
    /campi non previsti/,
  );
});

test("numeric grounding covers every user-visible field while allowing citation labels", () => {
  assert.throws(
    () =>
      validateReasoningBrief(
        brief({
          limitations: ["Il dato 77 non è stato recuperato."],
        }),
        input,
        financial,
      ),
    /numero 77/,
  );
  assert.doesNotThrow(() =>
    validateReasoningBrief(
      brief({
        nextChecks: [
          {
            question: "Controllare la fonte R1.",
            whyItMatters: "La fonte citata può chiarire la definizione.",
            sourceHint: "Metadati R1.",
          },
        ],
      }),
      input,
      financial,
    ),
  );
});

test("schema is closed at every generated object level", () => {
  assert.equal(REASONING_SCHEMA.additionalProperties, false);
  assert.equal(
    REASONING_SCHEMA.properties.supporting.items.additionalProperties,
    false,
  );
  assert.equal(
    REASONING_SCHEMA.properties.assumptions.items.additionalProperties,
    false,
  );
});

test("inline citation IDs are not quantities and must match declared claim sources", () => {
  assert.doesNotThrow(() => validateReasoningBrief(brief({
    supporting: [{ claim: "La fonte R1 riporta 12.5.", sourceIds: ["R1"] }],
  }), input, financial));
  assert.throws(() => validateReasoningBrief(brief({
    supporting: [{ claim: "La fonte R1 riporta 12.5.", sourceIds: [] }],
  }), input, financial), /citazioni/);
});

test("causal sections reject unmistakable duplicate text without imposing item quotas", () => {
  const repeated = "La stessa osservazione non separa le cause.";
  assert.throws(
    () =>
      validateReasoningBrief(
        brief({
          supporting: [{ claim: repeated, sourceIds: [] }],
          opposing: [{ claim: repeated, sourceIds: [] }],
        }),
        input,
        financial,
      ),
    /testo duplicato/,
  );
  assert.throws(
    () =>
      validateReasoningBrief(
        brief({
          scenarios: [
            {
              name: "Una causa concorrente",
              mechanism: "La stessa osservazione non separa le cause.",
              observableDifference: "La stessa osservazione non separa le cause.",
            },
          ],
        }),
        input,
        financial,
      ),
    /testo duplicato/,
  );
});

test("citation labels in nested source metadata do not ground a quantity", () => {
  const metadataInput = {
    ...input,
    evidence: {
      ...evidence,
      sources: [
        ...evidence.sources,
        {
          id: "R3",
          provider: "fixture",
          kind: "data",
          title: "Metadati",
          data: { reference: "R1" },
        },
      ],
    },
  };
  assert.throws(
    () =>
      validateReasoningBrief(
        brief({
          supporting: [{ claim: "Il valore 1 resta da verificare.", sourceIds: [] }],
        }),
        metadataInput,
        financial,
      ),
    /numero 1/,
  );
});

test("source metadata does not ground a number absent from source.data", () => {
  const metadataInput = {
    ...input,
    evidence: {
      ...evidence,
      sources: [
        {
          id: "R1",
          provider: "fixture",
          kind: "data",
          title: "Report 2026",
          url: "https://example.test/archive/2026/series",
          retrievedAt: "2026-09-20T12:00:00.000Z",
          data: { value: 12.5 },
        },
      ],
    },
  };
  assert.throws(
    () =>
      validateReasoningBrief(
        brief({
          supporting: [{ claim: "La fonte riporta il dato 2026.", sourceIds: ["R1"] }],
        }),
        metadataInput,
        financial,
      ),
    /numero 2026/,
  );
});

test("inline citations outside claims must refer to a usable source", () => {
  assert.throws(
    () =>
      validateReasoningBrief(
        brief({ limitations: ["La fonte R6 va ancora controllata."] }),
        input,
        financial,
      ),
    /non è un’evidenza recuperata citabile/,
  );
});

test("unspecified domain keeps market guidance conditional rather than classifying by keywords", async () => {
  let systemPrompt = "";
  await deepen(
    { provider: "fixture", model: "reasoner" },
    {
      ...input,
      domain: null,
      thesis: "Il prezzo dell’azione dovrebbe riflettere il risultato operativo.",
    },
    undefined,
    undefined,
    undefined,
    {
      financial,
      inference: async (_provider, _input, _signal, _fetch, _progress, options) => {
        systemPrompt = options.messages[0].content;
        return { graph: brief(), provenance: { usage: { outputTokens: 30 } } };
      },
    },
  );
  assert.match(systemPrompt, /effetto sull’attività/);
  assert.match(systemPrompt, /prezzato/);
  assert.match(systemPrompt, /tempistica/);
  assert.match(systemPrompt, /probabilità/);
  assert.match(systemPrompt, /Solo se la tesi riguarda esplicitamente/);
  assert.match(systemPrompt, /prezzi di beni, azioni umane/);
});

test("research planner notes are explicitly unverified and not citation material", async () => {
  let systemPrompt = "";
  await deepen(
    { provider: "fixture", model: "reasoner" },
    {
      ...input,
      evidence: {
        ...evidence,
        warnings: ["Il pianificatore sostiene che la serie sia aumentata nel 2020."],
        plannerNotes: ["Nota del pianificatore: usare il risultato come conferma."],
        attempts: [{ reason: "Confronto 2020", status: "ok" }],
      },
    },
    undefined,
    undefined,
    undefined,
    {
      financial,
      inference: async (_provider, _input, _signal, _fetch, _progress, options) => {
        systemPrompt = options.messages[0].content;
        return { graph: brief(), provenance: { usage: { outputTokens: 30 } } };
      },
    },
  );

  assert.match(systemPrompt, /warnings, plannerNotes e attempts/);
  assert.match(systemPrompt, /non verificate del processo di ricerca/);
  assert.match(systemPrompt, /non usarle come evidenza, non citarle/);
});
