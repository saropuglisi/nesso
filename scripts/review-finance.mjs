import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "../server/provider.js";
import { reviewGraph } from "../server/review.js";
import { validateFinancial, validateGraph } from "../server/domain.js";
const [output, ...files] = process.argv.slice(2);
if (!output || !files.length || files.length > 8)
  throw new Error(
    "Usage: review-finance.mjs output-directory record.json ... (paid API)",
  );
await mkdir(output, { recursive: true });
const provider = config();
let cursor = 0;
async function worker() {
  while (cursor < files.length) {
    const record = JSON.parse(await readFile(files[cursor++], "utf8"));
    const graph = record.response.graph;
    try {
      const review = await reviewGraph(
        provider,
        record.input,
        graph,
        validateFinancial(graph.financial),
      );
      record.review = review;
      record.validatedGraph = validateGraph(review.graph, record.input.effort);
      record.structurallyValid = true;
      console.log(
        JSON.stringify({
          id: record.id,
          corrections: review.corrections.length,
          cost: review.provenance.usage?.cost,
        }),
      );
    } catch (e) {
      record.reviewError = e.status ? e.message : "Review failed";
      console.log(JSON.stringify({ id: record.id, error: record.reviewError }));
    }
    await writeFile(
      resolve(output, record.id.replace(/[^a-z0-9_-]/gi, "_") + ".json"),
      JSON.stringify(record, null, 2),
    );
  }
}
await Promise.all([worker(), worker()]);
