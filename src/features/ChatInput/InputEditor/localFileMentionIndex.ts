import type { ProjectFileIndexEntry } from '@lobechat/electron-client-ipc';
import debug from 'debug';

import { projectFileService } from '@/services/projectFile';

const log = debug('chat-input:local-file-mention:index');

export const searchProjectFileMentionIndex = async (
  scope: string | undefined,
  query: string,
  limit: number,
  deviceId?: string,
): Promise<ProjectFileIndexEntry[]> => {
  if (!scope) return [];

  const startedAt = Date.now();
  const result = await projectFileService.searchProjectFiles({ deviceId, limit, query, scope });

  log('Searched project files for mention menu', {
    count: result?.entries.length ?? 0,
    duration: Date.now() - startedAt,
    query,
    root: result?.root,
    source: result?.source,
  });

  return result?.entries.filter((entry) => !entry.isDirectory) ?? [];
};
