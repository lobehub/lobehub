import ts from 'typescript';

export const aliasDeclaration = (declaration: ts.VariableDeclaration, symbols: Set<string>) =>
  ts.isIdentifier(declaration.name) &&
  declaration.initializer &&
  ts.isIdentifier(declaration.initializer) &&
  symbols.has(declaration.initializer.text) &&
  !symbols.has(declaration.name.text) &&
  ts.isVariableDeclarationList(declaration.parent) &&
  declaration.parent.flags & ts.NodeFlags.Const
    ? declaration.initializer.text
    : undefined;

export const aliasOf = (node: ts.Identifier, symbols: Set<string>) => {
  for (let scope: ts.Node = node.parent; scope; scope = scope.parent) {
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const statement of scope.statements)
      if (ts.isVariableStatement(statement))
        for (const declaration of statement.declarationList.declarations)
          if (ts.isIdentifier(declaration.name) && declaration.name.text === node.text)
            return aliasDeclaration(declaration, symbols);
    if (ts.isSourceFile(scope)) return undefined;
  }
  return undefined;
};

export const constInitializer = (node: ts.Identifier) => {
  for (let scope: ts.Node = node.parent; scope; scope = scope.parent) {
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const statement of scope.statements)
      if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const)
        for (const declaration of statement.declarationList.declarations)
          if (ts.isIdentifier(declaration.name) && declaration.name.text === node.text)
            return declaration.initializer;
    if (ts.isSourceFile(scope)) return undefined;
  }
  return undefined;
};
