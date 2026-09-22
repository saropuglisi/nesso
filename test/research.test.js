import test from "node:test";
import assert from "node:assert/strict";
import { research } from "../server/research.js";
const input = { thesis: "La disoccupazione in Italia sta aumentando", effort: "low", context: "", referenceDate: "2026-09-20" };
const call = { tool: "wb_series", query: "", identifier: "ITA", metric: "SL.UEM.TOTL.ZS", reason: "Controllare l'andamento annuale" };
const data = { provider: "worldbank", title: "Test", url: "https://api.worldbank.org/v2/test", retrievedAt: "2026-09-20", kind: "data", data: { value: 5.5 } };

test("research plans on demand, observes results and stops without archiving", async () => {
  let plans = 0, calls = 0;
  const events = [];
  const r = await research({}, input, undefined, (type) => events.push(type), {
    config: {}, client: { tools: [], run: async () => { calls++; return structuredClone(data); } },
    inference: async (_p, _i, _s, _f, _o, opts) => {
      plans++;
      if (plans === 2) assert.equal(JSON.parse(opts.messages.find((message) => message.role === "user").content).sources[0].id, "R1");
      return { graph: { calls: plans === 1 ? [call] : [], limitation: "" } };
    },
  });
  assert.equal(plans, 2);
  assert.equal(calls, 1);
  assert.equal(r.status, "collected");
  assert.equal(r.sources[0].id, "R1");
  assert.deepEqual(r.completion, { reason: "planner-stop", rounds: 2, executedCalls: 1, skippedDuplicateCalls: 0 });
  assert.ok(events.includes("research"));
});

test("research preserves errors, does not repeat calls and never invents fallback data", async () => {
  let calls = 0;
  const r = await research({}, input, undefined, undefined, {
    config: {}, client: { tools: [], run: async () => { calls++; throw new Error("secret URL api_key=private"); } },
    inference: async () => ({ graph: { calls: [call], limitation: "" } }),
  });
  assert.equal(calls, 1);
  assert.equal(r.sources.length, 0);
  assert.equal(r.status, "no-data");
  assert.ok(!JSON.stringify(r).includes("private"));
  assert.equal(r.completion.reason, "no-new-calls");
  assert.equal(r.completion.rounds, 2);
});

test("research respects six-call bound and propagates user cancellation", async () => {
  let count = 0;
  const r = await research({}, input, undefined, undefined, {
    config: {}, client: { tools: [], run: async () => structuredClone(data) },
    inference: async () => ({ graph: { calls: Array.from({ length: 3 }, () => ({ ...call, metric: `TEST.METRIC.${++count}` })), limitation: "" } }),
  });
  assert.equal(r.attempts.length, 6);
  assert.equal(r.completion.reason, "call-budget");
  const c = new AbortController(); c.abort();
  await assert.rejects(research({}, input, c.signal, undefined, { config: {}, client: { tools: [] }, inference: async () => { throw new Error("aborted"); } }), /abort/i);
});

test("research ignores irrelevant parameters and duplicates without losing a useful read", async () => {
  let plans = 0;
  const requests = [];
  const r = await research({}, input, undefined, undefined, {
    config: {}, client: { tools: [], run: async (tool, parameters) => {
      requests.push({ tool, parameters });
      return structuredClone(data);
    } },
    inference: async () => ({ graph: {
      calls: ++plans === 1 ? [
        { ...call, identifier: " ita ", query: "ignored", reason: " Prima lettura " },
        { ...call, identifier: "ITA", query: "different but ignored" },
        { ...call, identifier: "USA" },
      ] : [], limitation: "",
    } }),
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].parameters.identifier, "ita");
  assert.equal(r.attempts[0].reason, "Prima lettura");
  assert.equal(r.completion.skippedDuplicateCalls, 1);
  assert.equal(r.completion.executedCalls, 2);
});

test("research treats padded CIKs as one lookup but keeps document excerpt searches distinct", async () => {
  let plans = 0, reads = 0;
  const r = await research({}, input, undefined, undefined, {
    config: {}, client: { tools: [], run: async () => { reads++; return structuredClone(data); } },
    inference: async () => ({ graph: { calls: ++plans === 1 ? [
      { ...call, tool: "sec_filings", identifier: "123", metric: "10-K" },
      { ...call, tool: "sec_filings", identifier: "0000000123", metric: "10-K", query: "ignored" },
    ] : plans === 2 ? [
      { ...call, tool: "sec_document", identifier: "https://www.sec.gov/Archives/example.htm", query: "revenue" },
      { ...call, tool: "sec_document", identifier: "https://www.sec.gov/Archives/example.htm", query: "costs" },
    ] : [], limitation: "" } }),
  });
  assert.equal(reads, 3);
  assert.equal(r.completion.skippedDuplicateCalls, 1);
});

test("research records a bounded-round stop rather than implying exhaustive coverage", async () => {
  let plans = 0;
  const r = await research({}, input, undefined, undefined, {
    config: {}, client: { tools: [], run: async () => structuredClone(data) },
    inference: async () => ({ graph: { calls: [{ ...call, metric: `TEST.METRIC.${++plans}` }], limitation: "" } }),
  });
  assert.equal(r.completion.reason, "round-budget");
  assert.equal(r.completion.rounds, 3);
  assert.equal(r.attempts.length, 3);
  assert.equal(r.status, "partial");
  assert.match(r.warnings.join(" "), /non è esaustiva/);
});

test("planner limitations are unverified notes, not technical warnings or source data", async () => {
  const note = "La misura di produttività non è stata recuperata.";
  const r = await research({}, input, undefined, undefined, {
    config: {}, client: { tools: [] },
    inference: async () => ({ graph: { calls: [], limitation: note } }),
  });
  assert.deepEqual(r.plannerNotes, [note]);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.sources, []);
  assert.equal(r.status, "no-data");
});
