// Pure arithmetic. No imports, no side effects, no privileges — which is why
// it lives apart from tools.ts: the dangerous part of a tool is the execution
// context, and this has none. Being a plain function also makes it directly
// testable without a server.

// ---------------------------------------------------------------------------
// A small recursive-descent evaluator.
//
// NOT eval() and NOT new Function(). Both would execute whatever string the
// model produced with this process's full privileges — file system, network,
// environment variables, the API key. An expression parser can only ever
// produce a number, because arithmetic is all it knows how to express.
// ---------------------------------------------------------------------------

type Token = { type: "number"; value: number } | { type: "op"; value: string };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const char = input[i];

    if (char === " " || char === "\t") {
      i++;
    } else if ("+-*/%()".includes(char)) {
      tokens.push({ type: "op", value: char });
      i++;
    } else if (/[0-9.]/.test(char)) {
      let literal = "";
      while (i < input.length && /[0-9.]/.test(input[i])) literal += input[i++];
      const value = Number(literal);
      if (!Number.isFinite(value)) throw new Error(`Not a number: ${literal}`);
      tokens.push({ type: "number", value });
    } else {
      // Anything we do not recognise is rejected rather than ignored. Silently
      // skipping unknown characters is how "1; rm -rf /" becomes "1".
      throw new Error(`Unexpected character: ${char}`);
    }
  }

  return tokens;
}

export function evaluateExpression(input: string): number {
  const tokens = tokenize(input);
  let position = 0;

  const peek = () => tokens[position];

  function parseExpression(): number {
    let left = parseTerm();
    while (peek()?.type === "op" && "+-".includes((peek() as Token).value as string)) {
      const op = tokens[position++].value as string;
      const right = parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  function parseTerm(): number {
    let left = parseFactor();
    while (peek()?.type === "op" && "*/%".includes((peek() as Token).value as string)) {
      const op = tokens[position++].value as string;
      const right = parseFactor();
      if ((op === "/" || op === "%") && right === 0) {
        throw new Error("Division by zero");
      }
      left = op === "*" ? left * right : op === "/" ? left / right : left % right;
    }
    return left;
  }

  function parseFactor(): number {
    const token = peek();
    if (token === undefined) throw new Error("Unexpected end of expression");

    if (token.type === "op" && token.value === "-") {
      position++;
      return -parseFactor();
    }
    if (token.type === "op" && token.value === "+") {
      position++;
      return parseFactor();
    }
    if (token.type === "op" && token.value === "(") {
      position++;
      const value = parseExpression();
      const closing = tokens[position++];
      if (closing === undefined || closing.value !== ")") {
        throw new Error("Unbalanced parentheses");
      }
      return value;
    }
    if (token.type === "number") {
      position++;
      return token.value;
    }
    throw new Error(`Unexpected token: ${token.value}`);
  }

  const result = parseExpression();

  if (position !== tokens.length) {
    throw new Error(`Unexpected trailing input at ${tokens[position].value}`);
  }
  if (!Number.isFinite(result)) {
    throw new Error("Result is not a finite number");
  }

  return result;
}
