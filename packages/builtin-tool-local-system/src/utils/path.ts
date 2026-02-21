import path from 'path-browserify-esm';

const normalizeDriveLetter = (input: string): string =>
  input.replace(/^[A-Z]:/i, (match) => match.toLowerCase());

const toNormalizedAbsolute = (input: string): string => {
  const trimmed = input.trim();
  const withPosixSeparators = trimmed.replaceAll('\\', '/');
  const withNormalizedDrive = normalizeDriveLetter(withPosixSeparators);

  if (withNormalizedDrive === '') return '/';

  const hasDriveLetter = /^[A-Z]:/i.test(withNormalizedDrive);
  const hasLeadingSlash = withNormalizedDrive.startsWith('/');
  const absolutePath =
    hasDriveLetter || hasLeadingSlash ? withNormalizedDrive : `/${withNormalizedDrive}`;

  return path.normalize(absolutePath);
};

export const normalizePathForScope = (input: string): string => {
  const normalized = toNormalizedAbsolute(input);
  return normalized.length > 1 && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
};

/**
 * Resolve a path against a scope (CWD).
 * - No path provided → use scope as default
 * - Absolute path → use as-is, ignore scope
 * - Relative path → join with scope
 * - No scope → return path as-is
 */
export const resolvePathWithScope = (
  inputPath: string | undefined,
  scope: string | undefined,
): string | undefined => {
  if (!scope) return inputPath;
  if (!inputPath) return scope;
  if (path.isAbsolute(inputPath)) return inputPath;
  return path.join(scope, inputPath);
};

/**
 * Resolve a `scope`-bearing args object, filling the target path field from scope.
 * Returns a shallow copy only if the path field was actually changed.
 */
export const resolveArgsWithScope = <T extends { scope?: string }>(
  args: T,
  pathField: string,
  fallbackScope?: string,
): T => {
  const scope = args.scope || fallbackScope;
  const currentPath = (args as Record<string, any>)[pathField] as string | undefined;
  const resolved = resolvePathWithScope(currentPath, scope);
  if (resolved === currentPath) return args;
  return { ...args, [pathField]: resolved };
};
