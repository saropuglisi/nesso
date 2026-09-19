import test from "node:test";
import assert from "node:assert/strict";
import { calculate } from "../server/arithmetic.js";

test("respects arithmetic precedence and parentheses", () => {
  assert.equal(calculate("2 + 3 * 4"), 14);
  assert.equal(calculate("(2 + 3) * 4"), 20);
  assert.equal(calculate("18 / 3 / 2"), 3);
  assert.equal(calculate("18 / (3 / 2)"), 12);
});

test("supports unary signs and decimals", () => {
  assert.equal(calculate("-2 + +3"), 1);
  assert.equal(calculate("--2"), 2);
  assert.equal(calculate("-.5 * 8"), -4);
  assert.equal(calculate("1.25 + .75"), 2);
});

test("rejects malformed input and injection-like trailing text", () => {
  for (const expression of [
    "",
    " ",
    "2 +",
    "* 2",
    "2 2",
    "2(3)",
    "(2 + 3",
    "2 + 3)",
    "1..2",
    "2 ** 3",
    "2 + 2abc",
    "2; process.exit()",
    "2e3",
    "2 + 3 // comment",
  ]) {
    assert.throws(() => calculate(expression), Error, expression);
  }
  assert.throws(() => calculate(null), Error);
  assert.throws(() => calculate("1".repeat(501)), Error);
  assert.throws(() => calculate("(".repeat(33) + "1" + ")".repeat(33)), Error);
});

test("rejects division by zero and non-finite results", () => {
  assert.throws(() => calculate("1 / 0"), Error);
  assert.throws(() => calculate("1 / -0"), Error);
  assert.throws(() => calculate("9".repeat(400)), Error);
  assert.throws(() => calculate("1 / 0." + "0".repeat(499)), Error);
});

test("enforces the token limit", () => {
  assert.throws(() => calculate("1+".repeat(128) + "1"), Error);
});
