import { DeepSeek, Jimeng } from '@lobehub/icons';
import { type ButtonProps } from '@lobehub/ui';
import { Button, Center, Tooltip } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ImageIcon } from 'lucide-react';
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
}));

type StarterTitleKey =
  | 'starter.imageGeneration'
  | 'starter.videoGeneration'
  | 'starter.deepseekV4Pro';

interface StarterItem {
  disabled?: boolean;
  hot?: boolean;
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
        hot: true,
        icon: DeepSeek.Color,
        key: 'deepseek-v4-pro',
        titleKey: 'starter.deepseekV4Pro',
      },
      {
        hot: true,
        icon: ImageIcon,
        key: 'image',
        titleKey: 'starter.imageGeneration',
      },
      {
        icon: Jimeng.Color,
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
              color: cssVar.colorTextSecondary,
              size: 18,
            }}
            onClick={() => handleClick(item.key)}
          >
            {t(item.titleKey)}
            {item.hot && ' 🔥'}
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
