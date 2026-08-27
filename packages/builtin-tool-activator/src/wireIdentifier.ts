/**
 * Rewrite a canonical `lobe-*` builtin-tool identifier into this deployment's
 * wire namespace — shared by `ExecutionRuntime` (lookup/response text) and
 * `systemRole.ts` (hardcoded instruction examples like "activate `lobe-creds`").
 *
 * Duplicated from `@lobechat/context-engine`'s `ToolNameResolver` rather than
 * imported: that package depends on the builtin-tool packages (not the other
 * way around), so pulling it in here risks a cycle for a ~5-line pure
 * function. Both copies must read the SAME `BUILTIN_TOOL_ID_NAMESPACE` env var
 * and implement the identical swap, or `<available_tools>`'s wire identifiers
 * and what this package's own prose tells the model to activate would
 * disagree. See `ToolNameResolver.ts`'s `toWireToolIdentifier` doc comment for
 * the full rationale (why the canonical `lobe-*` registry key is never itself
 * renamed).
 */
const TOOL_ID_NAMESPACE_ENV = 'BUILTIN_TOOL_ID_NAMESPACE';
const CANONICAL_TOOL_ID_NAMESPACE = 'lobe';
const TOOL_ID_NAMESPACE_PATTERN = /^[\w-]+$/;

const getToolIdNamespace = (): string => {
  try {
    const raw = typeof process === 'undefined' ? undefined : process.env?.[TOOL_ID_NAMESPACE_ENV];
    return raw && TOOL_ID_NAMESPACE_PATTERN.test(raw) ? raw : CANONICAL_TOOL_ID_NAMESPACE;
  } catch {
    return CANONICAL_TOOL_ID_NAMESPACE;
  }
};

export const toWireToolIdentifier = (identifier: string): string => {
  const namespace = getToolIdNamespace();
  const prefix = `${CANONICAL_TOOL_ID_NAMESPACE}-`;
  return namespace !== CANONICAL_TOOL_ID_NAMESPACE && identifier.startsWith(prefix)
    ? namespace + identifier.slice(CANONICAL_TOOL_ID_NAMESPACE.length)
    : identifier;
};

export const fromWireToolIdentifier = (identifier: string): string => {
  const namespace = getToolIdNamespace();
  const prefix = `${namespace}-`;
  return namespace !== CANONICAL_TOOL_ID_NAMESPACE && identifier.startsWith(prefix)
    ? CANONICAL_TOOL_ID_NAMESPACE + identifier.slice(namespace.length)
    : identifier;
};
