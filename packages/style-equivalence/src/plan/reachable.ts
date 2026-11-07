import ts from 'typescript';

import type { StyleElement } from '../extract';
import { valueIdentifiers } from '../extract/identifiers';
import type { Combo } from './combos';

const FREE_LIMIT = 4;

type Value = boolean | string | null | undefined;

const parse = (text: string) => {
  const source = ts.createSourceFile('c.ts', `(${text});`, ts.ScriptTarget.Latest, true);
  const [statement] = source.statements;
  return statement && ts.isExpressionStatement(statement) ? statement.expression : undefined;
};

const evaluate = (node: ts.Expression, env: Record<string, Value>): Value => {
  if (ts.isIdentifier(node)) return node.text === 'undefined' ? undefined : env[node.text];
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node))
    return evaluate(node.expression, env);
  if (ts.isPrefixUnaryExpression(node)) return !evaluate(node.operand, env);
  if (ts.isCallExpression(node)) return Boolean(evaluate(node.arguments[0], env));
  if (!ts.isBinaryExpression(node)) throw new Error('unsupported condition');
  const left = evaluate(node.left, env);
  switch (node.operatorToken.kind) {
    case ts.SyntaxKind.AmpersandAmpersandToken: {
      return left ? evaluate(node.right, env) : left;
    }
    case ts.SyntaxKind.BarBarToken: {
      return left || evaluate(node.right, env);
    }
    case ts.SyntaxKind.QuestionQuestionToken: {
      return left ?? evaluate(node.right, env);
    }
    case ts.SyntaxKind.EqualsEqualsEqualsToken: {
      return left === evaluate(node.right, env);
    }
    case ts.SyntaxKind.ExclamationEqualsEqualsToken: {
      return left !== evaluate(node.right, env);
    }
    case ts.SyntaxKind.EqualsEqualsToken: {
      return left == evaluate(node.right, env);
    }
    case ts.SyntaxKind.ExclamationEqualsToken: {
      return left != evaluate(node.right, env);
    }
    default: {
      throw new Error('unsupported condition');
    }
  }
};

interface Constraint {
  free: string[];
  holds: (env: Record<string, Value>) => boolean;
}

const constraintsOf = (chain: StyleElement[], names: Set<string>) => {
  const found: Constraint[] = [];
  const add = (text: string, check: (value: Value, env: Record<string, Value>) => boolean) => {
    const node = parse(text);
    if (!node) return;
    found.push({
      free: [...valueIdentifiers(node)].filter((name) => !names.has(name) && name !== 'undefined'),
      holds: (env) => check(evaluate(node, env), env),
    });
  };
  for (const element of chain) {
    for (const guard of element.guards ?? []) add(guard, (value) => Boolean(value));
    for (const [name, text] of Object.entries(element.derived ?? {}))
      if (names.has(name)) add(text, (value, env) => Boolean(value) === Boolean(env[name]));
  }
  return found;
};

const FREE_VALUES: Value[] = [false, true, null, undefined];

const satisfiable = (combo: Combo, constraints: Constraint[]) => {
  const free = [...new Set(constraints.flatMap((constraint) => constraint.free))];
  if (free.length > FREE_LIMIT) return true;
  for (let index = 0; index < FREE_VALUES.length ** free.length; index++) {
    const env: Record<string, Value> = { ...combo };
    let rest = index;
    for (const name of free) {
      env[name] = FREE_VALUES[rest % FREE_VALUES.length];
      rest = Math.floor(rest / FREE_VALUES.length);
    }
    try {
      if (constraints.every((constraint) => constraint.holds(env))) return true;
    } catch {
      return true;
    }
  }
  return false;
};

export const reachableCombos = (
  combos: Combo[],
  chains: Record<'base' | 'head', StyleElement[]>,
) => {
  if (combos.length < 2) return combos;
  const names = new Set(Object.keys(combos[0]));
  const sides = [chains.base, chains.head].map((chain) => constraintsOf(chain, names));
  if (sides.every((constraints) => !constraints.length)) return combos;
  const kept = combos.filter((combo) =>
    sides.some((constraints) => satisfiable(combo, constraints)),
  );
  return kept.length ? kept : combos;
};
