import { existsSync, realpathSync } from 'node:fs';

import { type DynamicInterventionResolver } from '@lobechat/types';
import path from 'path-browserify-esm';

import { normalizePathForScope, resolvePathWithScope } from './utils/path';

/**
 * Safe path prefixes that can bypass intervention once their real filesystem
 * location is verified to remain inside those same temporary directories.
 * Operations targeting these directories are considered low-risk
 * because they are ephemeral / world-writable system locations.
 */
const SAFE_PATH_PREFIXES = ['/tmp', '/var/tmp'] as const;

const isWithinPathPrefixes = (targetPath: string, prefixes: readonly string[]): boolean =>
  prefixes.some((prefix) => targetPath === prefix || targetPath.startsWith(prefix + '/'));

const resolveSafePathPrefixes = (): string[] => {
  const prefixes = new Set<string>(SAFE_PATH_PREFIXES);

  for (const safePrefix of SAFE_PATH_PREFIXES) {
    try {
      prefixes.add(normalizePathForScope(realpathSync.native(safePrefix)));
    } catch {
      // Ignore missing safe directories and fall back to the lexical prefix.
    }
  }

  return [...prefixes];
};

const SAFE_PATH_REAL_PREFIXES = resolveSafePathPrefixes();

const resolveNearestExistingRealPath = (targetPath: string): string | undefined => {
  let currentPath = targetPath;

  while (true) {
    if (existsSync(currentPath)) {
      try {
        return normalizePathForScope(realpathSync.native(currentPath));
      } catch {
        return undefined;
      }
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) return undefined;
    currentPath = parentPath;
  }
};

/**
 * Check if every path in the list targets a known safe location on disk.
 * Returns `true` only when **all** paths fall under a safe prefix.
 */
const areAllPathsSafe = (paths: string[], resolveAgainstScope: string): boolean => {
  if (paths.length === 0) return false;

  return paths.every((p) => {
    const resolved = resolvePathWithScope(p, resolveAgainstScope) ?? p;
    const normalized = normalizePathForScope(resolved);

    if (!isWithinPathPrefixes(normalized, SAFE_PATH_PREFIXES)) return false;

    const nearestExistingRealPath = resolveNearestExistingRealPath(normalized);
    if (!nearestExistingRealPath) return false;

    return isWithinPathPrefixes(nearestExistingRealPath, SAFE_PATH_REAL_PREFIXES);
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
