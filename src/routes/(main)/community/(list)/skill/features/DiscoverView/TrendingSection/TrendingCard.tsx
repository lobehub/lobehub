'use client';

import { Avatar, Block, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import { discoverService } from '@/services/discover';
import { type DiscoverSkillItem } from '@/types/discover';

const styles = createStaticStyles(({ css }) => ({
  category: css`
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  count: css`
    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  name: css`
    margin: 0 !important;
    font-size: 15px !important;
    font-weight: 600 !important;
  `,
  rank: css`
    font-size: 24px;
    font-weight: 700;
    color: ${cssVar.colorTextDescription};
  `,
}));

interface TrendingCardProps extends DiscoverSkillItem {
  rank: number;
}

const TrendingCard = memo<TrendingCardProps>(
  ({ rank, name, icon, identifier, category, installCount }) => {
    const { t } = useTranslation('discover');
    const navigate = useNavigate();
    const link = urlJoin('/community/skill', identifier);

    const handleClick = useCallback(() => {
      discoverService
        .reportSkillEvent({
          event: 'click',
          identifier,
          source: location.pathname,
        })
        .catch(() => {});

      navigate(link);
    }, [identifier, link, navigate]);

    return (
      <Block
        clickable
        variant={'outlined'}
        style={{
          overflow: 'hidden',
          position: 'relative',
        }}
        onClick={handleClick}
      >
        <Flexbox horizontal align={'center'} gap={16} padding={16}>
          <Text className={styles.rank}>{rank}</Text>
          <Avatar avatar={icon || name} shape={'square'} size={40} style={{ flex: 'none' }} />
          <Flexbox flex={1} gap={2} style={{ overflow: 'hidden' }}>
            <Text ellipsis className={styles.name}>
              {name}
            </Text>
            <Text className={styles.category}>
              {category && t(`skills.categories.${category}.name` as any)}
            </Text>
          </Flexbox>
          <Text className={styles.count}>{installCount?.toLocaleString()}</Text>
        </Flexbox>
      </Block>
    );
  },
);

export default TrendingCard;
