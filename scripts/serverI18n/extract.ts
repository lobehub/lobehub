import ts from 'typescript';

export interface TranslationUse {
  file: string;
  line: number;
  namespace: string;
  optional: boolean;
  patterns: string[];
}

export const assertBoundedTranslationUses = (
  uses: TranslationUse[],
  allowlist: { file: string; namespace: string; reason: string }[],
) => {
  for (const use of uses) {
    if (
      use.patterns.includes('.*') &&
      !allowlist.some((entry) => entry.file === use.file && entry.namespace === use.namespace)
    )
      throw new Error(
        `${use.file}:${use.line}: unbounded dynamic translation key in ${use.namespace}; use a fixed prefix, a finite key type, or an explicit allowlist entry`,
      );
  }
};

const escape = (value: string) => value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
const product = (left: string[], right: string[]) => left.flatMap((a) => right.map((b) => a + b));

/** Patterns are anchored at selection time. Unknown strings deliberately retain every matching key. */
export const typePatterns = (type: ts.Type): string[] => {
  if (type.isUnion()) return [...new Set(type.types.flatMap(typePatterns))];
  if (type.isStringLiteral()) return [escape(type.value)];
  if (type.isNumberLiteral()) return [String(type.value)];
  if (type.flags & ts.TypeFlags.TemplateLiteral) {
    const template = type as ts.TemplateLiteralType;
    return template.types.reduce(
      (patterns, value, i) =>
        product(patterns, typePatterns(value)).map(
          (pattern) => pattern + escape(template.texts[i + 1]),
        ),
      [escape(template.texts[0])],
    );
  }
  if (type.flags & (ts.TypeFlags.String | ts.TypeFlags.Number)) return ['.*'];
  throw new Error(
    `Cannot statically classify translation key (type flags ${type.flags}); declare a string or template-literal key domain`,
  );
};

export const extractTranslationUses = (program: ts.Program, files: string[]): TranslationUse[] => {
  const checker = program.getTypeChecker();
  const uses: TranslationUse[] = [];
  const patternsFor = (node: ts.Expression, seen = new Set<ts.Node>()): string[] => {
    if (seen.has(node)) throw new Error('Cyclic translation key initializer');
    seen.add(node);
    if (ts.isStringLiteralLike(node)) return [escape(node.text)];
    if (ts.isTemplateExpression(node))
      return node.templateSpans.reduce(
        (patterns, span) =>
          product(patterns, interpolationPatterns(span.expression, seen)).map(
            (pattern) => pattern + escape(span.literal.text),
          ),
        [escape(node.head.text)],
      );
    const type = checker.getTypeAtLocation(node);
    if (type.flags & ts.TypeFlags.String && ts.isIdentifier(node)) {
      const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
      if (
        declaration &&
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer &&
        ts.isVariableDeclarationList(declaration.parent) &&
        declaration.parent.flags & ts.NodeFlags.Const
      )
        return patternsFor(declaration.initializer, seen);
    }
    return typePatterns(type);
  };
  const interpolationPatterns = (node: ts.Expression, seen: Set<ts.Node>): string[] => {
    const type = checker.getTypeAtLocation(node);
    // JS stringifies arbitrary interpolation values; a fixed surrounding pattern still bounds the resource set.
    if (
      type.flags &
      (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Object | ts.TypeFlags.BooleanLike)
    )
      return ['.*'];
    return patternsFor(node, new Set(seen));
  };
  for (const file of files) {
    // The implementation renders arbitrary keys; consumers carry the namespace and key domain.
    if (
      file.endsWith('/src/libs/i18n/serverTranslation.ts') ||
      file.includes('/src/libs/i18n/server/')
    )
      continue;
    const source = program.getSourceFile(file);
    if (!source) throw new Error(`Missing source file in translation program: ${file}`);
    const visit = (node: ts.Node) => {
      const parent = node.parent;
      if (!parent) {
        ts.forEachChild(node, visit);
        return;
      }
      const isIndirectCall =
        ts.isPropertyAccessExpression(parent) &&
        ['bind', 'call', 'apply'].includes(parent.name.text);
      // Namespace erasure only happens when a value receives a contextual type.
      // Ordinary property reads and inferred bindings do not need semantic queries.
      const canHaveContext =
        !ts.isPropertyAccessExpression(parent) &&
        !ts.isExpressionStatement(parent) &&
        !(ts.isVariableDeclaration(parent) && (!parent.type || parent.name === node)) &&
        !(ts.isParameter(parent) && parent.name === node) &&
        !(ts.isCallExpression(parent) && parent.expression === node);
      if (
        (canHaveContext || isIndirectCall) &&
        (ts.isIdentifier(node) ||
          ts.isPropertyAccessExpression(node) ||
          ts.isCallExpression(node) ||
          ts.isAwaitExpression(node))
      ) {
        const valueType = checker.getTypeAtLocation(node);
        const marker = valueType.getProperty('__serverNamespace');
        const translatorFields = ['t', 'find'].filter((name) => {
          const field = valueType.getProperty(name);
          return (
            field &&
            checker
              .getNonNullableType(checker.getTypeOfSymbolAtLocation(field, node))
              .getProperty('__serverNamespace')
          );
        });
        if (marker || translatorFields.length) {
          const inferredBinding = ts.isVariableDeclaration(node.parent) && !node.parent.type;
          const context = inferredBinding
            ? undefined
            : ts.isAsExpression(node.parent)
              ? checker.getTypeAtLocation(node.parent)
              : checker.getContextualType(node);
          if (context) {
            const target = checker.getNonNullableType(context);
            const erased = marker
              ? !target.getProperty('__serverNamespace')
              : translatorFields.some((name) => {
                  const field = target.getProperty(name);
                  return Boolean(
                    field &&
                    !checker
                      .getNonNullableType(checker.getTypeOfSymbolAtLocation(field, node))
                      .getProperty('__serverNamespace'),
                  );
                });
            if (erased || target.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown))
              throw new Error(
                `Translation namespace erased at ${file}: ${node.getText(source)}; preserve ServerTranslate<N> on the receiving signature`,
              );
          }
          if (
            marker &&
            ts.isPropertyAccessExpression(node.parent) &&
            ['bind', 'call', 'apply'].includes(node.parent.name.text)
          ) {
            throw new Error(
              `Unsupported indirect translation call in ${file}; call the typed translator directly`,
            );
          }
        }
      }
      if (ts.isCallExpression(node)) {
        const functionType = checker.getTypeAtLocation(node.expression);
        const marker = functionType.getProperty('__serverNamespace');
        if (marker) {
          const namespaceType = checker.getNonNullableType(
            checker.getTypeOfSymbolAtLocation(marker, node.expression),
          );
          const namespaces = namespaceType.isUnion() ? namespaceType.types : [namespaceType];
          if (!node.arguments[0]) throw new Error(`Missing translation key in ${file}`);
          for (const namespace of namespaces) {
            if (!namespace.isStringLiteral())
              throw new Error(`Unknown server translation namespace in ${file}`);
            const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
            try {
              const resultType = checker.getTypeAtLocation(node);
              const optional =
                resultType.isUnion() &&
                resultType.types.some((type) => type.flags & ts.TypeFlags.Undefined);
              uses.push({
                file,
                line,
                namespace: namespace.value,
                patterns: patternsFor(node.arguments[0]),
                optional,
              });
            } catch (error) {
              throw new Error(`${file}:${line}: ${String(error)}`, { cause: error });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return uses;
};

export const selectKeys = (keys: string[], patterns: string[]) =>
  keys
    .filter((key) => patterns.some((pattern) => new RegExp(`^(?:${pattern})$`, 's').test(key)))
    .sort();
