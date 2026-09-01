import { isDesktop } from '@lobechat/const';
import { useCallback } from 'react';

import type { DroppedLocalPath } from '@/components/DragUploadZone';
import { insertLocalPathTags } from '@/features/ChatInput/InputEditor/insertLocalFileTags';
import {
  canExecutionTargetReadLocalPaths,
  resolveExecutionTarget,
} from '@/helpers/executionTarget';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { useElectronStore } from '@/store/electron';

/**
 * Whether a drag-dropped local path should become a `<localFile>` reference for
 * this agent's next run, plus the insert handler for the drop zone.
 *
 * A dropped path only makes sense when THIS run executes somewhere that can
 * read this machine's filesystem. Resolve the effective execution target
 * (member override + workspace coercion included) instead of trusting
 * "hetero / local-system" alone — a Claude Code agent whose run lands in the
 * cloud sandbox must fall back to attachment upload, or the agent receives a
 * `/Users/...` path that does not exist in its container.
 */
export const useLocalPathReference = (agentId: string, topicId?: string | null) => {
  const isHeterogeneous = useAgentStore(agentByIdSelectors.isAgentHeterogeneousById(agentId));
  const isLocalSystemEnabled = useAgentStore(
    chatConfigByIdSelectors.isLocalSystemEnabledById(agentId),
  );
  const workingDirectory = useEffectiveWorkingDirectory(agentId, { topicId });
  const { agencyConfig, workspaceScoped } = useEffectiveAgencyConfig(agentId);
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const executionTarget = resolveExecutionTarget(agencyConfig, {
    clientExecutionAvailable: isDesktop,
    isHetero: isHeterogeneous,
    workspaceScoped,
  });
  const enableLocalPathReference =
    isDesktop &&
    !!workingDirectory &&
    (isHeterogeneous || isLocalSystemEnabled) &&
    canExecutionTargetReadLocalPaths(executionTarget, agencyConfig, currentDeviceId);

  const handleLocalPaths = useCallback((paths: DroppedLocalPath[]) => {
    const editor = useChatStore.getState().mainInputEditor?.instance;
    if (!editor) return;
    insertLocalPathTags(editor, paths);
  }, []);

  return { enableLocalPathReference, handleLocalPaths };
};
