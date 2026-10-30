import type { DeviceClaudeCodeMemoryFile } from '@lobechat/types';

/** Claude Code's memory types, in the order the pane lists them. */
const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const;

export type MemoryGroupKey = 'index' | 'other' | (typeof MEMORY_TYPES)[number];

export interface MemoryGroup {
  files: DeviceClaudeCodeMemoryFile[];
  key: MemoryGroupKey;
}

const isMemoryType = (type: string | undefined): type is (typeof MEMORY_TYPES)[number] =>
  !!type && (MEMORY_TYPES as readonly string[]).includes(type);

/**
 * Group memory files the way Claude Code organizes them: the `MEMORY.md` index,
 * then one group per frontmatter type, then anything untyped. Empty groups are
 * dropped; files keep their scan order within a group.
 */
export const groupMemoryFiles = (files: DeviceClaudeCodeMemoryFile[]): MemoryGroup[] => {
  const buckets = new Map<MemoryGroupKey, DeviceClaudeCodeMemoryFile[]>();

  for (const file of files) {
    const key: MemoryGroupKey = file.isIndex
      ? 'index'
      : isMemoryType(file.type)
        ? file.type
        : 'other';
    const bucket = buckets.get(key) ?? [];
    bucket.push(file);
    buckets.set(key, bucket);
  }

  return (['index', ...MEMORY_TYPES, 'other'] as const)
    .filter((key) => buckets.has(key))
    .map((key) => ({ files: buckets.get(key)!, key }));
};

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
