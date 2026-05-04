import type { ISlashMenuOption } from '@lobehub/editor';
import debug from 'debug';
import { createElement, useCallback, useEffect } from 'react';

import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import { useAgentId } from '../hooks/useAgentId';
import {
  searchProjectFileMentionIndex,
  warmProjectFileMentionIndex,
} from './localFileMentionIndex';
import LocalFileIcon from './MentionMenu/LocalFileIcon';

const LOCAL_SYSTEM_IDENTIFIER = 'lobe-local-system';
const MAX_LOCAL_FILE_MENTION_ITEMS = 20;
const log = debug('chat-input:local-file-mention');

export interface UseLocalFileMentionResult {
  enableLocalFileMention: boolean;
  searchLocalFiles: (matchingString: string) => Promise<ISlashMenuOption[]>;
}

export const useLocalFileMention = (): UseLocalFileMentionResult => {
  const agentId = useAgentId();
  const agentPlugins = useAgentStore((s) => agentByIdSelectors.getAgentPluginsById(agentId)(s));
  const heterogeneousType = useAgentStore(
    (s) => agentByIdSelectors.getAgencyConfigById(agentId)(s)?.heterogeneousProvider?.type,
  );
  const agentWorkingDirectory = useAgentStore((s) =>
    agentByIdSelectors.getAgentWorkingDirectoryById(agentId)(s),
  );
  const topicWorkingDirectory = useChatStore(topicSelectors.currentTopicWorkingDirectory);
  const workingDirectory = topicWorkingDirectory || agentWorkingDirectory;

  const enableLocalFileMention =
    !!heterogeneousType || agentPlugins.includes(LOCAL_SYSTEM_IDENTIFIER);

  useEffect(() => {
    if (!enableLocalFileMention) return;
    warmProjectFileMentionIndex(workingDirectory);
  }, [enableLocalFileMention, workingDirectory]);

  const searchLocalFiles = useCallback(
    async (matchingString: string): Promise<ISlashMenuOption[]> => {
      const keywords = matchingString.trim();
      if (!enableLocalFileMention || !keywords) {
        log('Skip search', {
          enableLocalFileMention,
          hasKeywords: !!keywords,
          matchingString,
          workingDirectory,
        });
        return [];
      }

      try {
        log('Search indexed local files', {
          keywords,
          limit: MAX_LOCAL_FILE_MENTION_ITEMS,
          workingDirectory,
        });
        const files = await searchProjectFileMentionIndex(
          workingDirectory,
          keywords,
          MAX_LOCAL_FILE_MENTION_ITEMS,
        );

        log('Search indexed local files completed', {
          count: files.length,
          results: files.slice(0, 5).map((file) => ({
            isDirectory: file.isDirectory,
            name: file.name,
            path: file.path,
          })),
          workingDirectory,
        });

        return files.map((file) => ({
          icon: createElement(LocalFileIcon, {
            isDirectory: file.isDirectory,
            name: file.name,
          }),
          key: `local-file-${file.path}`,
          label: file.name || file.path,
          metadata: {
            isDirectory: file.isDirectory,
            name: file.name || file.path.split('/').pop() || file.path,
            path: file.path,
            relativePath: file.relativePath,
            timestamp: 0,
            type: 'localFile' as const,
          },
        }));
      } catch (error) {
        console.error('[useLocalFileMention] Failed to search local files:', error);
        return [];
      }
    },
    [enableLocalFileMention, workingDirectory],
  );

  return { enableLocalFileMention, searchLocalFiles };
};
