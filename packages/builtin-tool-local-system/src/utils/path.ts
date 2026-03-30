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
/**
 * System paths that are always allowed (e.g. /tmp for temporary files)
 */
const ALWAYS_ALLOWED_PATHS = ['/tmp'];

/**
 * Check if a path is within the working directory or an always-allowed path.
 * When `resolveAgainstScope` is provided, relative `targetPath` is resolved against it.
 */
export const isPathWithinScope = (
  targetPath: string,
  workingDirectory: string,
  resolveAgainstScope?: string,
): boolean => {
  const resolvedTarget =
    resolvePathWithScope(targetPath, resolveAgainstScope ?? workingDirectory) ?? targetPath;
  const normalizedTarget = normalizePathForScope(resolvedTarget);
  const normalizedWorkingDir = normalizePathForScope(workingDirectory);

  // Allow if within working directory
  if (
    normalizedTarget === normalizedWorkingDir ||
    normalizedTarget.startsWith(normalizedWorkingDir + '/')
  ) {
    return true;
  }

  // Allow system temp directories
  return ALWAYS_ALLOWED_PATHS.some((allowed) => {
    const normalizedAllowed = normalizePathForScope(allowed);
    return (
      normalizedTarget === normalizedAllowed || normalizedTarget.startsWith(normalizedAllowed + '/')
    );
  });
};

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
