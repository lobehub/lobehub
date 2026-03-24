import isEqual from 'fast-deep-equal';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import { useTokenCount } from '@/hooks/useTokenCount';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { lambdaClient } from '@/libs/trpc/client';
import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';

import { type MarketPublishAction } from './types';
import { generateDefaultChangelog } from './utils';

export interface OriginalAgentInfo {
  author?: {
    avatar?: string;
    name?: string;
    userName?: string;
  };
  avatar?: string;
  identifier: string;
  name: string;
}

interface UseMarketPublishOptions {
  action: MarketPublishAction;
  onSuccess?: (identifier: string) => void;
}

export interface CheckOwnershipResult {
  needsForkConfirm: boolean;
  originalAgent: OriginalAgentInfo | null;
}

export const useMarketPublish = ({ action, onSuccess }: UseMarketPublishOptions) => {
  const { t } = useTranslation('setting');
  const [isPublishing, setIsPublishing] = useState(false);
  const [isCheckingOwnership, setIsCheckingOwnership] = useState(false);
  // Use ref to synchronously track publishing state and avoid race conditions caused by closures
  const isPublishingRef = useRef(false);
  const { isAuthenticated } = useMarketAuth();

  // Agent data from store
  const meta = useAgentStore(agentSelectors.currentAgentMeta, isEqual);
  const updateAgentMeta = useAgentStore((s) => s.updateAgentMeta);
  const systemRole = useAgentStore(agentSelectors.currentAgentSystemRole);
  const config = useAgentStore(agentSelectors.currentAgentConfig, isEqual);
  const editorData = config?.editorData;
  const language = useGlobalStore(globalGeneralSelectors.currentLanguage);
  const agentConfig = useAgentStore(agentSelectors.currentAgentConfig);
  const chatConfig = useAgentStore(agentChatConfigSelectors.currentChatConfig);
  const plugins = useAgentStore(agentSelectors.currentAgentPlugins);
  const model = useAgentStore(agentSelectors.currentAgentModel);
  const provider = useAgentStore(agentSelectors.currentAgentModelProvider);
  const tokenUsage = useTokenCount(systemRole);

  const isSubmit = action === 'submit';

  /**
   * Check ownership before publishing
   * Returns whether fork confirmation is needed and original agent info
   */
  const checkOwnership = useCallback(async (): Promise<CheckOwnershipResult> => {
    const identifier = meta?.marketIdentifier;

    // No identifier means new agent, no need to check
    if (!identifier) {
      return { needsForkConfirm: false, originalAgent: null };
    }

    try {
      setIsCheckingOwnership(true);
      const result = await lambdaClient.market.agent.checkOwnership.query({ identifier });

      // If agent doesn't exist or user is owner, no confirmation needed
      if (!result.exists || result.isOwner) {
        return { needsForkConfirm: false, originalAgent: null };
      }

      // User is not owner, need fork confirmation
      return {
        needsForkConfirm: true,
        originalAgent: result.originalAgent as OriginalAgentInfo,
      };
    } catch (error) {
      console.error('[useMarketPublish] Failed to check ownership:', error);
      // On error, proceed without confirmation
      return { needsForkConfirm: false, originalAgent: null };
    } finally {
      setIsCheckingOwnership(false);
    }
  }, [meta?.marketIdentifier]);

  const publish = useCallback(async () => {
    // Prevent duplicate publishing: use ref for synchronous check to avoid race conditions from closures
    if (isPublishingRef.current) {
      return { success: false };
    }

    // Check authentication state - tRPC handles trustedClient automatically
    if (!isAuthenticated) {
      return { success: false };
    }

    const messageKey = isSubmit ? 'submit' : 'upload-version';
    const loadingMessage = isSubmit
      ? t('marketPublish.modal.loading.submit')
      : t('marketPublish.modal.loading.upload');

    const changelog = generateDefaultChangelog();

    try {
      // Set ref immediately to prevent duplicate calls
      isPublishingRef.current = true;
      setIsPublishing(true);
      message.loading({ content: loadingMessage, key: messageKey });

      // Use tRPC publishOrCreate - backend handles ownership check automatically
      const result = await lambdaClient.market.agent.publishOrCreate.mutate({
        avatar: meta?.avatar,
        changelog,
        config: {
          chatConfig: {
            enableHistoryCount: chatConfig?.enableHistoryCount,
            historyCount: chatConfig?.historyCount,
            maxTokens: agentConfig?.params?.max_tokens,
            searchMode: chatConfig?.searchMode,
            temperature: agentConfig?.params?.temperature,
            topP: agentConfig?.params?.top_p,
          },
          description: meta?.description,
          locale: language,
          model: {
            model,
            parameters: agentConfig?.params,
            provider,
          },
          plugins:
            plugins?.map((plugin) => {
              if (typeof plugin === 'string') {
                return plugin;
              } else {
                return null;
              }
            }) || [],
          systemRole,
        },
        description: meta?.description || '',
        editorData,
        // Pass existing identifier; backend will check ownership
        identifier: meta?.marketIdentifier,
        name: meta?.title || '',
        tags: meta?.tags,
        tokenUsage,
      });

      // If a new agent was created, update meta with the new identifier
      if (result.isNewAgent) {
        updateAgentMeta({ marketIdentifier: result.identifier });
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
    agentConfig?.params,
    chatConfig?.enableHistoryCount,
    chatConfig?.historyCount,
    chatConfig?.searchMode,
    editorData,
    isAuthenticated,
    isSubmit,
    language,
    meta?.avatar,
    meta?.description,
    meta?.marketIdentifier,
    meta?.tags,
    meta?.title,
    model,
    onSuccess,
    plugins,
    provider,
    systemRole,
    tokenUsage,
    t,
    updateAgentMeta,
  ]);

  return {
    checkOwnership,
    isCheckingOwnership,
    isPublishing,
    publish,
  };
};
