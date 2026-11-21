import ts from 'typescript';

const UNSUPPORTED_STYLEX_KEYS = new Set(['all']);

export const stylexUnsupported = (factories: Map<string, ts.CallExpression>) => {
  const found: Record<string, string[]> = {};
  for (const [symbol, factory] of factories) {
    const callee = factory.expression;
    if (!ts.isPropertyAccessExpression(callee) || callee.getText() !== 'stylex.create') continue;
    const [argument] = factory.arguments;
    if (!argument || !ts.isObjectLiteralExpression(argument)) continue;
    for (const slot of argument.properties) {
      if (!ts.isPropertyAssignment(slot)) continue;
      const keys = new Set<string>();
      const visit = (node: ts.Node) => {
        if (ts.isPropertyAssignment(node)) {
          const key =
            ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : '';
          if (UNSUPPORTED_STYLEX_KEYS.has(key)) keys.add(key);
        }
        ts.forEachChild(node, visit);
      };
      visit(slot.initializer);
      if (keys.size) found[`${symbol}.${slot.name.getText()}`] = [...keys].sort();
    }
  }
  return found;
};
