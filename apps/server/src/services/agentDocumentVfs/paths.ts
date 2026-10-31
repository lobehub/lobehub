import { buildDocumentFilename } from '@/database/models/agentDocuments';

import { AgentDocumentVfsError } from './errors';
import type {
  AgentDocumentListOptions,
  AgentDocumentReadResult,
  AgentDocumentStats,
} from './types';

export const LOBE_PATH = './lobe';
export const LOBE_SKILLS_PATH = './lobe/skills';
/**
 * Default cap for VFS directory reads while the public API still returns arrays.
 * Keep this near path constants because it is part of the VFS surface, not storage policy.
 */
export const DEFAULT_LIST_LIMIT = 100;
/**
 * Maximum one-call VFS directory read size.
 * Prevents accidental wide-directory materialization from CLI or tool callers.
 */
export const MAX_LIST_LIMIT = 500;

export const normalizeAgentDocumentPath = (path: string) => {
  const raw = path.trim();
  const withDot =
    raw === '/' ? './' : raw.startsWith('./') ? raw : raw.startsWith('/') ? `.${raw}` : `./${raw}`;
  const collapsed = withDot.replaceAll(/\/+/g, '/');

  if (collapsed.includes('/./') || collapsed.includes('/../') || collapsed.endsWith('/..')) {
    throw new AgentDocumentVfsError(`Invalid VFS path: ${path}`, 'BAD_REQUEST');
  }

  const normalized = collapsed === './' ? './' : collapsed.replace(/\/$/, '');
  return normalized;
};

export const splitAgentDocumentPath = (path: string) =>
  path.replace(/^\.\//, '').split('/').filter(Boolean);

export const buildOrdinaryPath = (parentPath: string, filename: string) =>
  parentPath === './' ? `./${filename}` : `${parentPath}/${filename}`;

export const normalizeOrdinaryDocumentPath = (path: string): string => {
  const segments = splitAgentDocumentPath(path);
  const filename = segments.at(-1);
  if (!filename) return path;

  const parentPath = segments.length === 1 ? './' : `./${segments.slice(0, -1).join('/')}`;
  const normalizedFilename = buildDocumentFilename(filename);
  return buildOrdinaryPath(parentPath, normalizedFilename);
};

export const normalizeListLimit = (limit?: number) => {
  if (limit === undefined) return DEFAULT_LIST_LIMIT;

  // Clamp caller-provided limits so path APIs stay bounded even when invoked by tools.
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIST_LIMIT);
};

export const applyListLimit = <T>(items: T[], options: AgentDocumentListOptions) =>
  items.slice(0, normalizeListLimit(options.limit));

export const isDescendantPath = (parentPath: string, childPath: string) =>
  childPath !== parentPath && childPath.startsWith(`${parentPath}/`);

export const assertNotSelfReferentialCopy = (
  sourcePath: string,
  destinationPath: string,
  sourceNode: AgentDocumentStats,
) => {
  if (sourcePath === destinationPath) {
    throw new AgentDocumentVfsError(`Cannot copy path onto itself: ${sourcePath}`, 'BAD_REQUEST');
  }

  if (sourceNode.type === 'directory' && isDescendantPath(sourcePath, destinationPath)) {
    throw new AgentDocumentVfsError(
      `Cannot copy directory into its own subtree: ${sourcePath} -> ${destinationPath}`,
      'BAD_REQUEST',
    );
  }
};

export const sliceReadContent = (
  content: string,
  loc?: [number, number],
): Omit<AgentDocumentReadResult, 'contentType' | 'path'> => {
  const lines = content.split('\n');
  const totalLineCount = lines.length;
  const totalCharCount = content.length;
  const actualLoc: [number, number] = loc ?? [0, totalLineCount];
  const [startLine, endLine] = actualLoc;
  const selectedLines = lines.slice(startLine, endLine);
  const selectedContent = selectedLines.join('\n');

  return {
    charCount: selectedContent.length,
    content: selectedContent,
    lineCount: selectedLines.length,
    loc: actualLoc,
    totalCharCount,
    totalLineCount,
  };
};
