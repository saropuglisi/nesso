import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("the UI keeps the first streamed draft visible while a repair is pending", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const resetHandler = source.slice(
    source.indexOf('if (frame.type === "reset")'),
    source.indexOf('if (frame.type === "stage")'),
  );
  assert.match(resetHandler, /repairing = true/);
  assert.match(resetHandler, /Resta visibile/);
  assert.doesNotMatch(resetHandler, /graph\.nodes\s*=/);
  assert.doesNotMatch(resetHandler, /graph\.edges\s*=/);
  assert.match(source, /if \(repairing\) \{[\s\S]*prima bozza resta visibile[\s\S]*return;/);
  assert.match(source, /Tempo limite durante la correzione/);
});

test("a failed streamed draft is bounded locally and can be recovered after reload", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /function saveFailedAnalysis/);
  assert.match(source, /JSON\.stringify\(failedAnalysis\)\.length <= 200000/);
  assert.match(source, /function recoverFailedAnalysis/);
  assert.match(source, /saveDraft\(\{ failedAnalysis: undefined \}\)/);
  assert.match(source, /recoverFailedAnalysis\(savedDraft\.failedAnalysis\)/);
  assert.match(source, /Bozza locale recuperata · non salvata nel Diario/);
});
