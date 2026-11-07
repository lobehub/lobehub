import postcss, { type Declaration, type Rule } from 'postcss';
import ts from 'typescript';

import { classNamesIn } from '../extract/selectors';
import { findStyleMember, parseSource, propertyNameOf } from '../source/declarations';

export type MutationOperator =
  'delete-declaration' | 'delete-state' | 'invert-condition' | 'numeric' | 'swap-token';

export const MUTATION_OPERATORS: MutationOperator[] = [
  'numeric',
  'delete-declaration',
  'swap-token',
  'delete-state',
  'invert-condition',
];

export interface Mutation {
  description: string;
  end: number;
  operator: MutationOperator;
  replacement: string;
  start: number;
}

export const applyMutation = (code: string, mutation: Mutation) =>
  code.slice(0, mutation.start) + mutation.replacement + code.slice(mutation.end);

const NUMBER = /-?\d*\.?\d+/;

const bumpNumber = (text: string) => {
  const match = NUMBER.exec(text);
  if (!match) return undefined;
  const value = Number(match[0]);
  const next = Number.isInteger(value) ? value + 1 : Math.round((value + 0.1) * 10_000) / 10_000;
  return text.slice(0, match.index) + String(next) + text.slice(match.index + match[0].length);
};

const firstOf = (mutations: Array<Mutation | undefined>) => {
  const seen = new Set<MutationOperator>();
  return mutations.filter((mutation): mutation is Mutation => {
    if (!mutation || seen.has(mutation.operator)) return false;
    seen.add(mutation.operator);
    return true;
  });
};

const removal = (code: string, node: ts.Node, operator: MutationOperator): Mutation => {
  let start = node.getFullStart();
  let end = node.end;
  let after = end;
  while (/\s/.test(code[after] ?? '')) after++;
  if (code[after] === ',') end = after + 1;
  else {
    let before = start - 1;
    while (before >= 0 && /\s/.test(code[before])) before--;
    if (code[before] === ',') start = before;
  }
  return { description: `${operator}: ${node.getText()}`, end, operator, replacement: '', start };
};

const sharedPrefix = (left: string, right: string) => {
  let length = 0;
  while (length < left.length && left[length] === right[length]) length++;
  return length;
};

const closest = (name: string, others: string[]) =>
  others.reduce<string | undefined>(
    (best, other) =>
      best === undefined || sharedPrefix(name, other) > sharedPrefix(name, best) ? other : best,
    undefined,
  );

const tokenSwap = (sf: ts.SourceFile, token: ts.Node): Mutation | undefined => {
  if (!ts.isPropertyAccessExpression(token) || !ts.isIdentifier(token.expression)) return;
  const object = token.expression.text;
  const names: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === object &&
      node.name.text !== token.name.text &&
      !names.includes(node.name.text)
    )
      names.push(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const name = closest(token.name.text, names);
  const other = name && `${object}.${name}`;
  if (!other) return;
  return {
    description: `swap-token: ${token.getText(sf)} → ${other}`,
    end: token.end,
    operator: 'swap-token',
    replacement: other,
    start: token.getStart(sf),
  };
};

const objectMutations = (code: string, sf: ts.SourceFile, object: ts.ObjectLiteralExpression) => {
  const leaves: ts.PropertyAssignment[] = [];
  const states: ts.PropertyAssignment[] = [];
  const walk = (node: ts.ObjectLiteralExpression) => {
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      if (/^[:@]/.test(propertyNameOf(property.name) ?? '')) states.push(property);
      if (ts.isObjectLiteralExpression(property.initializer)) walk(property.initializer);
      else leaves.push(property);
    }
  };
  walk(object);
  const numeric = leaves
    .map((leaf) => leaf.initializer)
    .find(
      (value) =>
        ts.isNumericLiteral(value) || (ts.isStringLiteral(value) && NUMBER.test(value.text)),
    );
  const bumped = numeric && bumpNumber(numeric.getText(sf));
  const first = object.properties.find(ts.isPropertyAssignment);
  return [
    numeric && bumped
      ? {
          description: `numeric: ${numeric.getText(sf)} → ${bumped}`,
          end: numeric.end,
          operator: 'numeric' as const,
          replacement: bumped,
          start: numeric.getStart(sf),
        }
      : undefined,
    first ? removal(code, first, 'delete-declaration') : undefined,
    ...leaves.map((leaf) => tokenSwap(sf, leaf.initializer)),
    states[0] ? removal(code, states[0], 'delete-state') : undefined,
  ];
};

const DECLARATION = /(^|[\s{;])([a-z-]+)\s*:\s*([^;{}]*);/g;
const STATE = /&[:[]|@(?:media|container|supports)/;

const templateMutations = (code: string, sf: ts.SourceFile, template: ts.TemplateLiteral) => {
  const offset = template.getStart(sf);
  let masked = template.getText(sf);
  const spans = ts.isTemplateExpression(template) ? template.templateSpans : [];
  for (const span of spans) {
    const from = span.expression.getFullStart() - 2 - offset;
    const to = span.literal.getStart(sf) + 1 - offset;
    masked = masked.slice(0, from) + 'X'.repeat(to - from) + masked.slice(to);
  }
  const declarations = [...masked.matchAll(DECLARATION)].map((match) => ({
    start: match.index + match[1].length,
    text: match[0].slice(match[1].length),
    value: match[3],
  }));
  const numericDeclaration = declarations.find((item) => NUMBER.test(item.value));
  const numeric =
    numericDeclaration &&
    (() => {
      const colon = numericDeclaration.text.indexOf(':');
      const match = NUMBER.exec(numericDeclaration.text.slice(colon))!;
      const start = offset + numericDeclaration.start + colon + match.index;
      return {
        end: start + match[0].length,
        replacement: bumpNumber(match[0])!,
        start,
        text: match[0],
      };
    })();
  const first = declarations[0];
  const state = STATE.exec(masked);
  let stateRange: [number, number] | undefined;
  if (state) {
    const open = masked.indexOf('{', state.index);
    let depth = 0;
    for (let index = open; index >= 0 && index < masked.length; index++) {
      if (masked[index] === '{') depth++;
      if (masked[index] === '}' && --depth === 0) {
        let start = state.index;
        while (start > 0 && /[\t ]/.test(masked[start - 1])) start--;
        stateRange = [start, index + 1];
        break;
      }
    }
  }
  return [
    numeric && {
      description: `numeric: ${numeric.text} → ${numeric.replacement}`,
      end: numeric.end,
      operator: 'numeric' as const,
      replacement: numeric.replacement,
      start: numeric.start,
    },
    first && {
      description: `delete-declaration: ${code.slice(offset + first.start, offset + first.start + first.text.length)}`,
      end: offset + first.start + first.text.length,
      operator: 'delete-declaration' as const,
      replacement: '',
      start: offset + first.start,
    },
    ...spans.map((span) => tokenSwap(sf, span.expression)),
    stateRange && {
      description: `delete-state: ${masked.slice(stateRange[0], stateRange[1]).trim().split('{')[0].trim()}`,
      end: offset + stateRange[1],
      operator: 'delete-state' as const,
      replacement: '',
      start: offset + stateRange[0],
    },
  ];
};

export const declarationMutations = (code: string, symbol: string, member: string): Mutation[] => {
  const sf = parseSource(code, 'styles.tsx');
  const property = findStyleMember(sf, symbol, member);
  if (!property) return [];
  const value = property.initializer;
  if (ts.isObjectLiteralExpression(value)) return firstOf(objectMutations(code, sf, value));
  if (ts.isTaggedTemplateExpression(value))
    return firstOf(templateMutations(code, sf, value.template));
  return [];
};

const VARIABLE = /var\((--[\w-]+)/;

export const stylesheetMutations = (css: string, className: string): Mutation[] => {
  const root = postcss.parse(css);
  const plain: Rule[] = [];
  const states: Rule[] = [];
  const variables = new Set<string>();
  root.walkDecls((declaration) => {
    for (const match of declaration.value.matchAll(/var\((--[\w-]+)/g)) variables.add(match[1]);
  });
  root.walkRules((rule) => {
    if (!classNamesIn(rule.selector).includes(className)) return;
    const conditional = rule.parent?.type === 'atrule' || /:(?!:)|\[/.test(rule.selector);
    (conditional ? states : plain).push(rule);
  });
  const range = (node: Declaration | Rule) =>
    [node.source!.start!.offset, node.source!.end!.offset] as const;
  const declarations = plain.flatMap((rule) => rule.nodes.filter((node) => node.type === 'decl'));
  const numeric = declarations.find((declaration) => NUMBER.test(declaration.value));
  const swap = declarations.find((declaration) => {
    const used = VARIABLE.exec(declaration.value)?.[1];
    return used && [...variables].some((name) => name !== used);
  });
  const mutations: Array<Mutation | undefined> = [];
  if (numeric) {
    const [start, end] = range(numeric);
    const text = css.slice(start, end);
    const colon = text.indexOf(':');
    const replacement = text.slice(0, colon) + bumpNumber(text.slice(colon))!;
    mutations.push({
      description: `numeric: ${text} → ${replacement}`,
      end,
      operator: 'numeric',
      replacement,
      start,
    });
  }
  if (declarations[0]) {
    const [start, end] = range(declarations[0]);
    let after = end;
    while (/[\t ]/.test(css[after] ?? '')) after++;
    mutations.push({
      description: `delete-declaration: ${css.slice(start, end)}`,
      end: after,
      operator: 'delete-declaration',
      replacement: '',
      start,
    });
  }
  if (swap) {
    const [start, end] = range(swap);
    const text = css.slice(start, end);
    const used = VARIABLE.exec(swap.value)![1];
    const other = closest(
      used,
      [...variables].filter((name) => name !== used),
    )!;
    const replacement = text.replace(`var(${used}`, `var(${other}`);
    mutations.push({
      description: `swap-token: ${used} → ${other}`,
      end,
      operator: 'swap-token',
      replacement,
      start,
    });
  }
  if (states[0]) {
    const [start, end] = range(states[0]);
    mutations.push({
      description: `delete-state: ${states[0].selector}`,
      end: css[end] === '\n' ? end + 1 : end,
      operator: 'delete-state',
      replacement: '',
      start,
    });
  }
  return firstOf(mutations);
};

const PREFIX = 'const __mutated = (';

export const conditionMutations = (expression: string): Mutation[] => {
  const sf = ts.createSourceFile(
    'condition.tsx',
    `${PREFIX}${expression});`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const mutations: Mutation[] = [];
  const at = (node: ts.Node) => [node.getStart(sf) - PREFIX.length, node.end - PREFIX.length];
  const visit = (node: ts.Node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      const [start, end] = at(node.left);
      mutations.push({
        description: `invert-condition: ${node.left.getText(sf)}`,
        end,
        operator: 'invert-condition',
        replacement: `!(${node.left.getText(sf)})`,
        start,
      });
    }
    if (ts.isConditionalExpression(node)) {
      const [start] = at(node.whenTrue);
      const [, end] = at(node.whenFalse);
      mutations.push({
        description: `invert-condition: ${node.condition.getText(sf)} ? … : …`,
        end,
        operator: 'invert-condition',
        replacement: `${node.whenFalse.getText(sf)} : ${node.whenTrue.getText(sf)}`,
        start,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return mutations;
};
