'use client';

import { confirmModal } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { marketApiService } from '@/services/marketApi';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

export type AgentStatusAction = 'deprecate';
export type EntityType = 'agent' | 'group';

interface UseUserDetailOptions {
  onMutate?: () => void;
}

export const useUserDetail = ({ onMutate }: UseUserDetailOptions = {}) => {
  const { t } = useTranslation('setting');
  const { message } = App.useApp();
  const { session } = useMarketAuth();
  const enableMarketTrustedClient = useServerConfigStore(
    serverConfigSelectors.enableMarketTrustedClient,
  );

  const handleStatusChange = useCallback(
    async (identifier: string, action: AgentStatusAction, type: EntityType = 'agent') => {
      if (!enableMarketTrustedClient && !session?.accessToken) {
        message.error(t('myAgents.errors.notAuthenticated'));
        return;
      }

      const messageKey = `${type}-status-${action}`;
      const loadingText = t(`myAgents.actions.${action}Loading` as any);
      const successText = t(`myAgents.actions.${action}Success` as any);
      const errorText = t(`myAgents.actions.${action}Error` as any);

      async function executeStatusChange(identifier: string, type: EntityType) {
        try {
          message.loading({ content: loadingText, key: messageKey });

          if (type === 'group') {
            await marketApiService.deprecateAgentGroup(identifier);
          } else {
            await marketApiService.deprecateAgent(identifier);
          }

          message.success({ content: successText, key: messageKey });
          onMutate?.();
        } catch (error) {
          console.error(`[useUserDetail] ${action} ${type} error:`, error);
          message.error({
            content: `${errorText}: ${error instanceof Error ? error.message : 'Unknown error'}`,
            key: messageKey,
          });
        }
      }

      confirmModal({
        cancelText: t('myAgents.actions.cancel'),
        content: t('myAgents.actions.deprecateConfirmContent'),
        okButtonProps: { danger: true },
        okText: t('myAgents.actions.confirmDeprecate'),
        onOk: async () => {
          await executeStatusChange(identifier, type);
        },
        title: t('myAgents.actions.deprecateConfirmTitle'),
      });
    },
    [enableMarketTrustedClient, session?.accessToken, message, t, onMutate],
  );

  return {
    handleStatusChange,
  };
};
