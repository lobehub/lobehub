import type { DynamicInterventionResolver } from '@lobechat/types';

import { normalizePathForScope } from './utils/path';

/**
 * Check if a path is within the working directory
 */
const isPathWithinWorkingDirectory = (targetPath: string, workingDirectory: string): boolean => {
  const normalizedTarget = normalizePathForScope(targetPath);
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
 * Path scope resolver for local-system tools
 * Returns true if any path is outside the working directory (requires intervention)
 */
export const pathScopeResolver: DynamicInterventionResolver = (
  toolArgs: Record<string, any>,
  metadata?: Record<string, any>,
): boolean => {
  const workingDirectory = metadata?.workingDirectory as string | undefined;

  // If no working directory is set, no intervention needed
  if (!workingDirectory) {
    return false;
  }

  const paths = extractPaths(toolArgs);

  // Return true if any path is outside the working directory
  return paths.some((path) => !isPathWithinWorkingDirectory(path, workingDirectory));
};
