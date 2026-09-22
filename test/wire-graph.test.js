import test from "node:test";
import assert from "node:assert/strict";
import { GRAPH_SCHEMA } from "../server/domain.js";
import { compileWire, wireProgress, wireSchema } from "../server/wire-graph.js";

function wireMap() {
  return {
    title: "Mappa",
    nodes: [
      {
        id: "spoofed-root",
        kind: "thesis",
        label: "Radice",
        parentIndex: null,
        mechanism: "",
      },
      {
        kind: "consequence",
        label: "Conseguenza",
        parentIndex: 0,
        mechanism: "Il meccanismo collega i nodi.",
      },
      {
        kind: "alternative",
        label: "Alternativa",
        parentIndex: 1,
        mechanism: "Un secondo passaggio rende esplicita la condizione.",
      },
    ],
  };
}

test("wireSchema clones the schema and derives parent-indexed nodes", () => {
  const schema = wireSchema(GRAPH_SCHEMA);
  const node = schema.properties.nodes.items;

  assert.notStrictEqual(schema, GRAPH_SCHEMA);
  assert.equal(schema.properties.edges, undefined);
  assert.equal(schema.required.includes("edges"), false);
  assert.equal(node.properties.id, undefined);
  assert.deepEqual(node.properties.parentIndex.type, ["integer", "null"]);
  assert.equal(node.properties.parentIndex.minimum, 0);
  assert.match(node.properties.parentIndex.description, /NON profondità/);
  assert.deepEqual(node.properties.mechanism, { type: "string" });
  assert.equal(node.required.includes("id"), false);
  assert.ok(node.required.includes("parentIndex"));
  assert.ok(node.required.includes("mechanism"));
  assert.ok(GRAPH_SCHEMA.properties.edges);
  assert.ok(GRAPH_SCHEMA.properties.nodes.items.properties.id);
  assert.ok(GRAPH_SCHEMA.required.includes("edges"));
});

test("typed relations survive both compilation and streaming without leaking onto nodes", () => {
  const raw = wireMap();
  raw.nodes[0].relation = null;
  raw.nodes[1].relation = "requires";
  raw.nodes[2].relation = "challenges";
  const compiled = compileWire(raw);
  assert.deepEqual(compiled.edges.map((e) => e.relation), ["requires", "challenges"]);
  assert.ok(compiled.nodes.every((n) => !Object.hasOwn(n, "relation")));
  const events = [];
  const emit = wireProgress((type, data) => events.push({ type, data }));
  raw.nodes.forEach((n) => emit("node", n));
  assert.deepEqual(events.filter((e) => e.type === "edge").map((e) => e.data), compiled.edges);
  raw.nodes[1].relation = "invented";
  assert.throws(() => compileWire(raw), /Relazione/);
});

test("compileWire assigns canonical IDs and derives only declared parent edges", () => {
  const raw = wireMap();
  const before = structuredClone(raw);
  const compiled = compileWire(raw);

  assert.deepEqual(
    compiled.nodes.map(({ id, parentIndex, mechanism, ...node }) => node),
    [
      { kind: "thesis", label: "Radice" },
      { kind: "consequence", label: "Conseguenza" },
      { kind: "alternative", label: "Alternativa" },
    ],
  );
  assert.deepEqual(
    compiled.nodes.map((node) => node.id),
    ["n0", "n1", "n2"],
  );
  assert.deepEqual(compiled.edges, [
    { from: "n0", to: "n1", mechanism: "Il meccanismo collega i nodi." },
    {
      from: "n1",
      to: "n2",
      mechanism: "Un secondo passaggio rende esplicita la condizione.",
    },
  ]);
  assert.deepEqual(raw, before);
});

test("compileWire rejects invalid roots, parents, mechanisms and invented edges", () => {
  const invalid = [
    (raw) => (raw.nodes[0].kind = "consequence"),
    (raw) => (raw.nodes[0].parentIndex = 0),
    (raw) => (raw.nodes[1].parentIndex = null),
    (raw) => (raw.nodes[1].parentIndex = 1),
    (raw) => (raw.nodes[1].parentIndex = 1.5),
    (raw) => (raw.nodes[1].parentIndex = -1),
    (raw) => (raw.nodes[1].mechanism = "  "),
    (raw) => (raw.nodes[2].kind = "thesis"),
    (raw) => (raw.edges = []),
  ];
  for (const mutate of invalid) {
    const raw = wireMap();
    mutate(raw);
    assert.throws(
      () => compileWire(raw),
      (error) => error instanceof Error && error.status === 422,
    );
  }
  for (const raw of [null, {}, { nodes: [] }, { nodes: [null] }]) {
    assert.throws(
      () => compileWire(raw),
      (error) => error instanceof Error && error.status === 422,
    );
  }
});

test("wireProgress passes other events through and emits canonical nodes then edges", () => {
  const events = [];
  const emit = wireProgress((type, data) => events.push({ type, data }));
  const focus = { claim: "focus" };
  emit("focus", focus);
  emit("node", wireMap().nodes[0]);
  emit("node", wireMap().nodes[1]);
  emit("complete", { id: "analysis" });

  assert.strictEqual(events[0].data, focus);
  assert.deepEqual(
    events.map(({ type }) => type),
    ["focus", "node", "node", "edge", "complete"],
  );
  assert.deepEqual(events[1].data, {
    id: "n0",
    kind: "thesis",
    label: "Radice",
  });
  assert.deepEqual(events[2].data, {
    id: "n1",
    kind: "consequence",
    label: "Conseguenza",
  });
  assert.deepEqual(events[3].data, {
    from: "n0",
    to: "n1",
    mechanism: "Il meccanismo collega i nodi.",
  });
});

test("wireProgress validates nodes before forwarding them", () => {
  const events = [];
  const emit = wireProgress((type, data) => events.push({ type, data }));
  assert.throws(
    () => emit("node", { kind: "thesis", parentIndex: null }),
    (error) => error instanceof Error && error.status === 422,
  );
  assert.deepEqual(events, []);
});
