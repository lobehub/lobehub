'use client';

import { Block, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRightIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { SerializedMessengerPlatformDefinition } from '@/server/services/messenger/platforms/types';

import { type MessengerPlatform, PlatformAvatar } from './constants';

const styles = stylex.create({
  card: {
    cursor: 'pointer',
    padding: '16px',
    borderRadius: cssVar.borderRadiusLG,
    transition: 'border-color 0.2s ease',
    borderColor: { 'default': null, ':hover': cssVar.colorPrimaryBorderHover },
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: { 'default': 'repeat(2, 1fr)', '@media (width <= 720px)': '1fr' },
    gap: '12px',
  },
});

interface IntegrationListProps {
  onSelect: (platform: MessengerPlatform) => void;
  platforms: SerializedMessengerPlatformDefinition[];
}

const IntegrationList = memo<IntegrationListProps>(({ onSelect, platforms }) => {
  const { t } = useTranslation('messenger');

  return (
    <div {...stylex.props(styles.grid)}>
      {platforms.map((platform) => (
        <Block
          className={stylex.props(styles.card).className}
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
