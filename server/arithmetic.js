const MAX_CHARS = 500;
const MAX_TOKENS = 256;
const MAX_PARENTHESIS_DEPTH = 32;

function invalidInput() {
  return new Error("Invalid arithmetic input");
}

function finite(value) {
  if (!Number.isFinite(value)) throw invalidInput();
  return value;
}

function tokenize(expression) {
  const tokens = [];
  let index = 0;

  const add = (type, value = type) => {
    if (tokens.length >= MAX_TOKENS) throw invalidInput();
    tokens.push({ type, value });
  };

  while (index < expression.length) {
    const character = expression[index];
    if (
      character === " " ||
      character === "\t" ||
      character === "\r" ||
      character === "\n"
    ) {
      index += 1;
      continue;
    }

    if ("+-*/()".includes(character)) {
      add(character);
      index += 1;
      continue;
    }

    if (character === "." || (character >= "0" && character <= "9")) {
      const start = index;
      let digits = 0;
      while (index < expression.length) {
        const digit = expression[index];
        if (digit < "0" || digit > "9") break;
        digits += 1;
        index += 1;
      }
      if (expression[index] === ".") {
        index += 1;
        while (index < expression.length) {
          const digit = expression[index];
          if (digit < "0" || digit > "9") break;
          digits += 1;
          index += 1;
        }
      }
      if (digits === 0) throw invalidInput();
      const value = Number(expression.slice(start, index));
      add("number", finite(value));
      continue;
    }

    throw invalidInput();
  }

  add("eof");
  return tokens;
}

export function calculate(expression) {
  if (
    typeof expression !== "string" ||
    expression.length === 0 ||
    expression.length > MAX_CHARS
  )
    throw invalidInput();

  const tokens = tokenize(expression);
  let position = 0;
  let parenthesisDepth = 0;

  const current = () => tokens[position];
  const take = (type) => {
    if (current().type !== type) throw invalidInput();
    position += 1;
    return tokens[position - 1];
  };

  function parsePrimary() {
    if (current().type === "number") return take("number").value;
    if (current().type !== "(") throw invalidInput();
    if (parenthesisDepth >= MAX_PARENTHESIS_DEPTH) throw invalidInput();
    parenthesisDepth += 1;
    take("(");
    const value = parseAdditive();
    take(")");
    parenthesisDepth -= 1;
    return value;
  }

  function parseUnary() {
    if (current().type === "+") {
      take("+");
      return parseUnary();
    }
    if (current().type === "-") {
      take("-");
      return finite(-parseUnary());
    }
    return parsePrimary();
  }

  function parseMultiplicative() {
    let value = parseUnary();
    while (current().type === "*" || current().type === "/") {
      const operator = current().type;
      take(operator);
      const right = parseUnary();
      if (operator === "/") {
        if (right === 0) throw invalidInput();
        value = finite(value / right);
      } else {
        value = finite(value * right);
      }
    }
    return value;
  }

  function parseAdditive() {
    let value = parseMultiplicative();
    while (current().type === "+" || current().type === "-") {
      const operator = current().type;
      take(operator);
      const right = parseMultiplicative();
      value = finite(operator === "+" ? value + right : value - right);
    }
    return value;
  }

  const result = parseAdditive();
  if (current().type !== "eof") throw invalidInput();
  return Object.is(result, -0) ? 0 : result;
}
