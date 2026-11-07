import ts from 'typescript';

const printer = ts.createPrinter({ removeComments: true });

const PREFIX = 'const __knob = (';

const syntaxValid = (code: string) =>
  !ts.transpileModule(code, {
    compilerOptions: { jsx: ts.JsxEmit.Preserve },
    fileName: 'knobs.tsx',
    reportDiagnostics: true,
  }).diagnostics?.length;

export const parseExpression = (expr: string) => {
  const code = `${PREFIX}${expr});`;
  if (!syntaxValid(code)) return undefined;
  const source = ts.createSourceFile(
    'knobs.tsx',
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const [statement] = source.statements;
  if (!statement || !ts.isVariableStatement(statement)) return undefined;
  const [declaration] = statement.declarationList.declarations;
  const initializer = declaration?.initializer;
  if (!initializer || !ts.isParenthesizedExpression(initializer)) return undefined;
  return { expression: initializer.expression, source };
};

const isNameOnly = (node: ts.Node) => {
  const { parent } = node;
  return (
    ts.isIdentifier(node) &&
    ((ts.isPropertyAccessExpression(parent) && parent.name === node) ||
      (ts.isPropertyAssignment(parent) && parent.name === node))
  );
};

export const knobText = (node: ts.Expression) =>
  printer.printNode(ts.EmitHint.Expression, node, node.getSourceFile());

export const knobReference = (knob: string) => `__v[${JSON.stringify(knob)}]`;

export const bindKnobs = (expr: string, knobs: readonly string[]) => {
  const parsed = parseExpression(expr);
  if (!parsed) return undefined;
  const wanted = new Set(knobs);
  const replacements: Array<{ end: number; knob: string; start: number }> = [];
  const visit = (node: ts.Node) => {
    if (ts.isShorthandPropertyAssignment(node)) return;
    if (ts.isExpression(node) && !ts.isParenthesizedExpression(node) && !isNameOnly(node)) {
      const text = knobText(node);
      if (wanted.has(text)) {
        replacements.push({
          end: node.end - PREFIX.length,
          knob: text,
          start: node.getStart(parsed.source) - PREFIX.length,
        });
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed.expression);
  let result = expr;
  for (const { end, knob, start } of replacements.reverse())
    result = `${result.slice(0, start)}${knobReference(knob)}${result.slice(end)}`;
  return result;
};
