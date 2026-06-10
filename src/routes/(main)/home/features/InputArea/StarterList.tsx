import { ModelIcon } from '@lobehub/icons';
import { Button, Center, Skeleton, Tag, Tooltip } from '@lobehub/ui';
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
import { usePermission } from '@/hooks/usePermission';
import { useStableNavigate } from '@/hooks/useStableNavigate';
import { agentService } from '@/services/agent';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import { useResolvedHomeAgentId } from '../AgentSelect/useResolvedHomeAgentId';
import { DEFAULT_HOME_NEW_MODELS, NEW_CHAT_PROVIDER } from './starterModels';

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
const getStarterItemProvider = (item: HomeNewModelItem) => item.provider ?? NEW_CHAT_PROVIDER;
const skeletonWidths = [112, 150, 126, 138];

const StarterList = memo(() => {
  const { t } = useTranslation('home');
  const navigate = useStableNavigate();
  const { message } = App.useApp();
  const { agentId: activeAgentId } = useResolvedHomeAgentId();
  const { allowed: canCreateContent, reason } = usePermission('create_content');
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);
  const [switchingKey, setSwitchingKey] = useState<string | null>(null);
  const { isLoading, items } = useHomeNewModels(DEFAULT_HOME_NEW_MODELS);
  const applyBusinessModelModeConfig = useBusinessModelModeConfig();

  const handleClick = useCallback(
    async (item: HomeNewModelItem) => {
      if (!canCreateContent) return;

      const key = getStarterItemKey(item);

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
        const provider = getStarterItemProvider(item);
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

          await updateAgentConfigById(activeAgentId, nextConfig);
          message.success(t('starter.modelSwitched', { name: item.title }));
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
        ? DEFAULT_HOME_NEW_MODELS.map((item, index) => (
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
                variant={'outlined'}
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
