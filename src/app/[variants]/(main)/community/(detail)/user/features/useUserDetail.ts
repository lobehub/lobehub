'use client';

import { App } from 'antd';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { marketApiService } from '@/services/marketApi';

export type AgentStatusAction = 'publish' | 'unpublish' | 'deprecate';

interface UseUserDetailOptions {
  onMutate?: () => void;
}

export const useUserDetail = ({ onMutate }: UseUserDetailOptions = {}) => {
  const { t } = useTranslation('setting');
  const { message, modal } = App.useApp();
  const { session } = useMarketAuth();

  const handleStatusChange = useCallback(
    async (identifier: string, action: AgentStatusAction) => {
      if (!session?.accessToken) {
        message.error(t('myAgents.errors.notAuthenticated'));
        return;
      }

      const messageKey = `agent-status-${action}`;
      const loadingText = t(`myAgents.actions.${action}Loading` as any);
      const successText = t(`myAgents.actions.${action}Success` as any);
      const errorText = t(`myAgents.actions.${action}Error` as any);

      async function executeStatusChange(identifier: string, action: AgentStatusAction) {
        try {
          message.loading({ content: loadingText, key: messageKey });
          marketApiService.setAccessToken(session!.accessToken);

          switch (action) {
            case 'publish': {
              await marketApiService.publishAgent(identifier);
              break;
            }
            case 'unpublish': {
              await marketApiService.unpublishAgent(identifier);
              break;
            }
            case 'deprecate': {
              await marketApiService.deprecateAgent(identifier);
              break;
            }
          }

          message.success({ content: successText, key: messageKey });
          onMutate?.();
        } catch (error) {
          console.error(`[useUserDetail] ${action} agent error:`, error);
          message.error({
            content: `${errorText}: ${error instanceof Error ? error.message : 'Unknown error'}`,
            key: messageKey,
          });
        }
      }

      // For deprecate action, show confirmation dialog first
      if (action === 'deprecate') {
        modal.confirm({
          cancelText: t('myAgents.actions.cancel'),
          content: t('myAgents.actions.deprecateConfirmContent'),
          okButtonProps: { danger: true },
          okText: t('myAgents.actions.confirmDeprecate'),
          onOk: async () => {
            await executeStatusChange(identifier, action);
          },
          title: t('myAgents.actions.deprecateConfirmTitle'),
        });
        return;
      }

      await executeStatusChange(identifier, action);
    },
    [session?.accessToken, message, modal, t, onMutate],
  );

  return {
    handleStatusChange,
  };
};
