import ts from 'typescript';

const LOGICAL = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);

export const isCondition = (node: ts.Expression): boolean => {
  if (ts.isIdentifier(node)) return true;
  if (
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword
  )
    return true;
  if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node))
    return isCondition(node.expression);
  if (ts.isPrefixUnaryExpression(node))
    return node.operator === ts.SyntaxKind.ExclamationToken && isCondition(node.operand);
  if (ts.isBinaryExpression(node))
    return (
      LOGICAL.has(node.operatorToken.kind) && isCondition(node.left) && isCondition(node.right)
    );
  if (ts.isCallExpression(node))
    return (
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Boolean' &&
      node.arguments.length === 1 &&
      isCondition(node.arguments[0])
    );
  return false;
};

export const localCondition = (node: ts.Identifier) => {
  for (let scope: ts.Node = node.parent; !ts.isSourceFile(scope); scope = scope.parent) {
    if (ts.isFunctionLike(scope)) return undefined;
    if (!ts.isBlock(scope)) continue;
    for (const statement of scope.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== node.text) continue;
        const value = declaration.initializer;
        return statement.declarationList.flags & ts.NodeFlags.Const && value && isCondition(value)
          ? value.getText()
          : undefined;
      }
    }
  }
  return undefined;
};

export const renderGuards = (element: ts.Node) => {
  const guards: string[] = [];
  let child = element;
  for (let parent = element.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
    if (ts.isFunctionLike(parent)) break;
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      parent.right === child &&
      isCondition(parent.left)
    )
      guards.push(parent.left.getText());
    if (
      ts.isConditionalExpression(parent) &&
      parent.condition !== child &&
      isCondition(parent.condition)
    )
      guards.push(
        parent.whenTrue === child ? parent.condition.getText() : `!(${parent.condition.getText()})`,
      );
    child = parent;
  }
  return guards;
};
