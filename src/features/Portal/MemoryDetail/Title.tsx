'use client';

import { LayersEnum } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const TAB_KEY_BY_LAYER = {
  [LayersEnum.Activity]: 'tab.activities',
  [LayersEnum.Context]: 'tab.contexts',
  [LayersEnum.Identity]: 'tab.identities',
  [LayersEnum.Preference]: 'tab.preferences',
} as const satisfies Partial<Record<LayersEnum, string>>;

const Title = memo(() => {
  const { t } = useTranslation('memory');
  const layer = useChatStore((s) => chatPortalSelectors.memoryDetailView(s)?.layer);
  const tabKey = layer ? TAB_KEY_BY_LAYER[layer as keyof typeof TAB_KEY_BY_LAYER] : undefined;

  return (
    <Text ellipsis weight={500}>
      {tabKey ? t(tabKey) : t('tab.home')}
    </Text>
  );
});

Title.displayName = 'MemoryDetailTitle';

export default Title;
