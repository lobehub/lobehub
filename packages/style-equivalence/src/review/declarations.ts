import postcss, { type ChildNode } from 'postcss';
import ts from 'typescript';

export interface Declaration {
  property: string;
  selector: string;
  value: string;
}

export interface DeclarationRow {
  after: string[];
  before: string[];
  differs: boolean;
  label: string;
  oneSided: boolean;
}

export interface DeclarationBlock {
  key: string;
  rows: DeclarationRow[];
  slot: string;
}

const kebab = (name: string) => name.replaceAll(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);

const token = (text: string) => {
  const trimmed = text.trim();
  return trimmed.startsWith('cssVar.') ? trimmed.slice('cssVar.'.length) : `\${${trimmed}}`;
};

const PLACEHOLDER = /__I(\d+)__/g;

const scopeOf = (selector: string, key: string) =>
  key.startsWith('@') ? `${selector} ${key}`.trim() : `${selector}${key}`;

const fromCss = (css: string, selector = '', restore = (value: string) => value): Declaration[] => {
  const rows: Declaration[] = [];
  const walk = (nodes: ChildNode[], scope: string) => {
    for (const node of nodes) {
      if (node.type === 'decl')
        rows.push({ property: node.prop, selector: scope, value: restore(node.value.trim()) });
      else if (node.type === 'rule')
        walk(node.nodes, `${scope}${node.selector.replace(/^&/, '').trim()}`.trim());
      else if (node.type === 'atrule')
        walk(node.nodes ?? [], `${scope} @${node.name} ${node.params}`.trim());
    }
  };
  walk(postcss.parse(css).nodes, selector);
  return rows;
};

const fromEmotion = (template: string) => {
  const composed = template.replaceAll(
    /^(\s*)\$\{([^{}]*)\}\s*;?\s*$/gm,
    (_match, indent: string, inner: string) => `${indent}composes: ${inner.trim()};`,
  );
  const interpolations: string[] = [];
  const masked = composed.replaceAll(/\$\{([^{}]*)\}/g, (_match, inner: string) => {
    const text = token(inner);
    if (!text.startsWith('${')) return text;
    interpolations.push(text);
    return `__I${interpolations.length - 1}__`;
  });
  try {
    return fromCss(masked, '', (value) =>
      value.replaceAll(PLACEHOLDER, (_match, index: string) => interpolations[Number(index)]),
    );
  } catch {
    return [];
  }
};

const fromCssModule = (text: string) => {
  const rows: Declaration[] = [];
  postcss.parse(text).walkRules((rule) => {
    if (rule.parent?.type === 'rule') return;
    const scope = rule.selector.replace(/^\.[\w-]+/, '').trim();
    rows.push(...fromCss(rule.nodes.map(String).join(';'), scope));
  });
  return rows;
};

const expressionText = (node: ts.Expression, source: ts.SourceFile): string | undefined => {
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
  if (ts.isPrefixUnaryExpression(node)) return node.getText(source);
  if (ts.isPropertyAccessExpression(node)) return node.getText(source).replace(/^cssVar\./, '');
  if (ts.isTemplateExpression(node))
    return [
      node.head.text,
      ...node.templateSpans.map(
        (span) => `${token(span.expression.getText(source))}${span.literal.text}`,
      ),
    ].join('');
  return node.kind === ts.SyntaxKind.NullKeyword ? undefined : node.getText(source);
};

const keyText = (name: ts.PropertyName) =>
  ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;

const fromObject = (
  object: ts.ObjectLiteralExpression,
  source: ts.SourceFile,
  property?: string,
  selector = '',
) => {
  const rows: Declaration[] = [];
  for (const member of object.properties) {
    if (!ts.isPropertyAssignment(member)) continue;
    const key = keyText(member.name);
    if (key === undefined) continue;
    if (property === undefined) {
      if (/^[:@]/.test(key) && ts.isObjectLiteralExpression(member.initializer))
        rows.push(...fromObject(member.initializer, source, undefined, scopeOf(selector, key)));
      else if (ts.isObjectLiteralExpression(member.initializer))
        rows.push(...fromObject(member.initializer, source, kebab(key), selector));
      else {
        const value = expressionText(member.initializer, source);
        if (value !== undefined) rows.push({ property: kebab(key), selector, value });
      }
      continue;
    }
    const scope = key === 'default' ? selector : scopeOf(selector, key);
    if (ts.isObjectLiteralExpression(member.initializer))
      rows.push(...fromObject(member.initializer, source, property, scope));
    else {
      const value = expressionText(member.initializer, source);
      if (value !== undefined) rows.push({ property, selector: scope, value });
    }
  }
  return rows;
};

export const parseDeclarations = (text: string): Declaration[] => {
  const emotion = /^[\w$]+\s*:\s*css`([\s\S]*)`\s*$/.exec(text.trim());
  if (emotion) return fromEmotion(emotion[1]);
  if (/^[.#@]/.test(text.trim())) {
    try {
      return fromCssModule(text);
    } catch {
      return [];
    }
  }
  const source = ts.createSourceFile('slot.ts', `({${text}})`, ts.ScriptTarget.Latest, true);
  const [statement] = source.statements;
  if (!statement || !ts.isExpressionStatement(statement)) return [];
  const outer = ts.isParenthesizedExpression(statement.expression)
    ? statement.expression.expression
    : undefined;
  if (!outer || !ts.isObjectLiteralExpression(outer)) return [];
  const [member] = outer.properties;
  if (
    !member ||
    !ts.isPropertyAssignment(member) ||
    !ts.isObjectLiteralExpression(member.initializer)
  )
    return [];
  return fromObject(member.initializer, source);
};

const family = (property: string) => {
  if (property.startsWith('background')) return 'background';
  if (/^border(-.+)?-radius$/.test(property)) return 'border-radius';
  if (property.startsWith('border')) return 'border';
  if (property.startsWith('padding')) return 'padding';
  if (property.startsWith('margin')) return 'margin';
  if (property.startsWith('inset') || ['top', 'right', 'bottom', 'left'].includes(property))
    return 'inset';
  if (property === 'flex' || /^flex-(grow|shrink|basis)$/.test(property)) return 'flex';
  return property;
};

export const slotName = (key: string) => key.slice(key.lastIndexOf('.') + 1);

export const declarationBlocks = (
  before: Record<string, string> = {},
  after: Record<string, string> = {},
  differing: string[] = [],
): DeclarationBlock[] => {
  const changed = new Set(differing.map(family));
  const slots = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return slots.map((slot) => {
    const rows = new Map<string, DeclarationRow>();
    const add = (side: 'after' | 'before', text?: string) => {
      for (const { property, selector, value } of text ? parseDeclarations(text) : []) {
        const name = family(property);
        const label = selector ? `${selector} ${name}` : name;
        const row = rows.get(label) ?? {
          after: [],
          before: [],
          differs: changed.has(name),
          label,
          oneSided: false,
        };
        row[side].push(`${property}: ${value}`);
        rows.set(label, row);
      }
    };
    add('before', before[slot]);
    add('after', after[slot]);
    for (const row of rows.values()) row.oneSided = !row.before.length || !row.after.length;
    return {
      key: slot,
      rows: [...rows.values()].sort((a, b) => Number(b.differs) - Number(a.differs)),
      slot: slotName(slot),
    };
  });
};
