import test from "node:test";
import assert from "node:assert/strict";
import { config, requestFor, infer, publicConfig } from "../server/provider.js";
import { input, graph } from "./fixtures.js";

test("provider mapping keeps a single contract and secrets server-side", () => {
  for (const provider of ["ollama", "openai-compatible", "openai"]) {
    const c = config({
        NESSO_PROVIDER: provider,
        NESSO_MODEL: "test-model",
        NESSO_API_KEY: "test-secret",
      }),
      req = requestFor(c, input);
    assert.equal(req.body.model, "test-model");
    assert.equal(
      JSON.stringify(publicConfig(c)).includes("test-secret"),
      false,
    );
    if (provider === "ollama") assert.ok(req.body.format.properties.nodes);
    if (provider === "openai") {
      assert.equal(req.body.store, false);
      assert.equal(req.body.text.format.type, "json_schema");
    }
    if (provider === "openai-compatible")
      assert.equal(req.body.response_format.json_schema.strict, true);
  }
});
test("refuse insecure remote and credential-bearing base URLs", () => {
  for (const base of [
    "http://example.com/v1",
    "https://key:secret@example.com/v1",
    "https://example.com/v1?key=x",
  ])
    assert.throws(() =>
      config({ NESSO_PROVIDER: "openai-compatible", NESSO_BASE_URL: base }),
    );
});
test("OpenRouter routes only to compatible providers without fallback", () => {
  const c = config({
    NESSO_PROVIDER: "openai-compatible",
    NESSO_BASE_URL: "https://openrouter.ai/api/v1",
    NESSO_MODEL: "vendor/model",
    NESSO_API_KEY: "secret",
  });
  assert.deepEqual(requestFor(c, input).body.provider, {
    require_parameters: true,
    allow_fallbacks: false,
  });
});
test("API and local response parsing, truncation, refusal and errors", async () => {
  for (const p of ["ollama", "openai-compatible", "openai"]) {
    const c = config({
      NESSO_PROVIDER: p,
      NESSO_MODEL: "test",
      NESSO_API_KEY: "secret",
    });
    const payload =
      p === "ollama"
        ? { done: true, message: { content: JSON.stringify(graph()) } }
        : p === "openai"
          ? {
              status: "completed",
              output: [
                {
                  content: [
                    { type: "output_text", text: JSON.stringify(graph()) },
                  ],
                },
              ],
            }
          : {
              choices: [
                {
                  finish_reason: "stop",
                  message: { content: JSON.stringify(graph()) },
                },
              ],
            };
    const r = await infer(c, input, undefined, async (url, opts) => {
      assert.equal(opts.redirect, "error");
      assert.equal(opts.headers.authorization, "Bearer secret");
      return Response.json(payload);
    });
    assert.equal(r.graph.title, graph().title);
    assert.ok(r.provenance.schemaHash);
  }
  const c = config({ NESSO_MODEL: "test" });
  await assert.rejects(
    () =>
      infer(c, input, undefined, async () =>
        Response.json({
          done: true,
          done_reason: "length",
          message: { content: "{}" },
        }),
      ),
    /budget/,
  );
  await assert.rejects(
    () =>
      infer(c, input, undefined, async () =>
        Response.json({ done: true, message: { content: "not json" } }),
      ),
    /JSON/,
  );
  await assert.rejects(
    () =>
      infer(c, input, undefined, async () =>
        Response.json({ error: "secret" }, { status: 401 }),
      ),
    (e) => !e.message.includes("secret") && e.message.includes("401"),
  );
});
test("missing model or remote key never issues a network call", async () => {
  let calls = 0;
  const failFetch = async () => {
    calls++;
    throw new Error("must not call");
  };
  await assert.rejects(
    () => infer(config({}), input, undefined, failFetch),
    /NESSO_MODEL/,
  );
  await assert.rejects(
    () =>
      infer(
        config({
          NESSO_PROVIDER: "openai-compatible",
          NESSO_BASE_URL: "https://openrouter.ai/api/v1",
          NESSO_MODEL: "vendor/model",
        }),
        input,
        undefined,
        failFetch,
      ),
    /NESSO_API_KEY/,
  );
  assert.equal(calls, 0);
});
