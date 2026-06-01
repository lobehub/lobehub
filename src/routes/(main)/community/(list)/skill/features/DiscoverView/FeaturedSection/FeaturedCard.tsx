'use client';

import { Avatar, Block, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { StarIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import { discoverService } from '@/services/discover';
import { type DiscoverSkillItem } from '@/types/discover';

const styles = createStaticStyles(({ css }) => ({
  author: css`
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  category: css`
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  desc: css`
    flex: 1;
    margin: 0 !important;
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
  name: css`
    margin: 0 !important;
    font-size: 15px !important;
    font-weight: 600 !important;
  `,
  rating: css`
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorWarning};
  `,
}));

const FeaturedCard = memo<DiscoverSkillItem>(
  ({ name, icon, author, description, identifier, category, isFeatured, ratingAvg }) => {
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
        height={'100%'}
        variant={'outlined'}
        width={'100%'}
        style={{
          overflow: 'hidden',
          position: 'relative',
        }}
        onClick={handleClick}
      >
        <Flexbox gap={12} height={'100%'} padding={16}>
          <Flexbox horizontal align={'center'} gap={12}>
            <Avatar avatar={icon || name} shape={'square'} size={40} style={{ flex: 'none' }} />
            <Flexbox flex={1} gap={2} style={{ overflow: 'hidden' }}>
              <Flexbox horizontal align={'center'} gap={8}>
                <Text ellipsis className={styles.name}>
                  {name}
                </Text>
                {isFeatured && (
                  <Tag color={'orange'} size={'small'}>
                    {t('isFeatured')}
                  </Tag>
                )}
              </Flexbox>
              <Text ellipsis className={styles.author}>
                {author}
              </Text>
            </Flexbox>
          </Flexbox>
          <Text
            className={styles.desc}
            ellipsis={{
              rows: 2,
            }}
          >
            {description}
          </Text>
          <Flexbox horizontal align={'center'} justify={'space-between'}>
            <Tag size={'small'}>{category && t(`skills.categories.${category}.name` as any)}</Tag>
            {Boolean(ratingAvg) && (
              <Flexbox horizontal align={'center'} className={styles.rating} gap={4}>
                <Icon icon={StarIcon} size={14} />
                {ratingAvg?.toFixed(1)}
              </Flexbox>
            )}
          </Flexbox>
        </Flexbox>
      </Block>
    );
  },
);

export default FeaturedCard;
