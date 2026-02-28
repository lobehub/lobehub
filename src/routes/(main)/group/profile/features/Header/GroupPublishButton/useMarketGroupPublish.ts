import isEqual from 'fast-deep-equal';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { lambdaClient } from '@/libs/trpc/client';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';

import { type MarketPublishAction, type OriginalGroupInfo } from './types';
import { generateDefaultChangelog } from './utils';

interface UseMarketGroupPublishOptions {
  action: MarketPublishAction;
  onSuccess?: (identifier: string) => void;
}

export interface CheckOwnershipResult {
  needsForkConfirm: boolean;
  originalGroup: OriginalGroupInfo | null;
}

export const useMarketGroupPublish = ({ action, onSuccess }: UseMarketGroupPublishOptions) => {
  const { t } = useTranslation('setting');
  const [isPublishing, setIsPublishing] = useState(false);
  const [isCheckingOwnership, setIsCheckingOwnership] = useState(false);
  const isPublishingRef = useRef(false);
  const { isAuthenticated } = useMarketAuth();

  // Group data from store
  const currentGroup = useAgentGroupStore(agentGroupSelectors.currentGroup);
  const currentGroupMeta = useAgentGroupStore(agentGroupSelectors.currentGroupMeta, isEqual);
  const currentGroupConfig = useAgentGroupStore(agentGroupSelectors.currentGroupConfig, isEqual);
  const currentGroupAgents = useAgentGroupStore(agentGroupSelectors.currentGroupAgents);
  const updateGroupMeta = useAgentGroupStore((s) => s.updateGroupMeta);
  const language = useGlobalStore(globalGeneralSelectors.currentLanguage);

  const isSubmit = action === 'submit';

  /**
   * Check ownership before publishing
   * Returns whether fork confirmation is needed and original group info
   */
  const checkOwnership = useCallback(async (): Promise<CheckOwnershipResult> => {
    // marketIdentifier is stored at top-level (same as agents)
    const identifier = currentGroup?.marketIdentifier;

    // No identifier means new group, no need to check
    if (!identifier) {
      return { needsForkConfirm: false, originalGroup: null };
    }

    try {
      setIsCheckingOwnership(true);
      const result = await lambdaClient.market.agentGroup.checkOwnership.query({ identifier });

      // If group doesn't exist or user is owner, no confirmation needed
      if (!result.exists || result.isOwner) {
        return { needsForkConfirm: false, originalGroup: null };
      }

      // User is not owner, need fork confirmation
      return {
        needsForkConfirm: true,
        originalGroup: result.originalGroup as OriginalGroupInfo,
      };
    } catch (error) {
      console.error('[useMarketGroupPublish] Failed to check ownership:', error);
      // On error, proceed without confirmation
      return { needsForkConfirm: false, originalGroup: null };
    } finally {
      setIsCheckingOwnership(false);
    }
  }, [currentGroup]);

  const publish = useCallback(async () => {
    // Prevent duplicate publishing
    if (isPublishingRef.current) {
      return { success: false };
    }

    // Check authentication
    if (!isAuthenticated) {
      return { success: false };
    }

    if (!currentGroup) {
      message.error({ content: t('marketPublish.modal.messages.noGroup') });
      return { success: false };
    }

    const messageKey = isSubmit ? 'submit-group' : 'upload-group-version';
    const loadingMessage = isSubmit
      ? t('marketPublish.modal.loading.submitGroup')
      : t('marketPublish.modal.loading.uploadGroup');

    const changelog = generateDefaultChangelog();

    try {
      isPublishingRef.current = true;
      setIsPublishing(true);
      message.loading({ content: loadingMessage, key: messageKey });

      // Prepare member agents data
      const memberAgents = currentGroupAgents.map((agent, index) => ({
        // Only include avatar if it's not null/undefined
        ...(agent.avatar ? { avatar: agent.avatar } : {}),
        config: {
          // Include agent configuration
          model: agent.model,
          params: agent.params,
          systemRole: agent.systemRole,
          // Include plugins if they exist
          ...(agent.plugins && agent.plugins.length > 0 ? { plugins: agent.plugins } : {}),
          // Include provider if it exists
          ...(agent.provider ? { provider: agent.provider } : {}),
          // Include chatConfig if it exists
          ...(agent.chatConfig ? { chatConfig: agent.chatConfig } : {}),
        },
        // Market requires at least 1 character for description
        description: agent.description || 'No description provided',
        displayOrder: index,
        identifier: agent.id, // Use local agent ID as identifier
        name: agent.title || 'Untitled Agent',
        role: agent.isSupervisor ? ('supervisor' as const) : ('participant' as const),
        // TODO: Construct proper A2A URL for the agent
        url: `https://api.lobehub.com/a2a/agents/${agent.id}`,
      }));

      // Use tRPC publishOrCreate
      const result = await lambdaClient.market.agentGroup.publishOrCreate.mutate({
        // Only include avatar if it's not null/undefined
        ...(currentGroupMeta.avatar ? { avatar: currentGroupMeta.avatar } : {}),
        // Only include backgroundColor if it's not null/undefined
        ...(currentGroup.backgroundColor ? { backgroundColor: currentGroup.backgroundColor } : {}),
        category: 'productivity', // TODO: Allow user to select category
        changelog,
        // Include group-level config (systemPrompt from content, openingMessage, etc.)
        config: {
          // Group systemPrompt is stored in currentGroup.content
          ...(currentGroup.content !== undefined &&
            currentGroup.content !== null && {
              systemPrompt: currentGroup.content,
            }),
          ...(currentGroupConfig.openingMessage !== undefined && {
            openingMessage: currentGroupConfig.openingMessage,
          }),
          ...(currentGroupConfig.openingQuestions !== undefined &&
            currentGroupConfig.openingQuestions.length > 0 && {
              openingQuestions: currentGroupConfig.openingQuestions,
            }),
          ...(currentGroupConfig.allowDM !== undefined && { allowDM: currentGroupConfig.allowDM }),
          ...(currentGroupConfig.revealDM !== undefined && {
            revealDM: currentGroupConfig.revealDM,
          }),
        },
        // Market requires at least 1 character for description
        description: currentGroupMeta.description || 'No description provided',
        // marketIdentifier is stored at top-level (same as agents)
        identifier: currentGroup.marketIdentifier,
        memberAgents,
        name: currentGroupMeta.title || 'Untitled Group',
        visibility: 'public', // TODO: Allow user to select visibility
      });

      // Save marketIdentifier at top-level if new group (same as agents)
      if (result.isNewGroup) {
        await updateGroupMeta({
          marketIdentifier: result.identifier,
        });
      }

      message.success({
        content: t('submitAgentModal.success'),
        key: messageKey,
      });

      onSuccess?.(result.identifier);
      return { identifier: result.identifier, success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : t('unknownError', { ns: 'common' });
      message.error({
        content: t('marketPublish.modal.messages.publishFailed', {
          message: errorMessage,
        }),
        key: messageKey,
      });
      return { success: false };
    } finally {
      isPublishingRef.current = false;
      setIsPublishing(false);
    }
  }, [
    currentGroup,
    currentGroupAgents,
    currentGroupConfig,
    currentGroupMeta,
    isAuthenticated,
    isSubmit,
    language,
    onSuccess,
    t,
    updateGroupMeta,
  ]);

  return {
    checkOwnership,
    isCheckingOwnership,
    isPublishing,
    publish,
  };
};
