import { requireThat } from "./domain.js";
const fields = [
  "price",
  "quantity",
  "variableCost",
  "fixedCost",
  "discountPercent",
  "newQuantity",
  "gmv",
  "marketplacePercent",
  "commissionPercent",
  "reportedEps",
  "consensusEps",
  "guidanceEps",
  "consensusGuidance",
  "modifiedDuration",
  "yieldChangeBp",
];
export const SCENARIO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "currency", "values"],
  properties: {
    kind: {
      type: "string",
      enum: ["generic", "pricing", "marketplace", "earnings", "bond"],
    },
    currency: { type: "string" },
    values: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "value", "sourceQuote"],
        properties: {
          key: { type: "string", enum: fields },
          value: { type: "number" },
          sourceQuote: { type: "string" },
        },
      },
    },
  },
};
export function readScenario(raw, thesis) {
  requireThat(
    raw &&
      SCENARIO_SCHEMA.properties.kind.enum.includes(raw.kind) &&
      Array.isArray(raw.values) &&
      raw.values.length <= 8 &&
      typeof raw.currency === "string",
    "Scenario estratto non valido.",
    422,
  );
  const values = {},
    sources = {};
  for (const item of raw.values) {
    requireThat(
      item &&
        fields.includes(item.key) &&
        !Object.hasOwn(values, item.key) &&
        Number.isFinite(item.value) &&
        typeof item.sourceQuote === "string" &&
        item.sourceQuote.trim().length > 0 &&
        thesis.includes(item.sourceQuote),
      "Un dato estratto non corrisponde al testo fornito.",
      422,
    );
    const numericTokens = item.sourceQuote.match(/\d+(?:[.,]\d+)*/g) || [];
    const candidates = numericTokens.flatMap((token) => {
      const direct = Number(token.replace(",", "."));
      const grouped = /^\d{1,3}(?:[.,]\d{3})+$/.test(token)
        ? Number(token.replace(/[.,]/g, ""))
        : direct;
      const scale = /milion/i.test(item.sourceQuote)
        ? 1e6
        : /miliard/i.test(item.sourceQuote)
          ? 1e9
          : 1;
      return scale === 1
        ? [direct, grouped]
        : [direct * scale, grouped * scale];
    });
    requireThat(
      candidates.some((n) => Math.abs(n - Math.abs(item.value)) < 1e-9),
      "Valore numerico non rintracciabile nella citazione fornita.",
      422,
    );
    if (item.key === "yieldChangeBp")
      requireThat(
        /rendimento|yield/i.test(item.sourceQuote),
        "La variazione deve citare il rendimento del titolo, non soltanto il tasso ufficiale.",
        422,
      );
    values[item.key] = item.value;
    sources[item.key] = item.sourceQuote;
  }
  return { kind: raw.kind, currency: raw.currency, values, sources };
}

export function scenarioGraph(input, scenario, computed) {
  const node = (id, kind, label, assumption, challenge, falsifier) => ({
    id,
    kind,
    label,
    assumptions: [assumption],
    challenge,
    falsifier,
    evidenceNeeded: [
      "Verificare che i dati dello scenario corrispondano a misure osservate, nello stesso periodo e perimetro.",
    ],
  });
  const nodes = [
    node(
      "n0",
      "thesis",
      input.thesis.slice(0, 490),
      "I numeri forniti descrivono lo scenario da analizzare.",
      computed.focus.why,
      "La conclusione non segue dai dati o dalle condizioni dichiarate.",
    ),
  ];
  const calculations = computed.calculations.slice(0, 2);
  calculations.forEach((c, i) =>
    nodes.push(
      node(
        `n${i + 1}`,
        "consequence",
        `${c.label}: ${new Intl.NumberFormat("it-IT", { maximumSignificantDigits: 8 }).format(c.result)} ${c.unit}`,
        c.basis,
        "Questo calcolo vale alle condizioni dichiarate, non dimostra che lo scenario si realizzerà.",
        "Dati di ingresso o condizioni della formula diversi da quelli dichiarati.",
      ),
    ),
  );
  const a = computed.alternative;
  nodes.push(
    node(
      `n${nodes.length}`,
      "alternative",
      a.label,
      a.assumption,
      a.challenge,
      a.falsifier,
    ),
  );
  return {
    focus: computed.focus,
    financial: {
      conclusion: computed.conclusion,
      limitation: computed.limitations,
      calculations: computed.calculations.map(
        ({ label, expression, unit, basis }) => ({
          label,
          expression,
          unit,
          basis,
        }),
      ),
    },
    title: "Verifica dello scenario finanziario",
    summary: computed.conclusion,
    interpretation: {
      domain: ["earnings", "bond"].includes(scenario.kind)
        ? "trading"
        : "general",
      deadline: null,
      horizon: "Periodo dichiarato nel testo; nessuna scadenza aggiunta",
      context:
        "Calcolo condizionale sui dati forniti, non dati di mercato verificati.",
      missing: [],
    },
    nodes,
    edges: nodes.slice(1).map((n) => ({
      from: "n0",
      to: n.id,
      mechanism:
        n.kind === "alternative"
          ? "Questa condizione cambia la validità della conclusione dello scenario."
          : "Applicazione delle formule dello scenario ai dati forniti.",
    })),
    uncertainties: [computed.limitations],
    trading: {
      instruments: [],
      catalysts: [],
      pricedIn:
        "Non sono disponibili dati sulle aspettative incorporate nel prezzo.",
      invalidation: computed.focus.test,
      timingRisks: [],
      marketVsThesis:
        "Un risultato contabile o matematico non dimostra un rendimento di mercato.",
    },
  };
}
