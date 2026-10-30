import { Avatar, Button, Flexbox, Skeleton, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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

const styles = stylex.create({
  // Restates the hover pair: replacing `color` / `backgroundColor` drops the base
  // rule's hover states, and hover still wins over the current-model highlight.
  active: {
    color: { 'default': cssVar.colorText, ':hover': cssVar.colorText },
    backgroundColor: { 'default': cssVar.colorFillSecondary, ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
  },
  button: {
    height: '24px',
    paddingInline: '8px',
    borderWidth: 0,
    borderRadius: cssVar.borderRadius,
    fontSize: '13px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
    boxShadow: 'none',
  },
  container: {
    overflow: 'hidden',
    flex: '1',
    minWidth: 0,
    height: '24px',
  },
  label: {
    flex: 'none',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
  },
});

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
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.container).className}
        gap={4}
      >
        <Text className={stylex.props(styles.label).className}>{t('starter.newLabel')}</Text>
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
                  className={stylex.props(styles.button, isCurrent && styles.active).className}
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
