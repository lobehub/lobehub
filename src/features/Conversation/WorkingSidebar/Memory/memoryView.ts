import type { DeviceClaudeCodeMemoryFile } from '@lobechat/types';

/** Claude Code's memory types, in the order the pane lists them. */
const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const;

export type MemoryGroupKey = 'other' | (typeof MEMORY_TYPES)[number];

export interface MemoryGroup {
  files: DeviceClaudeCodeMemoryFile[];
  key: MemoryGroupKey;
}

const isMemoryType = (type: string | undefined): type is (typeof MEMORY_TYPES)[number] =>
  !!type && (MEMORY_TYPES as readonly string[]).includes(type);

/** The `MEMORY.md` index, which the pane offers from its toolbar, not as a memory. */
export const findMemoryIndex = (
  files: DeviceClaudeCodeMemoryFile[],
): DeviceClaudeCodeMemoryFile | undefined => files.find((file) => file.isIndex);

/**
 * Group the memories the way Claude Code types them: one group per frontmatter
 * type, then anything untyped. The index is left out, empty groups are dropped,
 * and each group lists its most recently updated memory first.
 */
export const groupMemoryFiles = (files: DeviceClaudeCodeMemoryFile[]): MemoryGroup[] => {
  const buckets = new Map<MemoryGroupKey, DeviceClaudeCodeMemoryFile[]>();

  for (const file of files) {
    if (file.isIndex) continue;
    const key: MemoryGroupKey = isMemoryType(file.type) ? file.type : 'other';
    const bucket = buckets.get(key) ?? [];
    bucket.push(file);
    buckets.set(key, bucket);
  }

  return ([...MEMORY_TYPES, 'other'] as const)
    .filter((key) => buckets.has(key))
    .map((key) => ({
      files: buckets.get(key)!.toSorted((a, b) => b.updatedAt - a.updatedAt),
      key,
    }));
};

const HOME_PREFIX =
  /^(?:\/home\/[^/]+|\/Users\/[^/]+|\/root|[A-Z]:[/\\]Users[/\\][^/\\]+)(?=[/\\]|$)/i;
const PROJECT_KEY = /([/\\]projects[/\\])[^/\\]+(?=[/\\]memory[/\\]?$)/;

/**
 * The memory directory as the toolbar shows it: the home directory as `~`, and
 * the project key — a mangled copy of the project path the pane is already
 * scoped to — as `…`, so the meaningful `memory` end survives a narrow panel.
 */
export const shortenMemoryDir = (memoryDir: string): string =>
  memoryDir.replace(HOME_PREFIX, '~').replace(PROJECT_KEY, '$1…');

/**
 * Where a memory file opens: the local-file portal, rooted at the memory
 * directory the scan approved (which is also what lets the portal save it), and
 * marked external so the tab stays visible in a topic scoped to the project.
 */
export const memoryFilePortalTarget = (
  file: DeviceClaudeCodeMemoryFile,
  memoryDir: string,
  deviceId: string | undefined,
) => ({
  allowExternalFilePreview: true,
  deviceId,
  filePath: file.path,
  workingDirectory: memoryDir,
});
