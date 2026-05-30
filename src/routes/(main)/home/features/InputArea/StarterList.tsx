import { Claude, Jimeng, OpenAI } from '@lobehub/icons';
import { type ButtonProps } from '@lobehub/ui';
import { Button, Center, Tag, Tooltip } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useStableNavigate } from '@/hooks/useStableNavigate';
import { agentService } from '@/services/agent';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import { useResolvedHomeAgentId } from '../AgentSelect/useResolvedHomeAgentId';
import {
  NEW_CHAT_MODEL,
  NEW_CHAT_MODEL_NAME,
  NEW_CHAT_PROVIDER,
  NEW_IMAGE_MODEL,
  NEW_IMAGE_MODEL_NAME,
  NEW_VIDEO_MODEL,
  NEW_VIDEO_MODEL_NAME,
} from './starterModels';

type StarterKey = 'chat' | 'image' | 'video';

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
  newTag: css`
    padding-inline: 10px !important;
    border-radius: 999px !important;
  `,
}));

interface StarterItem {
  disabled?: boolean;
  icon?: ButtonProps['icon'];
  key: StarterKey;
  /** Fixed product name — not translated, see starterModels.ts */
  title: string;
}

const StarterList = memo(() => {
  const { t } = useTranslation('home');
  const navigate = useStableNavigate();
  const { message } = App.useApp();
  const { agentId: activeAgentId } = useResolvedHomeAgentId();
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);
  const [switchingKey, setSwitchingKey] = useState<StarterKey | null>(null);

  const items: StarterItem[] = useMemo(
    () => [
      {
        icon: Claude.Avatar,
        key: 'chat',
        title: NEW_CHAT_MODEL_NAME,
      },
      {
        icon: OpenAI.Avatar,
        key: 'image',
        title: NEW_IMAGE_MODEL_NAME,
      },
      {
        icon: Jimeng.Avatar,
        key: 'video',
        title: NEW_VIDEO_MODEL_NAME,
      },
    ],
    [],
  );

  const handleClick = useCallback(
    async (key: StarterKey) => {
      if (key === 'video') {
        navigate(`/video?model=${NEW_VIDEO_MODEL}`);
        return;
      }

      if (key === 'image') {
        navigate(`/image?model=${NEW_IMAGE_MODEL}`);
        return;
      }

      if (key === 'chat') {
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
          if (currentModel === NEW_CHAT_MODEL && currentProvider === NEW_CHAT_PROVIDER) {
            message.info(t('starter.modelInUse', { name: NEW_CHAT_MODEL_NAME }));
            return;
          }

          await updateAgentConfigById(activeAgentId, {
            model: NEW_CHAT_MODEL,
            provider: NEW_CHAT_PROVIDER,
          });
          message.success(t('starter.modelSwitched', { name: NEW_CHAT_MODEL_NAME }));
        } finally {
          setSwitchingKey(null);
        }
        return;
      }
    },
    [navigate, activeAgentId, updateAgentConfigById, switchingKey, message, t],
  );

  return (
    <Center horizontal gap={8}>
      <Tag className={styles.newTag} size={'small'}>
        {t('starter.newLabel')}
      </Tag>
      {items.map((item) => {
        const isLoading = switchingKey === item.key;
        const button = (
          <Button
            className={cx(styles.button)}
            disabled={item.disabled || (!!switchingKey && !isLoading)}
            icon={item.icon}
            key={item.key}
            loading={isLoading}
            shape={'round'}
            variant={'outlined'}
            iconProps={{
              size: 18,
            }}
            onClick={() => handleClick(item.key)}
          >
            {item.title}
          </Button>
        );

        if (item.disabled) {
          return (
            <Tooltip key={item.key} title={t('starter.developing')}>
              {button}
            </Tooltip>
          );
        }

        return button;
      })}
    </Center>
  );
});

export default StarterList;
