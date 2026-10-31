import {
  Avatar,
  Button,
  createStaticStyles,
  cx,
  Flexbox,
  Skeleton,
  Text,
  toast,
} from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { HomeNewModelItem } from '@/business/client/hooks/useHomeNewModels';
import { useHomeNewModels } from '@/business/client/hooks/useHomeNewModels';
import { ModelIcon } from '@/components/LobeIcons';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';

import { useResolvedHomeAgentId } from '../AgentSelect/useResolvedHomeAgentId';
import { InputBanner } from '../InputArea/InputBanner';
import { useHomeModelSwitch } from '../useHomeModelSwitch';
import { trackHomeModelShortcutClicked } from './analytics';
import { getShortcutIconModelId } from './getShortcutIconModelId';
import { useStarterModelDefaults } from './useStarterModelDefaults';

export const HOME_NEW_MODELS_BANNER_ID = 'home-new-models-v1';

const styles = createStaticStyles(({ css, cssVar }) => ({
  active: css`
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillSecondary};
  `,
  button: css`
    height: 24px;
    padding-inline: 8px;
    border: 0;
    border-radius: ${cssVar.borderRadius};

    font-size: 13px;
    color: ${cssVar.colorTextSecondary};

    background: transparent;
    box-shadow: none !important;

    &:hover {
      color: ${cssVar.colorText} !important;
      background: ${cssVar.colorFillTertiary} !important;
    }
  `,
  container: css`
    overflow: hidden;
    flex: 1;
    min-width: 0;
    height: 24px;
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
const skeletonWidths = [96, 120, 104, 112];

export const NewModelShortcuts = () => {
  const { t } = useTranslation('home');
  const navigate = useWorkspaceAwareNavigate();
  const { agentId: activeAgentId } = useResolvedHomeAgentId();
  const { allowed: canCreateContent } = usePermission('create_content');
  const {
    isReady,
    lockTip,
    model: currentModel,
    provider: currentProvider,
    switchModel,
  } = useHomeModelSwitch(activeAgentId);
  const [switchingKey, setSwitchingKey] = useState<string | null>(null);
  const { defaultHomeNewModels, fallbackChatProvider } = useStarterModelDefaults();
  const { isLoading, items } = useHomeNewModels([...defaultHomeNewModels]);

  const handleClick = async (item: HomeNewModelItem) => {
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
    try {
      const result = await switchModel({
        model: item.model,
        provider: getShortcutProvider(item, fallbackChatProvider),
      });
      if (result === 'inUse') toast.info(t('starter.modelInUse', { name: item.title }));
      if (result === 'switched') toast.success(t('starter.modelSwitched', { name: item.title }));
      if (result === 'locked' && lockTip) toast.info(lockTip);
      if (result === 'failed') toast.error(t('saveAgentConfigFail', { ns: 'common' }));
    } finally {
      setSwitchingKey(null);
    }
  };

  if (!canCreateContent || (!isLoading && items.length === 0)) return null;

  return (
    <InputBanner
      dismissId={HOME_NEW_MODELS_BANNER_ID}
      dismissTitle={t('homePromoBanner.dismiss')}
      testId={'home-new-model-banner'}
    >
      <Flexbox horizontal align={'center'} className={styles.container} gap={4}>
        <Text className={styles.label}>{t('starter.newLabel')}</Text>
        {isLoading
          ? defaultHomeNewModels.map((item, index) => (
              <Skeleton
                height={24}
                key={getShortcutKey(item)}
                radius={8}
                width={skeletonWidths[index] ?? 104}
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
                  // Chat shortcuts wait for the Agent's model selection to load.
                  disabled={(!!switchingKey && !isSwitching) || (item.type === 'chat' && !isReady)}
                  key={key}
                  loading={isSwitching}
                  type={'text'}
                  icon={
                    item.iconUrl ? (
                      <Avatar alt={''} avatar={item.iconUrl} size={16} />
                    ) : (
                      <ModelIcon model={getShortcutIconModelId(item)} size={16} />
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
    </InputBanner>
  );
};
