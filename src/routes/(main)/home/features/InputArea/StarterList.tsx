import { DeepSeek, Jimeng, OpenAI } from '@lobehub/icons';
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

const DEEPSEEK_V4_PRO_MODEL = 'deepseek-v4-pro';
const DEEPSEEK_V4_PRO_PROVIDER = 'lobehub';

type StarterKey = 'image' | 'video' | 'deepseek-v4-pro';

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

type StarterTitleKey =
  | 'starter.imageGeneration'
  | 'starter.videoGeneration'
  | 'starter.deepseekV4Pro';

interface StarterItem {
  disabled?: boolean;
  icon?: ButtonProps['icon'];
  key: StarterKey;
  titleKey: StarterTitleKey;
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
        icon: DeepSeek.Avatar,
        key: 'deepseek-v4-pro',
        titleKey: 'starter.deepseekV4Pro',
      },
      {
        icon: OpenAI.Avatar,
        key: 'image',
        titleKey: 'starter.imageGeneration',
      },
      {
        icon: Jimeng.Avatar,
        key: 'video',
        titleKey: 'starter.videoGeneration',
      },
    ],
    [],
  );

  const handleClick = useCallback(
    async (key: StarterKey) => {
      if (key === 'video') {
        navigate('/video?model=dreamina-seedance-2-0-260128');
        return;
      }

      if (key === 'image') {
        navigate('/image?model=gpt-image-2');
        return;
      }

      if (key === 'deepseek-v4-pro') {
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
          if (
            currentModel === DEEPSEEK_V4_PRO_MODEL &&
            currentProvider === DEEPSEEK_V4_PRO_PROVIDER
          ) {
            message.info(t('starter.deepseekV4ProAlready'));
            return;
          }

          await updateAgentConfigById(activeAgentId, {
            model: DEEPSEEK_V4_PRO_MODEL,
            provider: DEEPSEEK_V4_PRO_PROVIDER,
          });
          message.success(t('starter.deepseekV4ProSwitched'));
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
            {t(item.titleKey)}
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
