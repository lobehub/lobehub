import ts from 'typescript';

const escape = (text: string) => text.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&');

export const isStateAttribute = (name: string) => /^(?:aria|data)-[\w-]+$/.test(name);

export const booleanAttribute = (code: string, name: string) => {
  const selector = new RegExp(`\\[${escape(name)}(?:\\s*=\\s*(['"]?)([^'"\\]]*)\\1)?\\s*\\]`, 'g');
  const values = [...code.matchAll(selector)].map((match) => match[2]);
  return (
    values.length > 0 &&
    values.every((value) => value === undefined || value === 'true' || value === 'false')
  );
};

const unwrap = (node: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;

const isEmpty = (node: ts.Expression) =>
  node.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(node) && node.text === 'undefined');

const isCondition = (node: ts.Expression): boolean => {
  const inner = unwrap(node);
  if (ts.isIdentifier(inner)) return inner.text !== 'undefined';
  if (ts.isPropertyAccessExpression(inner)) return isCondition(inner.expression);
  if (inner.kind === ts.SyntaxKind.TrueKeyword || inner.kind === ts.SyntaxKind.FalseKeyword)
    return true;
  if (ts.isPrefixUnaryExpression(inner))
    return inner.operator === ts.SyntaxKind.ExclamationToken && isCondition(inner.operand);
  if (ts.isBinaryExpression(inner))
    return (
      (inner.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        inner.operatorToken.kind === ts.SyntaxKind.BarBarToken) &&
      isCondition(inner.left) &&
      isCondition(inner.right)
    );
  return false;
};

const isValue = (node: ts.Expression): boolean => {
  const inner = unwrap(node);
  if (
    ts.isStringLiteral(inner) ||
    ts.isNoSubstitutionTemplateLiteral(inner) ||
    ts.isNumericLiteral(inner) ||
    inner.kind === ts.SyntaxKind.TrueKeyword ||
    inner.kind === ts.SyntaxKind.FalseKeyword ||
    isEmpty(inner)
  )
    return true;
  if (ts.isConditionalExpression(inner))
    return isCondition(inner.condition) && isValue(inner.whenTrue) && isValue(inner.whenFalse);
  if (
    ts.isBinaryExpression(inner) &&
    inner.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  )
    return isCondition(inner.left) && isValue(inner.right);
  return false;
};

export const evaluableAttribute = (expression: ts.Expression) =>
  !ts.isIdentifier(unwrap(expression)) && isValue(expression);

const stateKeysOf = (node: ts.Expression): string[] | undefined => {
  const inner = unwrap(node);
  if (isEmpty(inner) || inner.kind === ts.SyntaxKind.FalseKeyword) return [];
  if (ts.isConditionalExpression(inner)) {
    if (!isCondition(inner.condition)) return undefined;
    const left = stateKeysOf(inner.whenTrue);
    const right = stateKeysOf(inner.whenFalse);
    return left && right ? [...left, ...right] : undefined;
  }
  if (
    ts.isBinaryExpression(inner) &&
    inner.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  )
    return isCondition(inner.left) ? stateKeysOf(inner.right) : undefined;
  if (!ts.isObjectLiteralExpression(inner)) return undefined;
  const keys: string[] = [];
  for (const property of inner.properties) {
    if (!ts.isPropertyAssignment(property)) return undefined;
    const name = property.name;
    const key = ts.isStringLiteral(name) || ts.isIdentifier(name) ? name.text : undefined;
    if (!key || !isStateAttribute(key) || !isValue(property.initializer)) return undefined;
    keys.push(key);
  }
  return keys;
};

export const spreadAttributes = (expression: ts.Expression, ast: ts.SourceFile) => {
  const keys = stateKeysOf(expression);
  if (!keys?.length) return undefined;
  const text = unwrap(expression).getText(ast);
  return Object.fromEntries(
    [...new Set(keys)].map((key) => [key, `(${text})?.[${JSON.stringify(key)}]`]),
  );
};
