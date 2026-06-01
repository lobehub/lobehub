import { ModelIcon } from '@lobehub/icons';
import { Button, Center, Tag } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { HomeNewModelItem } from '@/business/client/hooks/useHomeNewModels';
import { useHomeNewModels } from '@/business/client/hooks/useHomeNewModels';
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

const StarterList = memo(() => {
  const { t } = useTranslation('home');
  const navigate = useStableNavigate();
  const { message } = App.useApp();
  const { agentId: activeAgentId } = useResolvedHomeAgentId();
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);
  const [switchingKey, setSwitchingKey] = useState<string | null>(null);
  const items = useHomeNewModels(DEFAULT_HOME_NEW_MODELS);

  const handleClick = useCallback(
    async (item: HomeNewModelItem) => {
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
          if (currentModel === item.model && currentProvider === NEW_CHAT_PROVIDER) {
            message.info(t('starter.modelInUse', { name: item.title }));
            return;
          }

          await updateAgentConfigById(activeAgentId, {
            model: item.model,
            provider: NEW_CHAT_PROVIDER,
          });
          message.success(t('starter.modelSwitched', { name: item.title }));
        } finally {
          setSwitchingKey(null);
        }
        return;
      }
    },
    [navigate, activeAgentId, updateAgentConfigById, switchingKey, message, t],
  );

  return (
    <Center horizontal className={styles.container} gap={8}>
      <Tag className={styles.newTag} size={'small'}>
        {t('starter.newLabel')}
      </Tag>
      {items.map((item) => {
        const key = getStarterItemKey(item);
        const isLoading = switchingKey === key;

        return (
          <Button
            className={cx(styles.button)}
            disabled={!!switchingKey && !isLoading}
            icon={<ModelIcon model={item.iconModel ?? item.model} size={18} />}
            key={key}
            loading={isLoading}
            shape={'round'}
            variant={'outlined'}
            onClick={() => handleClick(item)}
          >
            {item.title}
          </Button>
        );
      })}
    </Center>
  );
});

export default StarterList;
