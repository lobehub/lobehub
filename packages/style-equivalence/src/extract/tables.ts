import ts from 'typescript';

const unwrap = (node: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(node) ||
  ts.isAsExpression(node) ||
  ts.isSatisfiesExpression(node) ||
  ts.isTypeAssertionExpression(node)
    ? unwrap(node.expression)
    : node;

const literalKeys = (initializer: ts.Expression | undefined) => {
  const object = initializer && unwrap(initializer);
  if (!object || !ts.isObjectLiteralExpression(object)) return undefined;
  const keys = new Set<string>();
  for (const property of object.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      keys.add(property.name.text);
      continue;
    }
    if (!ts.isPropertyAssignment(property)) return undefined;
    const { name } = property;
    if (!ts.isIdentifier(name) && !ts.isStringLiteral(name) && !ts.isNumericLiteral(name))
      return undefined;
    keys.add(name.text);
  }
  return [...keys].sort();
};

const isWriteTarget = (access: ts.Expression) => {
  let node: ts.Node = access;
  while (ts.isParenthesizedExpression(node.parent)) node = node.parent;
  const { parent } = node;
  if (ts.isBinaryExpression(parent) && parent.left === node)
    return (
      parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    );
  return (
    ts.isDeleteExpression(parent) ||
    ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
      [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(parent.operator))
  );
};

const onlyRead = (ast: ts.SourceFile, name: string, declaration: ts.Identifier) => {
  let read = true;
  const visit = (node: ts.Node) => {
    if (!read) return;
    if (ts.isIdentifier(node) && node.text === name && node !== declaration) {
      const { parent } = node;
      const access =
        (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
        parent.expression === node;
      const nameOnly =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        ts.isTypeQueryNode(parent);
      if (!nameOnly && (!access || isWriteTarget(parent))) read = false;
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return read;
};

export const collectTables = (ast: ts.SourceFile) => {
  const tables: Record<string, string[]> = {};
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if (!(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const keys = literalKeys(declaration.initializer);
      if (keys && onlyRead(ast, declaration.name.text, declaration.name))
        tables[declaration.name.text] = keys;
    }
  }
  return tables;
};
