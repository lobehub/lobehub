import ts from 'typescript';

export interface CompositionTrace {
  calls: Array<{ end: number; start: number; symbol: string }>;
  edits: Array<{ end: number; start: number; text: string }>;
  gaps: string[];
}

/** Resolve the imported symbol, not identifiers with the same spelling in inner scopes. */
export const planCompositionObserver = (code: string, file: string): CompositionTrace => {
  if (code.includes('__styleVerification'))
    throw new Error('STYLE_BINDING_OBSERVER_NAME_COLLISION');
  const ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const program = ts.createProgram(
    [file],
    { noLib: true, noResolve: true },
    {
      fileExists: (name) => name === file,
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => '',
      getDefaultLibFileName: () => '',
      getNewLine: () => '\n',
      getSourceFile: (name) => (name === file ? ast : undefined),
      readFile: () => undefined,
      useCaseSensitiveFileNames: () => true,
      writeFile: () => {
        throw new Error('COMPOSITION_OBSERVER_IS_READ_ONLY');
      },
    },
  );
  const checker = program.getTypeChecker();
  const imports = new Set<ts.Symbol>();
  for (const statement of ast.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !['@lobehub/ui', 'antd-style'].includes(statement.moduleSpecifier.text) ||
      statement.importClause?.isTypeOnly
    )
      continue;
    const named = statement.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const element of named.elements) {
      if (element.isTypeOnly || (element.propertyName?.text ?? element.name.text) !== 'cx')
        continue;
      const symbol = checker.getSymbolAtLocation(element.name);
      if (symbol) imports.add(symbol);
    }
  }
  const calls: CompositionTrace['calls'] = [];
  const edits: CompositionTrace['edits'] = [];
  const gaps: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && imports.has(checker.getSymbolAtLocation(node)!)) {
      const parent = node.parent;
      if (ts.isCallExpression(parent) && parent.expression === node) {
        if (parent.questionDotToken || parent.typeArguments?.length) {
          gaps.push('COMPOSITION_CALL_SYNTAX_UNSUPPORTED');
        } else {
          const open = parent
            .getChildren(ast)
            .find((child) => child.kind === ts.SyntaxKind.OpenParenToken);
          if (!open) throw new Error('COMPOSITION_CALL_PAREN_MISSING');
          const start = parent.getStart(ast);
          calls.push({ end: parent.end, start, symbol: node.text });
          edits.push({
            start: node.getStart(ast),
            end: node.end,
            text: '__styleVerificationCompose',
          });
          edits.push({ start: open.end, end: open.end, text: `${start},${node.text},` });
        }
      } else if (!ts.isImportSpecifier(parent))
        gaps.push('COMPOSITION_FUNCTION_REFERENCE_UNOBSERVED');
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  // Preserve directives (including "use client"); module imports are still hoisted.
  let insertion = 0;
  for (const statement of ast.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    insertion = statement.end;
  }
  edits.push({ start: insertion, end: insertion, text: `\n${compositionRuntime}\n` });
  return { calls, edits, gaps: [...new Set(gaps)] };
};

// Only primitive class strings enter telemetry. Objects/arrays are never inspected,
// serialized or passed to cx twice. The original return value/exception is preserved.
const compositionRuntime = `
export const __styleVerificationCompositions = {records: [], gaps: []};
function __styleVerificationCompose(callId, original, ...args) {
  const output = original(...args);
  const trace = __styleVerificationCompositions;
  const gap = (reason) => { if (!trace.gaps.includes(reason)) trace.gaps.push(reason); };
  if (args.length > 256 || (typeof output === 'string' && output.length > 16384) || args.some(value => typeof value === 'string' && value.length > 16384)) {
    gap('COMPOSITION_DATA_BUDGET_EXCEEDED'); return output;
  }
  if (args.some(value => typeof value !== 'string' && value !== false && value !== null && value !== undefined && value !== 0)) {
    gap('COMPOSITION_ARGUMENT_UNSUPPORTED'); return output;
  }
  if (typeof output !== 'string') { gap('COMPOSITION_RESULT_UNSUPPORTED'); return output; }
  const record = {callId, inputs: args.filter(value => typeof value === 'string'), output};
  const key = JSON.stringify(record);
  if (!trace.records.some(value => JSON.stringify(value) === key)) {
    if (trace.records.length >= 512) gap('COMPOSITION_TRACE_BUDGET_EXCEEDED');
    else trace.records.push(record);
  }
  return output;
}
`;
