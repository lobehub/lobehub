import type { ISlashMenuOption } from '@lobehub/editor';
import debug from 'debug';
import { createElement, useCallback } from 'react';

import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import { projectFileService } from '@/services/projectFile';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useElectronStore } from '@/store/electron';

import { useAgentId } from '../hooks/useAgentId';
import { compactDirectoryTail, compactFileName } from './MentionMenu/localFileDisplay';
import LocalFileIcon from './MentionMenu/LocalFileIcon';

const MAX_LOCAL_FILE_TAG_ITEMS = 20;
const log = debug('chat-input:local-file-tag');

export interface UseLocalFileTagResult {
  enableLocalFileTag: boolean;
  searchLocalFiles: (matchingString: string) => Promise<ISlashMenuOption[]>;
}

export const useLocalFileTag = (): UseLocalFileTagResult => {
  const agentId = useAgentId();
  const agencyConfig = useAgentStore(agentByIdSelectors.getAgencyConfigById(agentId));
  const heterogeneousType = agencyConfig?.heterogeneousProvider?.type;
  const isLocalSystemEnabled = useAgentStore(
    chatConfigByIdSelectors.isLocalSystemEnabledById(agentId),
  );
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const agentWorkingDirectory = useAgentStore((s) =>
    agentByIdSelectors.getAgentWorkingDirectoryById(agentId, currentDeviceId)(s),
  );
  const topicWorkingDirectory = useChatStore(topicSelectors.currentTopicWorkingDirectory);
  const workingDirectory = topicWorkingDirectory || agentWorkingDirectory;
  const targetDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId);
  const searchDeviceId =
    targetDeviceId && targetDeviceId !== currentDeviceId ? targetDeviceId : undefined;

  const enableLocalFileTag = !!heterogeneousType || isLocalSystemEnabled;

  const searchLocalFiles = useCallback(
    async (matchingString: string): Promise<ISlashMenuOption[]> => {
      const keywords = matchingString.trim();
      if (!enableLocalFileTag || !keywords) {
        log('Skip search', {
          enableLocalFileTag,
          hasKeywords: !!keywords,
          matchingString,
          workingDirectory,
        });
        return [];
      }

      try {
        log('Search indexed local files', {
          keywords,
          limit: MAX_LOCAL_FILE_TAG_ITEMS,
          workingDirectory,
        });
        if (!workingDirectory) return [];

        const result = await projectFileService.searchProjectFiles({
          deviceId: searchDeviceId,
          limit: MAX_LOCAL_FILE_TAG_ITEMS,
          query: keywords,
          scope: workingDirectory,
        });
        const files = result?.entries.filter((entry) => !entry.isDirectory) ?? [];

        log('Search indexed local files completed', {
          count: files.length,
          results: files.slice(0, 5).map((file) => ({
            isDirectory: file.isDirectory,
            name: file.name,
            path: file.path,
          })),
          root: result?.root,
          source: result?.source,
          workingDirectory,
        });

        return files.map((file) => {
          const name = file.name || file.path.split('/').pop() || file.path;
          const displayPath = file.relativePath || file.path;
          const description = compactDirectoryTail(displayPath, name, file.isDirectory);

          return {
            icon: createElement(LocalFileIcon, {
              isDirectory: file.isDirectory,
              name,
            }),
            key: `local-file-${file.path}`,
            label: compactFileName(name),
            metadata: {
              ...(description ? { description } : {}),
              isDirectory: file.isDirectory,
              name,
              path: file.path,
              relativePath: file.relativePath,
              timestamp: 0,
              type: 'localFile' as const,
            },
          };
        });
      } catch (error) {
        console.error('[useLocalFileTag] Failed to search local files:', error);
        return [];
      }
    },
    [enableLocalFileTag, searchDeviceId, workingDirectory],
  );

  return { enableLocalFileTag, searchLocalFiles };
};
