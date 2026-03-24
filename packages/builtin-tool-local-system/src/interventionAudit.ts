import { type DynamicInterventionResolver } from '@lobechat/types';

import { normalizePathForScope, resolvePathWithScope } from './utils/path';

/**
 * Safe path prefixes that never require user intervention.
 * Operations targeting these directories are considered low-risk
 * because they are ephemeral / world-writable system locations.
 */
const SAFE_PATH_PREFIXES = ['/tmp/', '/tmp', '/var/tmp/', '/var/tmp'];

/**
 * Check if every path in the list targets a known safe location.
 * Returns `true` only when **all** paths fall under a safe prefix.
 */
const areAllPathsSafe = (paths: string[], resolveAgainstScope: string): boolean => {
  if (paths.length === 0) return false;

  return paths.every((p) => {
    const resolved = resolvePathWithScope(p, resolveAgainstScope) ?? p;
    const normalized = normalizePathForScope(resolved);
    return SAFE_PATH_PREFIXES.some(
      (prefix) =>
        normalized === prefix ||
        normalized.startsWith(prefix.endsWith('/') ? prefix : prefix + '/'),
    );
  });
};

/**
 * Check if a path is within the working directory
 */
const isPathWithinWorkingDirectory = (
  targetPath: string,
  workingDirectory: string,
  resolveAgainstScope: string,
): boolean => {
  const resolvedTarget = resolvePathWithScope(targetPath, resolveAgainstScope) ?? targetPath;
  const normalizedTarget = normalizePathForScope(resolvedTarget);
  const normalizedWorkingDir = normalizePathForScope(workingDirectory);

  return (
    normalizedTarget === normalizedWorkingDir ||
    normalizedTarget.startsWith(normalizedWorkingDir + '/')
  );
};

/**
 * Extract all path values from tool arguments
 * Looks for common path parameter names used in local-system tools
 */
const extractPaths = (toolArgs: Record<string, any>): string[] => {
  const paths: string[] = [];
  const pathParamNames = ['path', 'file_path', 'directory', 'oldPath', 'newPath'];

  for (const paramName of pathParamNames) {
    const pathValue = toolArgs[paramName];
    if (pathValue && typeof pathValue === 'string') {
      paths.push(pathValue);
    }
  }

  // Only check 'pattern' when it's an absolute path (e.g. glob like /Users/me/**/*.ts).
  // Relative globs (e.g. **/*.ts) and regex patterns (e.g. TODO|FIXME) are not paths.
  if (typeof toolArgs.pattern === 'string' && toolArgs.pattern.startsWith('/')) {
    paths.push(toolArgs.pattern);
  }

  // Handle 'items' array for moveLocalFiles (contains oldPath/newPath objects)
  if (Array.isArray(toolArgs.items)) {
    for (const item of toolArgs.items) {
      if (typeof item === 'object') {
        if (item.oldPath) paths.push(item.oldPath);
        if (item.newPath) paths.push(item.newPath);
      }
    }
  }

  return paths;
};

/**
 * Path scope audit for local-system tools
 * Returns true if any path is outside the working directory (requires intervention)
 */
export const pathScopeAudit: DynamicInterventionResolver = (
  toolArgs: Record<string, any>,
  metadata?: Record<string, any>,
): boolean => {
  const workingDirectory = metadata?.workingDirectory as string | undefined;
  const toolScope = toolArgs.scope as string | undefined;

  // If no working directory is set, no intervention needed
  if (!workingDirectory) {
    return false;
  }

  // Match runtime behavior: a tool-provided scope is interpreted relative to workingDirectory.
  // If the resolved scope escapes the workingDirectory, intervention is required.
  if (toolScope && !isPathWithinWorkingDirectory(toolScope, workingDirectory, workingDirectory)) {
    return true;
  }

  const effectiveScope =
    resolvePathWithScope(toolScope, workingDirectory) ?? toolScope ?? workingDirectory;

  const paths = extractPaths(toolArgs);

  // Skip intervention when all resolved paths target safe locations (e.g. /tmp)
  if (areAllPathsSafe(paths, effectiveScope)) {
    return false;
  }

  // Return true if any path is outside the working directory
  return paths.some(
    (path) => !isPathWithinWorkingDirectory(path, workingDirectory, effectiveScope),
  );
};
