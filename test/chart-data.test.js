import test from "node:test";
import assert from "node:assert/strict";
import { buildCharts } from "../server/chart-data.js";

function fredSource({
  id = "R1",
  observations = [
    { date: "2024-01-01", value: 1 },
    { date: "2024-02-01", value: 2 },
  ],
  ...data
} = {}) {
  return {
    id,
    provider: "fred",
    kind: "data",
    title: "Example FRED series",
    data: {
      id: "EXAMPLE",
      units: "Percent",
      frequency: "Monthly",
      seasonalAdjustment: "Seasonally Adjusted",
      lastUpdated: "2024-03-01",
      caveat: "Vintage corrente, soggetta a revisioni.",
      observations,
      ...data,
    },
  };
}

function secSource({ id = "R1", units, title = "Example · Revenue", ...data } = {}) {
  return {
    id,
    provider: "sec",
    kind: "data",
    title,
    data: {
      tag: "Revenues",
      caveat: "Campione XBRL, non serie completa.",
      units,
      ...data,
    },
  };
}

const annualRows = [
  { start: "2022-01-01", end: "2022-12-31", filed: "2023-02-01", val: 10 },
  { start: "2023-01-01", end: "2023-12-31", filed: "2024-02-01", val: 12 },
];

test("FRED preserves a null gap, orders dates, and keeps source metadata in notes", () => {
  const result = buildCharts({ sources: [fredSource({ observations: [
    { date: "2024-03-01", value: 3 },
    { date: "2024-02-01", value: null },
    { date: "2024-01-01", value: 1 },
  ] })] });
  assert.equal(result.version, "nesso-charts-v1");
  assert.deepEqual(result.items[0].points, [
    { label: "2024-01-01", value: 1 },
    { label: "2024-02-01", value: null },
    { label: "2024-03-01", value: 3 },
  ]);
  assert.equal(result.items[0].sourceIds[0], "R1");
  assert.ok(result.items[0].notes.some((note) => note.includes("Aggiustamento stagionale")));
  assert.ok(result.items[0].notes.some((note) => note.includes("Ultimo aggiornamento")));
  assert.ok(result.items[0].notes.some((note) => note.includes("Nota della fonte")));
  assert.ok(result.items[0].notes.some((note) => note.includes("mantenuti come null")));
});

test("World Bank carries the indicator definition and unit placeholder into notes", () => {
  const result = buildCharts({ sources: [{
    id: "R1",
    provider: "worldbank",
    kind: "data",
    title: "Indicator · ITA",
    data: {
      country: "ITA",
      indicator: "EXAMPLE",
      name: "Example indicator",
      unit: "Vedi definizione dell’indicatore",
      frequency: "annual",
      definition: "A documented indicator definition.",
      observations: [
        { date: "2022", value: 1 },
        { date: "2023", value: 2 },
      ],
    },
  }] });
  assert.equal(result.items.length, 1);
  assert.ok(result.items[0].notes.some((note) => note.includes("Definizione World Bank")));
  assert.ok(result.items[0].notes.some((note) => note.includes("placeholder")));
});

test("the point cap keeps the latest 120 points and eligibility counts only that window", () => {
  const observations = Array.from({ length: 125 }, (_, index) => ({
    date: `${2000 + index}-01-01`,
    value: index,
  }));
  const chart = buildCharts({ sources: [fredSource({ observations })] }).items[0];
  assert.equal(chart.points.length, 120);
  assert.equal(chart.points[0].label, "2005-01-01");
  assert.equal(chart.points.at(-1).label, "2124-01-01");
  assert.ok(chart.notes.some((note) => note.includes("ultimi 120")));

  const trailingMissing = Array.from({ length: 121 }, (_, index) => ({
    date: `${1900 + index}-01-01`,
    value: index < 2 ? index + 1 : null,
  }));
  assert.deepEqual(buildCharts({ sources: [fredSource({ observations: trailingMissing })] }).items, []);
});

test("SEC keeps units and period frequencies separate, including quarterly and annual series", () => {
  const quarterlyRows = [
    { start: "2023-01-01", end: "2023-03-31", filed: "2023-05-01", val: 3 },
    { start: "2024-01-01", end: "2024-03-31", filed: "2024-05-01", val: 4 },
  ];
  const result = buildCharts({ sources: [secSource({ units: {
    USD: [...annualRows, ...quarterlyRows],
    shares: annualRows.map((row) => ({ ...row, val: row.val * 10 })),
  } })] });
  assert.equal(result.items.length, 3);
  assert.deepEqual(result.items.map((item) => [item.unit, item.frequency]), [
    ["USD", "annual"],
    ["USD", "quarterly"],
    ["shares", "annual"],
  ]);
  assert.ok(result.items.every((item) => item.sourceIds[0] === "R1"));
});

test("SEC chooses the latest filing only for an identical start/end period", () => {
  const rows = [
    { start: "2022-01-01", end: "2022-12-31", filed: "2023-02-01", val: 10 },
    { start: "2022-01-01", end: "2022-12-31", filed: "2023-03-01", val: 11 },
    { start: "2023-01-01", end: "2023-12-31", filed: "2024-02-01", val: 12 },
  ];
  const chart = buildCharts({ sources: [secSource({ units: { USD: rows } })] }).items[0];
  assert.deepEqual(chart.points, [
    { label: "2022-12-31", value: 11 },
    { label: "2023-12-31", value: 12 },
  ]);
  assert.ok(chart.notes.some((note) => note.includes("revisione")));
});

test("SEC preserves an explicit null value and does not invent filing order", () => {
  const rows = [
    { start: "2022-01-01", end: "2022-12-31", filed: "2023-02-01", val: null, value: 999 },
    { start: "2023-01-01", end: "2023-12-31", val: 12 },
    { start: "2023-01-01", end: "2023-12-31", val: 13 },
    { start: "2024-01-01", end: "2024-12-31", val: 14 },
  ];
  const chart = buildCharts({ sources: [secSource({ units: { USD: rows } })] }).items[0];
  assert.deepEqual(chart.points, [
    { label: "2022-12-31", value: null },
    { label: "2023-12-31", value: 12 },
    { label: "2024-12-31", value: 14 },
  ]);
});

test("invalid year-zero dates are ignored", () => {
  const chart = buildCharts({ sources: [fredSource({ observations: [
    { date: "0000-01-01", value: 999 },
    { date: "0000", value: 998 },
    { date: "2024-01-01", value: 1 },
    { date: "2024-02-01", value: 2 },
  ] })] }).items[0];
  assert.deepEqual(chart.points, [
    { label: "2024-01-01", value: 1 },
    { label: "2024-02-01", value: 2 },
  ]);
});

test("SEC drops ambiguous starts and durations outside conservative frequency bands", () => {
  const rows = [
    { start: "2022-01-01", end: "2022-12-31", filed: "2023-02-01", val: 10 },
    { start: "2023-01-01", end: "2023-12-31", filed: "2024-02-01", val: 12 },
    { start: "2024-01-01", end: "2024-12-31", filed: "2025-02-01", val: 14 },
    { start: "2024-01-15", end: "2024-12-31", filed: "2025-03-01", val: 15 },
    { start: "2021-01-01", end: "2021-05-21", filed: "2022-02-01", val: 9 },
  ];
  const result = buildCharts({ sources: [secSource({ units: { USD: rows } })] });
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0].points.map((point) => point.label), ["2022-12-31", "2023-12-31"]);
  assert.ok(result.items[0].notes.some((note) => note.includes("start diversi")));

  const outlierRows = [
    { start: "2022-01-16", end: "2022-12-31", filed: "2023-02-01", val: 1 },
    { start: "2023-01-16", end: "2023-12-31", filed: "2024-02-01", val: 2 },
    { start: "2024-01-17", end: "2024-12-31", filed: "2025-02-01", val: 3 },
    { start: "2024-12-17", end: "2025-12-31", filed: "2026-02-01", val: 4 },
  ];
  const outlierResult = buildCharts({ sources: [secSource({ units: { USD: outlierRows } })] });
  assert.equal(outlierResult.items.length, 1);
  assert.ok(outlierResult.items[0].notes.some((note) => note.includes("durata fuori")));

  const rows140Day = [
    { start: "2024-01-01", end: "2024-05-19", filed: "2024-06-01", val: 1 },
    { start: "2023-01-01", end: "2023-05-20", filed: "2023-06-01", val: 2 },
  ];
  assert.deepEqual(buildCharts({ sources: [secSource({ units: { USD: rows140Day } })] }).items, []);
});

test("insufficient, discovery, insider, and non-series sources do not produce charts", () => {
  const discovery = { ...fredSource({ id: "R1" }), kind: "discovery" };
  const insufficient = fredSource({ id: "R2", observations: [{ date: "2024-01-01", value: 1 }] });
  const insider = {
    id: "R3",
    provider: "sec",
    kind: "document",
    title: "Form 4",
    data: { transactions: [{ date: "2024-01-01", shares: 10, pricePerShare: 2 }] },
  };
  assert.deepEqual(buildCharts({ sources: [discovery, insufficient, insider] }).items, []);
  assert.deepEqual(buildCharts({ sources: [] }), { version: "nesso-charts-v1", items: [] });
  assert.deepEqual(buildCharts(null), { version: "nesso-charts-v1", items: [] });
});

test("ambiguous duplicate source IDs are excluded rather than misattributed", () => {
  const first = fredSource({ id: "R1", observations: [
    { date: "2024-01-01", value: 1 },
    { date: "2024-02-01", value: 2 },
  ] });
  const second = fredSource({ id: "R1", observations: [
    { date: "2024-01-01", value: 10 },
    { date: "2024-02-01", value: 20 },
  ] });
  const result = buildCharts({ sources: [first, second] });
  assert.deepEqual(result.items, []);
});
