/**
 * Rewrite a canonical `lobe-*` builtin-tool identifier into this deployment's
 * wire namespace.
 *
 * Duplicated from `@lobechat/context-engine`'s `ToolNameResolver` rather than
 * imported: that package depends on the builtin-tool packages (not the other
 * way around), so pulling it in here risks a cycle for a ~5-line pure
 * function. All copies must read the SAME `BUILTIN_TOOL_ID_NAMESPACE` env var
 * and implement the identical swap, or this prompt's own live-capability
 * check ("is `lobe-local-system` available in this session?") would disagree
 * with what `<available_tools>` actually calls that tool. See
 * `ToolNameResolver.ts`'s `toWireToolIdentifier` doc comment for the full
 * rationale (why the canonical `lobe-*` registry key is never itself
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
