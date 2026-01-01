import isEqual from 'fast-deep-equal';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import { checkOwnership } from '@/hooks/useAgentOwnershipCheck';
import { useTokenCount } from '@/hooks/useTokenCount';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { marketApiService } from '@/services/marketApi';
import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';

import type { MarketPublishAction } from './types';
import { generateDefaultChangelog, generateMarketIdentifier } from './utils';

interface UseMarketPublishOptions {
  action: MarketPublishAction;
  onSuccess?: (identifier: string) => void;
}

export const useMarketPublish = ({ action, onSuccess }: UseMarketPublishOptions) => {
  const { t } = useTranslation('setting');
  const [isPublishing, setIsPublishing] = useState(false);
  // 使用 ref 来同步跟踪发布状态，避免闭包导致的竞态问题
  const isPublishingRef = useRef(false);
  const { isAuthenticated, session, getCurrentUserInfo } = useMarketAuth();
  const enableMarketTrustedClient = useServerConfigStore(serverConfigSelectors.enableMarketTrustedClient);

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
    // 防止重复发布：使用 ref 同步检查，避免闭包导致的竞态问题
    if (isPublishingRef.current) {
      return { success: false };
    }

    // 如果启用了 trustedClient，只需要检查 isAuthenticated
    // 因为后端会自动注入 trustedClientToken
    if (!isAuthenticated || (!enableMarketTrustedClient && !session?.accessToken)) {
      return { success: false };
    }

    const messageKey = isSubmit ? 'submit' : 'upload-version';
    const loadingMessage = isSubmit
      ? t('marketPublish.modal.loading.submit')
      : t('marketPublish.modal.loading.upload');

    let identifier = meta?.marketIdentifier;

    const changelog = generateDefaultChangelog();

    try {
      // 立即设置 ref，防止重复调用
      isPublishingRef.current = true;
      setIsPublishing(true);
      message.loading({ content: loadingMessage, key: messageKey });
      // 只有在非 trustedClient 模式下才需要设置 accessToken
      if (session?.accessToken) {
        marketApiService.setAccessToken(session.accessToken);
      }

      // 判断是否需要创建新 agent
      let needsCreateAgent = false;

      if (!identifier) {
        // 没有 marketIdentifier，需要创建新 agent
        needsCreateAgent = true;
      } else if (isSubmit) {
        // 有 marketIdentifier 且是 submit 操作，需要检查是否是自己的 agent
        const userInfo = getCurrentUserInfo?.() ?? session?.userInfo;
        const accountId = userInfo?.accountId;

        if (accountId) {
          const isOwner = await checkOwnership({
            accessToken: session?.accessToken,
            accountId,
            enableMarketTrustedClient,
            marketIdentifier: identifier,
          });

          if (!isOwner) {
            // 不是自己的 agent，需要创建新的
            needsCreateAgent = true;
          }
        } else {
          // 无法获取用户 ID，为安全起见创建新 agent
          needsCreateAgent = true;
        }
      }

      if (needsCreateAgent) {
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

      // 只有在首次创建 agent 时才需要更新 meta
      if (needsCreateAgent) {
        updateAgentMeta({ marketIdentifier: identifier });
      }

      message.success({
        content: t('submitAgentModal.success'),
        key: messageKey,
      });

      onSuccess?.(identifier!);
      return { identifier, success: true };
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
    enableMarketTrustedClient,
    getCurrentUserInfo,
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
    session?.userInfo,
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
