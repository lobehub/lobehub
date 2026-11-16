import ts from 'typescript';

export const CSS_TAG_SOURCES = new Set(['@emotion/css', '@lobehub/ui', 'antd-style']);

const cssTemplate = (node: ts.Expression, isCssTag: (name: string) => boolean) =>
  ts.isTaggedTemplateExpression(node) && ts.isIdentifier(node.tag) && isCssTag(node.tag.text)
    ? node
    : undefined;

export const cssTemplatesOf = (
  initializer: ts.Expression,
  isCssTag: (name: string) => boolean,
): ts.TaggedTemplateExpression[] | undefined => {
  const direct = cssTemplate(initializer, isCssTag);
  if (direct) return [direct];
  if (
    !ts.isCallExpression(initializer) ||
    !ts.isIdentifier(initializer.expression) ||
    initializer.expression.text !== 'cx' ||
    !initializer.arguments.length
  )
    return undefined;
  const templates = initializer.arguments.map((argument) => cssTemplate(argument, isCssTag));
  return templates.every(Boolean) ? (templates as ts.TaggedTemplateExpression[]) : undefined;
};

export const cssConstantFactory = (
  ast: ts.SourceFile,
  name: string,
  templates: ts.TaggedTemplateExpression[],
) => {
  const members = templates.map((template) => `${name}: ${template.getText(ast)}`).join(',\n');
  const sf = ts.createSourceFile(
    ast.fileName,
    `${ast.text}\n;createStaticStyles(() => ({\n${members}\n}));\n`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const statement = sf.statements.at(-1);
  return statement &&
    ts.isExpressionStatement(statement) &&
    ts.isCallExpression(statement.expression)
    ? statement.expression
    : undefined;
};
