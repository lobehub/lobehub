import ts from 'typescript';

import { DEFAULT_NAMESPACE_MARKER } from './marker';

export interface TranslationUse {
  file: string;
  line: number;
  namespace: string;
  optional: boolean;
  patterns: string[];
}

export interface DynamicKeyEntry {
  file: string;
  namespace: string;
  reason: string;
}

export interface ExtractTranslationUsesOptions {
  contextOption?: string;
  contextSeparator?: string;
  countOption?: string;
  marker?: string;
  namespaceOption?: string;
  namespaceSeparator?: string;
  pluralSeparator?: string;
  skip?: (file: string) => boolean;
  translatorFields?: string[];
}

export const i18nextPreset = {
  contextOption: 'context',
  countOption: 'count',
  marker: '$TFunctionBrand',
  namespaceOption: 'ns',
  namespaceSeparator: ':',
  translatorFields: ['t'],
} satisfies ExtractTranslationUsesOptions;

export const UNBOUNDED_PATTERN = '.*';

export const assertBoundedTranslationUses = (
  uses: TranslationUse[],
  allowlist: DynamicKeyEntry[],
) => {
  for (const use of uses) {
    if (
      use.patterns.includes(UNBOUNDED_PATTERN) &&
      !allowlist.some((entry) => entry.file === use.file && entry.namespace === use.namespace)
    )
      throw new Error(
        `${use.file}:${use.line}: unbounded dynamic translation key in ${use.namespace}; use a fixed prefix, a finite key type, or an explicit allowlist entry`,
      );
  }
};

const escape = (value: string) => value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
const product = (left: string[], right: string[]) => left.flatMap((a) => right.map((b) => a + b));
const INDIRECT_CALLS = new Set(['apply', 'bind', 'call']);
const PLURAL_CATEGORIES = 'zero|one|two|few|many|other';
const unwrapAssertions = (node: ts.Expression): ts.Expression =>
  ts.isAsExpression(node) ||
  ts.isTypeAssertionExpression(node) ||
  ts.isSatisfiesExpression(node) ||
  ts.isNonNullExpression(node) ||
  ts.isParenthesizedExpression(node)
    ? unwrapAssertions(node.expression)
    : node;
// Other initializers are already summarized by the use-site type, which also carries flow narrowing.
const tracesKeyText = (initializer: ts.Expression) => {
  const node = unwrapAssertions(initializer);
  return ts.isStringLiteralLike(node) || ts.isTemplateExpression(node) || ts.isIdentifier(node);
};
const OPAQUE_INTERPOLATION =
  ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Object | ts.TypeFlags.BooleanLike;

// Patterns are anchored at selection time. Unknown strings deliberately retain every matching key.
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
  if (type.flags & (ts.TypeFlags.String | ts.TypeFlags.Number)) return [UNBOUNDED_PATTERN];
  throw new Error(
    `Cannot statically classify translation key (type flags ${type.flags}); declare a string or template-literal key domain`,
  );
};

export const extractTranslationUses = (
  program: ts.Program,
  files: string[],
  {
    contextOption,
    contextSeparator = '_',
    countOption,
    marker: markerName = DEFAULT_NAMESPACE_MARKER,
    namespaceOption,
    namespaceSeparator,
    pluralSeparator = '_',
    skip,
    translatorFields = ['t', 'find'],
  }: ExtractTranslationUsesOptions = {},
): TranslationUse[] => {
  const checker = program.getTypeChecker();
  const uses: TranslationUse[] = [];
  const markerOf = (type: ts.Type) => type.getProperty(markerName);
  const fieldHasMarker = (type: ts.Type, name: string, location: ts.Node) => {
    const field = type.getProperty(name);
    if (!field) return undefined;
    return Boolean(
      markerOf(checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(field, location))),
    );
  };
  const patternsFor = (node: ts.Expression, seen = new Set<ts.Node>()): string[] => {
    if (seen.has(node)) throw new Error('Cyclic translation key initializer');
    seen.add(node);
    if (unwrapAssertions(node) !== node) return patternsFor(unwrapAssertions(node), seen);
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
        declaration.parent.flags & ts.NodeFlags.Const &&
        tracesKeyText(declaration.initializer)
      )
        return patternsFor(declaration.initializer, seen);
    }
    return typePatterns(type);
  };
  // JS stringifies arbitrary interpolation values; a fixed surrounding pattern still bounds the resource set.
  const stringifiedPatterns = (type: ts.Type): string[] | undefined => {
    if (type.flags & ts.TypeFlags.Undefined) return ['undefined'];
    if (type.flags & ts.TypeFlags.Null) return ['null'];
    if (type.flags & OPAQUE_INTERPOLATION) return [UNBOUNDED_PATTERN];
  };
  const interpolationPatterns = (node: ts.Expression, seen: Set<ts.Node>): string[] => {
    const type = checker.getTypeAtLocation(node);
    const direct = stringifiedPatterns(type);
    if (direct) return direct;
    if (type.isUnion() && type.types.some(stringifiedPatterns))
      return [
        ...new Set(type.types.flatMap((part) => stringifiedPatterns(part) ?? typePatterns(part))),
      ];
    return patternsFor(node, new Set(seen));
  };
  for (const file of files) {
    if (skip?.(file)) continue;
    const source = program.getSourceFile(file);
    if (!source) throw new Error(`Missing source file in translation program: ${file}`);
    const assertNamespacePreserved = (node: ts.Expression) => {
      const valueType = checker.getTypeAtLocation(node);
      const marker = markerOf(valueType);
      const markedFields = translatorFields.filter((name) => fieldHasMarker(valueType, name, node));
      if (!marker && !markedFields.length) return;
      const inferredBinding = ts.isVariableDeclaration(node.parent) && !node.parent.type;
      const context = inferredBinding
        ? undefined
        : ts.isAsExpression(node.parent)
          ? checker.getTypeAtLocation(node.parent)
          : checker.getContextualType(node);
      // An unknown-typed list element (e.g. a hook dependency list) cannot be called without a cast.
      if (
        context &&
        ts.isArrayLiteralExpression(node.parent) &&
        context.flags & ts.TypeFlags.Unknown
      )
        return;
      if (context) {
        const target = checker.getNonNullableType(context);
        const erased = marker
          ? !markerOf(target)
          : markedFields.some((name) => fieldHasMarker(target, name, node) === false);
        if (erased || target.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown))
          throw new Error(
            `Translation namespace erased at ${file}: ${node.getText(source)}; preserve the ${markerName} marker on the receiving type`,
          );
      }
      if (
        marker &&
        ts.isPropertyAccessExpression(node.parent) &&
        INDIRECT_CALLS.has(node.parent.name.text)
      )
        throw new Error(
          `Unsupported indirect translation call in ${file}; call the typed translator directly`,
        );
    };
    const namespaceTypes = (type: ts.Type) => {
      const parts = (type.isUnion() ? type.types : [type]).filter(
        (part) => !(part.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)),
      );
      return {
        literals: parts.map((part) => (part.isStringLiteral() ? part.value : undefined)),
        omittable: parts.length < (type.isUnion() ? type.types.length : 1),
      };
    };
    const optionType = (node: ts.CallExpression, name: string | undefined) => {
      const options = node.arguments[1];
      if (!name || !options) return;
      const option = checker.getTypeAtLocation(options).getProperty(name);
      if (!option) return;
      // Object literal properties widen without a contextual type; the initializer keeps its literal.
      const declaration = ts.isObjectLiteralExpression(options)
        ? options.properties.find((property) => property.name?.getText(source) === name)
        : undefined;
      return {
        optional: !declaration && Boolean(option.flags & ts.SymbolFlags.Optional),
        type:
          declaration && ts.isPropertyAssignment(declaration)
            ? checker.getTypeAtLocation(declaration.initializer)
            : declaration && ts.isShorthandPropertyAssignment(declaration)
              ? checker.getTypeAtLocation(declaration.name)
              : checker.getTypeOfSymbolAtLocation(option, options),
      };
    };
    const callNamespaces = (node: ts.CallExpression) => {
      const marker = markerOf(checker.getTypeAtLocation(node.expression));
      if (!marker) return;
      const branded = namespaceTypes(
        checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(marker, node.expression)),
      ).literals;
      const option = optionType(node, namespaceOption);
      if (!option) return branded;
      const { literals, omittable } = namespaceTypes(option.type);
      return omittable || option.optional ? [...new Set([...literals, ...branded])] : literals;
    };
    // i18next also tries `key_<context>` and `key[_<context>]_[ordinal_]<plural category>`, falling back to `key`.
    const lookupSuffix = (node: ts.CallExpression) => {
      let suffix = '';
      const context = optionType(node, contextOption);
      const contextType = context && checker.getNonNullableType(context.type);
      if (contextType && !(contextType.flags & ts.TypeFlags.Never))
        suffix += `(?:${escape(contextSeparator)}(?:${typePatterns(contextType).join('|')}))?`;
      const count = optionType(node, countOption);
      const countType = count && checker.getNonNullableType(count.type);
      const countParts = countType?.isUnion() ? countType.types : countType ? [countType] : [];
      if (countParts.some((part) => !(part.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.Never))))
        suffix += `(?:${escape(pluralSeparator)}(?:ordinal${escape(pluralSeparator)})?(?:${PLURAL_CATEGORIES}))?`;
      return suffix;
    };
    const prefixPattern = namespaceSeparator
      ? new RegExp(`^([A-Za-z_][\\w-]*)${escape(escape(namespaceSeparator))}([^]*)$`)
      : undefined;
    const recordCall = (node: ts.CallExpression) => {
      const namespaces = callNamespaces(node);
      if (!namespaces) return;
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      if (!node.arguments[0]) throw new Error(`${file}:${line}: missing translation key`);
      let patterns: string[];
      let optional: boolean;
      try {
        const resultType = checker.getTypeAtLocation(node);
        optional =
          resultType.isUnion() &&
          resultType.types.some((type) => type.flags & ts.TypeFlags.Undefined);
        const suffix = lookupSuffix(node);
        patterns = patternsFor(node.arguments[0]).map((pattern) => pattern + suffix);
      } catch (error) {
        throw new Error(`${file}:${line}: ${String(error)}`, { cause: error });
      }
      for (const namespace of namespaces) {
        if (namespace === undefined)
          throw new Error(
            `${file}:${line}: unknown translation namespace; make sure the declaration that types the translator (such as i18next CustomTypeOptions) is part of the program`,
          );
        const grouped = new Map<string, string[]>();
        for (const pattern of patterns) {
          const prefixed = prefixPattern?.exec(pattern);
          const target = prefixed ? prefixed[1] : namespace;
          grouped.set(target, [...(grouped.get(target) ?? []), prefixed ? prefixed[2] : pattern]);
        }
        for (const [target, keys] of grouped)
          uses.push({ file, line, namespace: target, optional, patterns: keys });
      }
    };
    const visit = (node: ts.Node) => {
      const parent = node.parent;
      if (parent) {
        const isIndirectCall =
          ts.isPropertyAccessExpression(parent) && INDIRECT_CALLS.has(parent.name.text);
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
        )
          assertNamespacePreserved(node);
        if (ts.isCallExpression(node)) recordCall(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return uses;
};

export const selectKeys = (keys: string[], patterns: string[]) => {
  const matchers = patterns.map((pattern) => new RegExp(`^(?:${pattern})$`, 's'));
  return keys.filter((key) => matchers.some((matcher) => matcher.test(key))).sort();
};
