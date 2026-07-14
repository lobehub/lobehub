import { ModelIcon } from '@lobehub/icons';
import { Center, Skeleton, Tag, Tooltip } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type BusinessModelModeConfig,
  useBusinessModelModeConfig,
} from '@/business/client/hooks/useBusinessAgentMode';
import type { HomeNewModelItem } from '@/business/client/hooks/useHomeNewModels';
import { useHomeNewModels } from '@/business/client/hooks/useHomeNewModels';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { agentService } from '@/services/agent';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import { useResolvedHomeAgentId } from '../AgentSelect/useResolvedHomeAgentId';
import { trackHomeModelShortcutClicked } from './starterListAnalytics';
import { useStarterModelDefaults } from './useStarterModelDefaults';

const styles = createStaticStyles(({ css, cssVar }) => ({
  button: css`
    height: 40px;
    border-color: ${cssVar.colorFillSecondary};
    background: transparent;
    box-shadow: none !important;

    &:hover {
      border-color: ${cssVar.colorFillSecondary} !important;
      background: ${cssVar.colorBgElevated} !important;
    }
  `,
  container: css`
    flex-wrap: wrap;
  `,
  newTag: css`
    padding-inline: 10px !important;
    border-radius: 999px !important;
  `,
}));

const getStarterItemKey = (item: HomeNewModelItem) => `${item.type}:${item.model}`;
const getStarterItemProvider = (item: HomeNewModelItem, fallbackProvider: string) =>
  item.provider ?? fallbackProvider;
const skeletonWidths = [112, 150, 126, 138];

const StarterList = memo(() => {
  const { t } = useTranslation('home');
  const navigate = useWorkspaceAwareNavigate();
  const { message } = App.useApp();
  const { agentId: activeAgentId } = useResolvedHomeAgentId();
  const { allowed: canCreateContent, reason } = usePermission('create_content');
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);
  const [switchingKey, setSwitchingKey] = useState<string | null>(null);
  const { defaultHomeNewModels, fallbackChatProvider } = useStarterModelDefaults();
  const { isLoading, items } = useHomeNewModels(defaultHomeNewModels);
  const applyBusinessModelModeConfig = useBusinessModelModeConfig();

  const handleClick = useCallback(
    async (item: HomeNewModelItem) => {
      if (!canCreateContent) return;

      const key = getStarterItemKey(item);
      const selectedProvider =
        item.type === 'chat' ? getStarterItemProvider(item, fallbackChatProvider) : item.provider;
      void trackHomeModelShortcutClicked({ item, provider: selectedProvider });

      if (item.type === 'video') {
        navigate(`/video?model=${item.model}`);
        return;
      }

      if (item.type === 'image') {
        navigate(`/image?model=${item.model}`);
        return;
      }

      if (item.type === 'chat') {
        if (!activeAgentId || switchingKey) return;
        setSwitchingKey(key);
        const provider = getStarterItemProvider(item, fallbackChatProvider);
        try {
          // Hydrate the agent's config before mutating so the optimistic update
          // doesn't drop pre-existing fields the home input never loaded.
          let agentState = useAgentStore.getState();
          if (!agentState.agentMap[activeAgentId]) {
            const config = await agentService.getAgentConfigById(activeAgentId);
            if (config) agentState.internal_dispatchAgentMap(activeAgentId, config);
            agentState = useAgentStore.getState();
          }

          const currentModel = agentByIdSelectors.getAgentModelById(activeAgentId)(agentState);
          const currentProvider =
            agentByIdSelectors.getAgentModelProviderById(activeAgentId)(agentState);
          const nextConfig: BusinessModelModeConfig = applyBusinessModelModeConfig({
            model: item.model,
            provider,
          });
          const shouldUpdateAgentMode =
            nextConfig.chatConfig?.enableAgentMode === false &&
            agentByIdSelectors.getAgentEnableModeById(activeAgentId)(agentState);

          if (
            currentModel === item.model &&
            currentProvider === provider &&
            !shouldUpdateAgentMode
          ) {
            message.info(t('starter.modelInUse', { name: item.title }));
            return;
          }

          try {
            await updateAgentConfigById(activeAgentId, nextConfig, { rethrow: true });
            message.success(t('starter.modelSwitched', { name: item.title }));
          } catch {
            // The agent store already reports persistence failures to the user.
          }
        } finally {
          setSwitchingKey(null);
        }
        return;
      }
    },
    [
      canCreateContent,
      navigate,
      activeAgentId,
      applyBusinessModelModeConfig,
      updateAgentConfigById,
      switchingKey,
      fallbackChatProvider,
      message,
      t,
    ],
  );

  return (
    <Center horizontal className={styles.container} gap={8}>
      <Tag className={styles.newTag} size={'small'}>
        {t('starter.newLabel')}
      </Tag>
      {isLoading
        ? defaultHomeNewModels.map((item, index) => (
            <Skeleton.Button
              active
              key={getStarterItemKey(item)}
              style={{
                borderRadius: 999,
                height: 40,
                width: skeletonWidths[index] ?? 126,
              }}
            />
          ))
        : items.map((item) => {
            const key = getStarterItemKey(item);
            const isSwitching = switchingKey === key;
            const button = (
              <Button
                className={cx(styles.button)}
                disabled={!canCreateContent || (!!switchingKey && !isSwitching)}
                icon={<ModelIcon model={item.iconModel ?? item.model} size={18} />}
                key={key}
                loading={isSwitching}
                shape={'round'}
                onClick={() => handleClick(item)}
              >
                {item.title}
              </Button>
            );

            if (!canCreateContent) {
              return (
                <Tooltip key={key} title={reason}>
                  <div>{button}</div>
                </Tooltip>
              );
            }

            return button;
          })}
    </Center>
  );
});

export default StarterList;
