import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Explicit opt-in CLI: this uses the configured, potentially paid inference API.
const [suitePath, outputPath, moduleDirectory = "server"] =
  process.argv.slice(2);
if (!suitePath || !outputPath)
  throw new Error(
    "Usage: node --env-file=.env scripts/evaluate-finance.mjs suite.json output-directory [module-directory]",
  );
const { config, infer } = await import(
  pathToFileURL(resolve(moduleDirectory, "provider.js"))
);
const runInference =
  moduleDirectory === "server"
    ? (await import("../server/analysis.js")).analyze
    : infer;
const { inputSpec, validateGraph } = await import(
  pathToFileURL(resolve(moduleDirectory, "domain.js"))
);
const suite = JSON.parse(await readFile(suitePath, "utf8"));
const cases = Array.isArray(suite) ? suite : suite.cases;
if (!Array.isArray(cases) || cases.length > 8)
  throw new Error("Expected at most eight explicit cases.");
await mkdir(outputPath, { recursive: true });
const provider = config();
const results = [];
let cursor = 0;
async function worker() {
  while (cursor < cases.length) {
    const c = cases[cursor++],
      started = Date.now();
    const record = {
      id: c.id,
      model: provider.model,
      input: inputSpec({ thesis: c.thesis, effort: c.effort || "low" }),
      expected: c.assertions || c.must_address,
    };
    console.log(JSON.stringify({ id: c.id, status: "started" }));
    try {
      const response = await runInference(provider, record.input);
      record.response = response;
      try {
        record.validatedGraph = validateGraph(
          response.graph,
          record.input.effort,
        );
        record.structurallyValid = true;
      } catch (e) {
        record.structurallyValid = false;
        record.validationError = e.message;
      }
    } catch (e) {
      if (e.extraction) record.failedExtraction = e.extraction;
      record.error = e.status ? e.message : "Unexpected inference failure";
      record.structurallyValid = false;
    }
    record.elapsedMs = Date.now() - started;
    await writeFile(
      resolve(outputPath, `${c.id.replace(/[^a-z0-9_-]/gi, "_")}.json`),
      JSON.stringify(record, null, 2),
    );
    results.push({
      id: c.id,
      structurallyValid: record.structurallyValid,
      error: record.error || record.validationError,
      elapsedMs: record.elapsedMs,
      usage: record.response?.provenance.usage,
    });
    console.log(JSON.stringify(results.at(-1)));
  }
}
await worker();
await writeFile(
  resolve(outputPath, "summary.json"),
  JSON.stringify(results, null, 2),
);
