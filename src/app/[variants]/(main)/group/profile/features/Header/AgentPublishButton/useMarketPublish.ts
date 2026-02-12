import isEqual from 'fast-deep-equal';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import { useTokenCount } from '@/hooks/useTokenCount';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { marketApiService } from '@/services/marketApi';
import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';

import { type MarketPublishAction } from './types';
import { generateDefaultChangelog, generateMarketIdentifier } from './utils';

interface UseMarketPublishOptions {
  action: MarketPublishAction;
  onSuccess?: (identifier: string) => void;
}

export const useMarketPublish = ({ action, onSuccess }: UseMarketPublishOptions) => {
  const { t } = useTranslation('setting');
  const [isPublishing, setIsPublishing] = useState(false);
  const { isAuthenticated, session } = useMarketAuth();

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

  const publish = useCallback(async () => {
    if (!isAuthenticated || !session?.accessToken) {
      return { success: false };
    }

    const messageKey = isSubmit ? 'submit' : 'upload-version';
    const loadingMessage = isSubmit
      ? t('marketPublish.modal.loading.submit')
      : t('marketPublish.modal.loading.upload');

    let identifier = meta?.marketIdentifier;
    const changelog = generateDefaultChangelog();

    try {
      setIsPublishing(true);
      message.loading({ content: loadingMessage, key: messageKey });
      marketApiService.setAccessToken(session.accessToken);

      if (isSubmit) {
        identifier = generateMarketIdentifier();

        try {
          await marketApiService.getAgentDetail(identifier);
        } catch {
          const createPayload: Record<string, unknown> = {
            identifier,
            name: meta?.title || '',
          };
          await marketApiService.createAgent(createPayload as any);
        }
      } else if (!identifier) {
        message.error({
          content: t('marketPublish.modal.messages.missingIdentifier'),
          key: messageKey,
        });
        return { success: false };
      }

      const versionPayload = {
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
          systemRole: systemRole,
        },
        description: meta?.description || '',
        editorData: editorData,
        identifier: identifier,
        name: meta?.title || '',
        tags: meta?.tags,
        tokenUsage: tokenUsage,
      };

      try {
        await marketApiService.createAgentVersion(versionPayload);
      } catch (versionError) {
        const errorMessage =
          versionError instanceof Error
            ? versionError.message
            : t('unknownError', { ns: 'common' });
        message.error({
          content: t('marketPublish.modal.messages.createVersionFailed', {
            message: errorMessage,
          }),
          key: messageKey,
        });
        return { success: false };
      }

      if (isSubmit) {
        updateAgentMeta({ marketIdentifier: identifier });
      }

      message.success({
        content: t('submitAgentModal.success'),
        key: messageKey,
      });

      onSuccess?.(identifier!);
      return { identifier, success: true };
    } catch (error) {
      console.error('Market publish failed:', error);
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
    session?.accessToken,
    systemRole,
    tokenUsage,
    t,
    updateAgentMeta,
  ]);

  return {
    isPublishing,
    publish,
  };
};
