'use client';

import { Block, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ChevronRightIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { SerializedMessengerPlatformDefinition } from '@/server/services/messenger/platforms/types';

import { type MessengerPlatform, PlatformAvatar } from './constants';

const styles = createStaticStyles(({ css, cssVar }) => ({
  // Match the agent channel list's card weight: an outlined Block on
  // colorBgContainer with a soft secondary border (the Block variant supplies
  // both), rounded a step larger so it reads as the same surface as 消息频道.
  card: css`
    cursor: pointer;
    padding: 16px;
    border-radius: ${cssVar.borderRadiusLG};
    transition: border-color 0.2s ease;

    &:hover {
      border-color: ${cssVar.colorPrimaryBorderHover};
    }
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;

    @media (width <= 720px) {
      grid-template-columns: 1fr;
    }
  `,
}));

interface IntegrationListProps {
  onSelect: (platform: MessengerPlatform) => void;
  platforms: SerializedMessengerPlatformDefinition[];
}

const IntegrationList = memo<IntegrationListProps>(({ onSelect, platforms }) => {
  const { t } = useTranslation('messenger');

  return (
    <div className={styles.grid}>
      {platforms.map((platform) => (
        <Block
          className={styles.card}
          key={platform.id}
          variant={'outlined'}
          onClick={() => onSelect(platform.id)}
        >
          <Flexbox horizontal align="center" gap={16}>
            <PlatformAvatar platform={platform.id} size={48} />
            <Flexbox flex={1} gap={2}>
              <Text strong style={{ fontSize: 15 }}>
                {platform.name}
              </Text>
              <Text style={{ fontSize: 13 }} type="secondary">
                {t(`messenger.list.${platform.id}.description` as any)}
              </Text>
            </Flexbox>
            {platform.access?.requiredPlan === 'paid' && (
              <Tag color="blue" size="small">
                {t('messenger.paidBadge')}
              </Tag>
            )}
            <Icon icon={ChevronRightIcon} />
          </Flexbox>
        </Block>
      ))}
    </div>
  );
});

IntegrationList.displayName = 'MessengerIntegrationList';

export default IntegrationList;
