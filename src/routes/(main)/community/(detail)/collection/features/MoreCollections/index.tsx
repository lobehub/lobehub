'use client';

import { Block, Flexbox, Grid, Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import { useIsDark } from '@/hooks/useIsDark';
import Title from '@/routes/(main)/community/components/Title';
import { useDiscoverStore } from '@/store/discover';
import { type SkillCollectionItem } from '@/types/discover';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    position: relative;

    overflow: hidden;

    height: 160px;
    padding: 20px;
    border-radius: 12px;
  `,
  card_dark: css`
    border: 1px solid rgb(255 255 255 / 8%);
    background: rgb(255 255 255 / 4%);
  `,
  card_light: css`
    border: 1px solid rgb(0 0 0 / 6%);
    background: rgb(255 255 255);
    box-shadow: 0 1px 2px rgb(0 0 0 / 4%);
  `,
  cover: css`
    position: absolute;
    inset: 0;

    opacity: 0.15;
    background-position: center;
    background-size: cover;
  `,
  desc: css`
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
  `,
  desc_dark: css`
    color: rgb(255 255 255 / 50%);
  `,
  desc_light: css`
    color: rgb(0 0 0 / 50%);
  `,
  title: css`
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    line-height: 1.4;
  `,
  title_dark: css`
    color: rgb(255 255 255 / 88%);
  `,
  title_light: css`
    color: rgb(0 0 0 / 88%);
  `,
}));

interface CollectionCardProps extends SkillCollectionItem {}

const CollectionCard = memo<CollectionCardProps>(({ title, summary, slug, cover }) => {
  const isDark = useIsDark();
  const navigate = useNavigate();

  const handleClick = useCallback(() => {
    navigate(urlJoin('/community/collection', slug));
  }, [navigate, slug]);

  return (
    <Block
      clickable
      className={cx(styles.card, isDark ? styles.card_dark : styles.card_light)}
      style={{ cursor: 'pointer' }}
      onClick={handleClick}
    >
      {cover && <div className={styles.cover} style={{ backgroundImage: `url(${cover})` }} />}
      <Flexbox gap={8} style={{ position: 'relative', zIndex: 1 }}>
        <Text className={cx(styles.title, isDark ? styles.title_dark : styles.title_light)}>
          {title}
        </Text>
        <Text
          className={cx(styles.desc, isDark ? styles.desc_dark : styles.desc_light)}
          ellipsis={{ rows: 3 }}
        >
          {summary}
        </Text>
      </Flexbox>
    </Block>
  );
});

interface MoreCollectionsProps {
  currentSlug: string;
}

const MoreCollections = memo<MoreCollectionsProps>(({ currentSlug }) => {
  const { t } = useTranslation('discover');
  const useFetchSkillCollections = useDiscoverStore((s) => s.useFetchSkillCollections);
  const { data, isLoading } = useFetchSkillCollections();

  if (isLoading || !data || data.length === 0) return null;

  const otherCollections = data.filter((c) => c.slug !== currentSlug);
  if (otherCollections.length === 0) return null;

  return (
    <Flexbox gap={16} style={{ maxWidth: 720, margin: '0 auto', width: '100%' }}>
      <Title>{t('skills.collection.moreCollections')}</Title>
      <Grid maxItemWidth={340} rows={2} width={'100%'}>
        {otherCollections.slice(0, 4).map((item) => (
          <CollectionCard key={item.slug} {...item} />
        ))}
      </Grid>
    </Flexbox>
  );
});

export default MoreCollections;
