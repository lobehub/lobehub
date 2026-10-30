import type { IconProps } from '@lobehub/ui';
import { BrainIcon, PanelsTopLeftIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type BusinessWorkingSidebarTab,
  useBusinessWorkingSidebarTabs,
} from '@/business/client/features/WorkingSidebarTabs';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { MemoryPane } from './Memory/MemoryPane';

const CLAUDE_MEMORY_TAB_KEY = 'claudeMemory';

export interface ExtraWorkingSidebarTab extends BusinessWorkingSidebarTab {
  icon: IconProps['icon'];
}

interface ExtraWorkingSidebarTabsContext {
  activeAgentId?: string;
  /** The project directory, only while a filesystem (this desktop or a bound device) runs it. */
  environmentWorkingDirectory?: string;
  /** Bound device that serves the filesystem; `undefined` for this desktop. */
  remoteDeviceId?: string;
  topicId?: string;
}

/**
 * Tabs that carry their own pane, mounted beside the built-in ones: Claude
 * Code's project memory when the agent is Claude Code and a project folder is
 * selected, then the business-provided tabs.
 */
export const useExtraWorkingSidebarTabs = ({
  activeAgentId,
  environmentWorkingDirectory,
  remoteDeviceId,
  topicId,
}: ExtraWorkingSidebarTabsContext): ExtraWorkingSidebarTab[] => {
  const { t } = useTranslation('chat');
  const isClaudeCode = useAgentStore(
    (s) => agentSelectors.currentAgentHeterogeneousProviderType(s) === 'claude-code',
  );
  // On desktop the effective directory falls back to Desktop / home when none
  // was chosen. Memory follows a project the user picked, so the tab waits for
  // an explicit folder instead of showing the fallback's memory.
  const selectedDirectory = useEffectiveWorkingDirectory(activeAgentId, { homeFallback: false });
  const memoryDirectory =
    selectedDirectory && selectedDirectory === environmentWorkingDirectory
      ? environmentWorkingDirectory
      : undefined;
  const businessTabs = useBusinessWorkingSidebarTabs({ activeAgentId, topicId });

  return useMemo(
    () => [
      ...(isClaudeCode && memoryDirectory
        ? [
            {
              icon: BrainIcon,
              key: CLAUDE_MEMORY_TAB_KEY,
              label: t('workingPanel.claudeMemory.title'),
              pane: (
                <MemoryPane
                  agentId={activeAgentId}
                  deviceId={remoteDeviceId}
                  key={`${remoteDeviceId ?? 'local'}:${memoryDirectory}`}
                  workingDirectory={memoryDirectory}
                />
              ),
            },
          ]
        : []),
      ...businessTabs.map((tab) => ({ icon: PanelsTopLeftIcon, ...tab })),
    ],
    [activeAgentId, businessTabs, isClaudeCode, memoryDirectory, remoteDeviceId, t],
  );
};
