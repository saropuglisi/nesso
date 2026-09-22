import { AppError, GRAPH_SCHEMA, RELATIONS, requireThat } from "./domain.js";

function clone(value) {
  try {
    return structuredClone(value);
  } catch {
    throw new AppError("Schema o mappa wire non validi.", 422);
  }
}

function invalid(message) {
  throw new AppError(message, 422);
}

function assertNode(node, index) {
  requireThat(
    node && typeof node === "object" && !Array.isArray(node),
    `Nodo wire ${index} non valido.`,
    422,
  );
  requireThat(
    typeof node.kind === "string",
    `Tipo del nodo wire ${index} non valido.`,
    422,
  );
  requireThat(
    typeof node.mechanism === "string",
    `Meccanismo del nodo wire ${index} non valido.`,
    422,
  );
}

function validateWireNode(node, index) {
  assertNode(node, index);
  if (Object.hasOwn(node, "relation"))
    requireThat(index === 0 ? node.relation === null : RELATIONS.includes(node.relation), "Relazione wire non valida.", 422);
  if (index === 0) {
    requireThat(
      node.kind === "thesis" && node.parentIndex === null,
      "Il primo nodo wire deve essere l’unica radice thesis con parentIndex null.",
      422,
    );
    return;
  }
  requireThat(
    node.kind !== "thesis",
    "La mappa wire può avere una sola radice thesis.",
    422,
  );
  requireThat(
    Number.isInteger(node.parentIndex) &&
      node.parentIndex >= 0 &&
      node.parentIndex < index,
    `parentIndex non valido per il nodo wire ${index}: deve essere un intero tra 0 e ${index - 1}, cioè la posizione di un nodo già scritto; non il livello e non il nodo stesso.`,
    422,
  );
  requireThat(
    node.mechanism.trim().length > 0,
    `Meccanismo obbligatorio per il nodo wire ${index}.`,
    422,
  );
}

function canonicalNode(node, index) {
  const {
    id: _id,
    parentIndex: _parentIndex,
    mechanism: _mechanism,
    relation: _relation,
    ...rest
  } = node;
  return { id: `n${index}`, ...rest };
}

export function wireSchema(schema = GRAPH_SCHEMA) {
  const result = clone(schema);
  requireThat(
    result && typeof result === "object" && !Array.isArray(result),
    "Schema wire non valido.",
    422,
  );
  requireThat(
    result.properties?.nodes?.items &&
      typeof result.properties.nodes.items === "object",
    "Schema wire senza nodi.",
    422,
  );

  delete result.properties.edges;
  if (Array.isArray(result.required))
    result.required = result.required.filter((key) => key !== "edges");

  const nodeSchema = result.properties.nodes.items;
  if (!nodeSchema.properties || typeof nodeSchema.properties !== "object")
    invalid("Schema wire dei nodi non valido.");
  delete nodeSchema.properties.id;
  nodeSchema.properties.parentIndex = {
    type: ["integer", "null"],
    minimum: 0,
    description: "Posizione del genitore nell’array nodes, contando da zero, NON profondità. Solo la radice usa null; ogni figlio indica un nodo già scritto. Il nodo in posizione 1 può usare solo 0; quello in posizione 2 può usare 0 o 1, mai 2.",
  };
  nodeSchema.properties.mechanism = { type: "string" };
  nodeSchema.properties.relation = { type: ["string", "null"], enum: [...RELATIONS, null] };
  const required = Array.isArray(nodeSchema.required)
    ? nodeSchema.required.filter(
        (key) => key !== "id" && key !== "parentIndex" && key !== "mechanism",
      )
    : [];
  nodeSchema.required = [...new Set([...required, "parentIndex", "mechanism", "relation"])];
  return result;
}

export function compileWire(raw) {
  requireThat(
    raw && typeof raw === "object" && !Array.isArray(raw),
    "Mappa wire non valida.",
    422,
  );
  requireThat(
    !Object.hasOwn(raw, "edges"),
    "Gli archi wire sono derivati dai parentIndex.",
    422,
  );
  requireThat(
    Array.isArray(raw.nodes) && raw.nodes.length > 0,
    "Nodi wire mancanti.",
    422,
  );

  const result = clone(raw);
  const nodes = result.nodes.map((node, index) => {
    validateWireNode(node, index);
    return canonicalNode(node, index);
  });
  const edges = result.nodes.slice(1).map((node, index) => ({
    from: `n${node.parentIndex}`,
    to: `n${index + 1}`,
    mechanism: node.mechanism,
    ...(node.relation ? { relation: node.relation } : {}),
  }));
  result.nodes = nodes;
  result.edges = edges;
  return result;
}

export function wireProgress(onProgress) {
  requireThat(
    typeof onProgress === "function",
    "Callback di progress non valido.",
    422,
  );
  let nodeCount = 0;
  return (type, data) => {
    if (type !== "node") return onProgress(type, data);
    validateWireNode(data, nodeCount);
    const index = nodeCount++;
    onProgress("node", canonicalNode(data, index));
    if (index > 0)
      onProgress("edge", {
        from: `n${data.parentIndex}`,
        to: `n${index}`,
        mechanism: data.mechanism,
        ...(data.relation ? { relation: data.relation } : {}),
      });
  };
}
