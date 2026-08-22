import { ModelIcon } from '@lobehub/icons';
import { Avatar, Flexbox, Skeleton, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { BusinessModelModeConfig } from '@/business/client/hooks/useBusinessAgentMode';
import { useBusinessModelModeConfig } from '@/business/client/hooks/useBusinessAgentMode';
import type { HomeNewModelItem } from '@/business/client/hooks/useHomeNewModels';
import { useHomeNewModels } from '@/business/client/hooks/useHomeNewModels';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { agentService } from '@/services/agent';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import { useResolvedHomeAgentId } from '../AgentSelect/useResolvedHomeAgentId';
import { trackHomeModelShortcutClicked } from './analytics';
import { getShortcutIconModelId } from './getShortcutIconModelId';
import { useStarterModelDefaults } from './useStarterModelDefaults';

const styles = createStaticStyles(({ css, cssVar }) => ({
  active: css`
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillSecondary};
  `,
  button: css`
    height: 40px;
    padding-inline: 12px;
    border: 0;
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorTextSecondary};

    background: transparent;
    box-shadow: none !important;

    &:hover {
      color: ${cssVar.colorText} !important;
      background: ${cssVar.colorFillTertiary} !important;
    }
  `,
  container: css`
    flex-wrap: wrap;
    min-height: 40px;
  `,
  label: css`
    flex: none;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const getShortcutKey = (item: HomeNewModelItem) => `${item.type}:${item.model}`;
const getShortcutProvider = (item: HomeNewModelItem, fallbackProvider: string) =>
  item.provider ?? fallbackProvider;
const skeletonWidths = [112, 150, 126, 138];

export const NewModelShortcuts = () => {
  const { t } = useTranslation('home');
  const navigate = useWorkspaceAwareNavigate();
  const { message } = App.useApp();
  const { agentId: activeAgentId } = useResolvedHomeAgentId();
  const { allowed: canCreateContent } = usePermission('create_content');
  const updateAgentConfigById = useAgentStore((state) => state.updateAgentConfigById);
  const currentModel = useAgentStore((state) =>
    agentByIdSelectors.getAgentModelById(activeAgentId ?? '')(state),
  );
  const currentProvider = useAgentStore((state) =>
    agentByIdSelectors.getAgentModelProviderById(activeAgentId ?? '')(state),
  );
  const [switchingKey, setSwitchingKey] = useState<string | null>(null);
  const { defaultHomeNewModels, fallbackChatProvider } = useStarterModelDefaults();
  const { isLoading, items } = useHomeNewModels([...defaultHomeNewModels]);
  const applyBusinessModelModeConfig = useBusinessModelModeConfig();

  const handleClick = useCallback(
    async (item: HomeNewModelItem) => {
      if (!canCreateContent) return;

      const key = getShortcutKey(item);
      const selectedProvider =
        item.type === 'chat' ? getShortcutProvider(item, fallbackChatProvider) : item.provider;
      void trackHomeModelShortcutClicked({ item, provider: selectedProvider });

      if (item.type === 'video') {
        navigate(`/video?model=${item.model}`);
        return;
      }

      if (item.type === 'image') {
        navigate(`/image?model=${item.model}`);
        return;
      }

      if (!activeAgentId || switchingKey) return;

      setSwitchingKey(key);
      const provider = getShortcutProvider(item, fallbackChatProvider);
      try {
        // Hydrate before the optimistic write so updating the selected model
        // cannot drop fields the Home surface has not loaded yet.
        let agentState = useAgentStore.getState();
        if (!agentState.agentMap[activeAgentId]) {
          const config = await agentService.getAgentConfigById(activeAgentId);
          if (config) agentState.internal_dispatchAgentMap(activeAgentId, config);
          agentState = useAgentStore.getState();
        }

        const nextConfig: BusinessModelModeConfig = applyBusinessModelModeConfig({
          model: item.model,
          provider,
        });
        const shouldUpdateAgentMode =
          nextConfig.chatConfig?.enableAgentMode === false &&
          agentByIdSelectors.getAgentEnableModeById(activeAgentId)(agentState);

        if (currentModel === item.model && currentProvider === provider && !shouldUpdateAgentMode) {
          message.info(t('starter.modelInUse', { name: item.title }));
          return;
        }

        try {
          await updateAgentConfigById(activeAgentId, nextConfig, { rethrow: true });
          message.success(t('starter.modelSwitched', { name: item.title }));
        } catch {
          // The agent store reports persistence failures at the action boundary.
        }
      } finally {
        setSwitchingKey(null);
      }
    },
    [
      activeAgentId,
      applyBusinessModelModeConfig,
      canCreateContent,
      currentModel,
      currentProvider,
      fallbackChatProvider,
      message,
      navigate,
      switchingKey,
      t,
      updateAgentConfigById,
    ],
  );

  if (!canCreateContent || (!isLoading && items.length === 0)) return null;

  return (
    <Flexbox horizontal align={'center'} className={styles.container} gap={8} justify={'center'}>
      <Text className={styles.label}>{t('starter.newLabel')}</Text>
      {isLoading
        ? defaultHomeNewModels.map((item, index) => (
            <Skeleton.Button
              active
              key={getShortcutKey(item)}
              style={{
                borderRadius: 8,
                height: 40,
                width: skeletonWidths[index] ?? 126,
              }}
            />
          ))
        : items.map((item) => {
            const key = getShortcutKey(item);
            const provider =
              item.type === 'chat' ? getShortcutProvider(item, fallbackChatProvider) : undefined;
            const isCurrent =
              item.type === 'chat' && item.model === currentModel && provider === currentProvider;
            const isSwitching = switchingKey === key;
            const button = (
              <Button
                aria-pressed={item.type === 'chat' ? isCurrent : undefined}
                className={cx(styles.button, isCurrent && styles.active)}
                disabled={!!switchingKey && !isSwitching}
                key={key}
                loading={isSwitching}
                type={'text'}
                icon={
                  item.iconUrl ? (
                    <Avatar alt={''} avatar={item.iconUrl} size={18} />
                  ) : (
                    <ModelIcon model={getShortcutIconModelId(item)} size={18} />
                  )
                }
                onClick={() => handleClick(item)}
              >
                {item.title}
              </Button>
            );

            return button;
          })}
    </Flexbox>
  );
};
