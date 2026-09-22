import test from "node:test";
import assert from "node:assert/strict";
import {
  critique,
  CRITIQUE_SCHEMA,
  validateCritique,
} from "../server/thesis-dialogue.js";
import { config } from "../server/provider.js";
import { input } from "./fixtures.js";

const provider = config({
  NESSO_PROVIDER: "openai-compatible",
  NESSO_MODEL: "fixture",
});

function response(value) {
  return Response.json({
    choices: [
      {
        finish_reason: "stop",
        message: { content: JSON.stringify(value) },
      },
    ],
  });
}

test("critique preserves the exact thesis and passes context as clarification", async () => {
  const source = {
    ...input,
    thesis: "Una settimana più breve migliorerà la retention del team.",
    context: "La domanda riguarda il personale già assunto.",
  };
  const answer = {
    observation:
      "La distinzione decisiva è tra retention e semplice soddisfazione del team: la prima richiede osservare chi resta.",
    question: "Vuoi valutare soprattutto le dimissioni o la soddisfazione?",
    options: ["Le dimissioni del team", "La soddisfazione del team"],
  };
  let request;
  const result = await critique(
    provider,
    source,
    undefined,
    async (url, options) => {
      request = { url, body: JSON.parse(options.body) };
      return response(answer);
    },
  );
  assert.deepEqual(result, answer);
  assert.deepEqual(JSON.parse(request.body.messages[1].content), {
    originalThesis: source.thesis,
    context: source.context,
  });
  assert.match(request.body.messages[0].content, /immutabile|preservata/i);
  assert.match(request.body.messages[0].content, /context/i);
  assert.deepEqual(request.body.response_format.json_schema.schema, CRITIQUE_SCHEMA);
});

test("critique rejects invented numeric claims and malformed option sets", async () => {
  const invented = {
    observation: "La retention salirà del 20%.",
    question: "Quale misura userai?",
    options: ["Le dimissioni", "La soddisfazione"],
  };
  await assert.rejects(
    () =>
      critique(provider, input, undefined, async () => response(invented)),
    /numero non presente/i,
  );

  assert.throws(
    () =>
      validateCritique({
        observation: "Una distinzione utile.",
        question: "Quale esito vuoi misurare?",
        options: ["Solo uno"],
      }, input),
    /due o tre opzioni/i,
  );
  assert.throws(
    () =>
      validateCritique({
        observation: "Una distinzione utile.",
        question: "Quale esito vuoi misurare?",
        options: ["Stesso esito", "Stesso esito"],
        extra: "non ammesso",
      }, input),
    /solo osservazione/i,
  );
});

test("critique allows numbers only when they are grounded in thesis or context", async () => {
  const source = {
    ...input,
    thesis: "Entro 2028 la settimana breve migliorerà la retention.",
    context: "Confronto con il 2027.",
  };
  const answer = {
    observation: "Il passaggio decisivo è se l'effetto entro 2028 supera il confronto con 2027.",
    question: "Quale confronto userai?",
    options: ["Confronto con il 2027", "Nessun confronto numerico"],
  };
  const result = await critique(
    provider,
    source,
    undefined,
    async () => response(answer),
  );
  assert.deepEqual(result, answer);
});
