import ts from 'typescript';

export const ownerOf = (statement: ts.Statement, ast: ts.SourceFile) => {
  if (ts.isVariableStatement(statement))
    return statement.declarationList.declarations.map((d) => d.name.getText(ast)).join(',');
  if (ts.isFunctionDeclaration(statement)) return statement.name?.text ?? 'default';
  if (ts.isExportAssignment(statement)) return 'default';
  return `statement@${ast.getLineAndCharacterOfPosition(statement.getStart(ast)).line + 1}`;
};
