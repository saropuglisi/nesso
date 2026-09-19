import { AppError, requireThat } from "./domain.js";

// Emit only complete JSON objects in the top-level nodes and edges arrays.
// Strings (including escaped quotes/braces) never affect nesting.
export function graphIncremental(onItem) {
  let source = "",
    offset = 0,
    quoted = false,
    escaped = false;
  const stack = [];
  return (delta) => {
    source += delta;
    requireThat(
      source.length <= 200000,
      "Risposta del modello troppo grande.",
      422,
    );
    for (; offset < source.length; offset++) {
      const c = source[offset];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') quoted = false;
        continue;
      }
      if (c === '"') {
        quoted = true;
        continue;
      }
      if (c === "{" || c === "[") {
        const parent = stack.at(-1);
        const key =
          c === "[" && stack.length === 1
            ? source.slice(0, offset).match(/"(nodes|edges)"\s*:\s*$/)?.[1]
            : undefined;
        stack.push({
          char: c,
          start: offset,
          key,
          item: c === "{" ? parent?.key : undefined,
        });
      } else if (c === "}" || c === "]") {
        const entry = stack.pop();
        if (entry?.item) {
          try {
            onItem(
              entry.item === "nodes" ? "node" : "edge",
              JSON.parse(source.slice(entry.start, offset + 1)),
            );
          } catch (e) {
            if (e instanceof SyntaxError)
              throw new AppError("JSON parziale non valido.", 422);
            throw e;
          }
        }
      }
    }
  };
}

export async function readProviderStream(response, provider, onItem) {
  requireThat(response.body, "Stream del provider assente.", 502);
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  const appendGraph = graphIncremental(onItem);
  let buffer = "",
    data = [],
    content = "",
    finished = false,
    usage = null,
    wireBytes = 0;
  const accept = (payload) => {
    if (payload === "[DONE]") return;
    let frame;
    try {
      frame = JSON.parse(payload);
    } catch {
      throw new AppError("Stream del provider non leggibile.", 502);
    }
    requireThat(
      frame &&
        !frame.error &&
        !["error", "response.failed", "response.incomplete"].includes(
          frame.type,
        ),
      "Il provider ha interrotto la generazione.",
      502,
    );
    let delta = "";
    if (provider === "ollama") {
      delta = frame.message?.content || "";
      if (frame.done) {
        requireThat(
          frame.done_reason !== "length",
          "Il modello ha esaurito il budget.",
          422,
        );
        finished = true;
        usage = {
          inputTokens: frame.prompt_eval_count ?? null,
          outputTokens: frame.eval_count ?? null,
        };
      }
    } else if (provider === "openai") {
      requireThat(
        !frame.type?.includes("refusal"),
        "Il modello ha rifiutato l’analisi.",
        422,
      );
      if (frame.type === "response.output_text.delta") delta = frame.delta;
      if (frame.type === "response.completed") {
        finished = frame.response?.status === "completed";
        usage = frame.response?.usage;
      }
    } else {
      const choice = frame.choices?.[0];
      requireThat(
        !choice?.delta?.refusal,
        "Il modello ha rifiutato l’analisi.",
        422,
      );
      delta = choice?.delta?.content || "";
      if (choice?.finish_reason) {
        requireThat(
          choice.finish_reason === "stop",
          "Risposta incompleta: budget esaurito o generazione interrotta.",
          422,
        );
        finished = true;
      }
      usage = frame.usage || usage;
    }
    requireThat(
      typeof delta === "string",
      "Contenuto dello stream non valido.",
      502,
    );
    if (delta) {
      content += delta;
      appendGraph(delta);
    }
  };
  const line = (value) => {
    if (provider === "ollama") {
      if (value.trim()) accept(value);
      return;
    }
    if (!value) {
      if (data.length) accept(data.join("\n"));
      data = [];
    } else if (value.startsWith("data:"))
      data.push(value.slice(5).replace(/^ /, ""));
  };
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      wireBytes += next.value.length;
      requireThat(
        wireBytes <= 8000000,
        "Stream del provider troppo grande.",
        422,
      );
      buffer += decoder.decode(next.value, { stream: true });
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        line(buffer.slice(0, end).replace(/\r$/, ""));
        buffer = buffer.slice(end + 1);
      }
    }
    buffer += decoder.decode();
    if (buffer) line(buffer.replace(/\r$/, ""));
    if (data.length) accept(data.join("\n"));
    requireThat(
      finished,
      "Connessione interrotta prima della fine: mappa non salvata.",
      502,
    );
    return { content, usage };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
