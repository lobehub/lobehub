'use client';

import { Button, Flexbox } from '@lobehub/ui';
import { Skeleton, Tag } from 'antd';
import { createStaticStyles, cx, responsive } from 'antd-style';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import { useIsDark } from '@/hooks/useIsDark';
import { useDiscoverStore } from '@/store/discover';

const styles = createStaticStyles(({ css }) => ({
  banner: css`
    position: relative;

    width: 100%;
    padding-block: 32px;
    padding-inline: 40px;
    border-radius: 16px;

    ${responsive.sm} {
      padding-block: 20px;
      padding-inline: 24px;
    }
  `,
  banner_dark: css`
    background: linear-gradient(135deg, #2a2a2a 0%, #3a3a3a 50%, #2a2a2a 100%);
  `,
  banner_light: css`
    background: linear-gradient(135deg, #e8e8e8 0%, #f5f5f5 50%, #e0e0e0 100%);
  `,
  description: css`
    margin: 0;
    font-size: 14px;
    font-weight: 400;
    line-height: 1.6;

    ${responsive.sm} {
      font-size: 13px;
    }
  `,
  description_dark: css`
    color: rgb(255 255 255 / 65%);
  `,
  description_light: css`
    color: rgb(0 0 0 / 65%);
  `,
  tag: css`
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  `,
  title: css`
    margin: 0;
    font-size: 28px;
    font-weight: 700;
    line-height: 1.3;

    ${responsive.sm} {
      font-size: 22px;
    }
  `,
  title_dark: css`
    color: rgb(255 255 255 / 88%);
  `,
  title_light: css`
    color: rgb(0 0 0 / 88%);
  `,
}));

const EditorsPick = memo(() => {
  const { t } = useTranslation('discover');
  const isDark = useIsDark();
  const navigate = useNavigate();
  const useFetchSkillCollections = useDiscoverStore((s) => s.useFetchSkillCollections);
  const { data, isLoading } = useFetchSkillCollections();

  const collection = data?.[0];

  const handleLearnMore = useCallback(() => {
    if (collection?.slug) {
      navigate(urlJoin('/community/collection', collection.slug));
    }
  }, [navigate, collection?.slug]);

  if (isLoading) {
    return (
      <Flexbox
        className={cx(styles.banner, isDark ? styles.banner_dark : styles.banner_light)}
        width={'100%'}
      >
        <Flexbox gap={12} style={{ maxWidth: 500 }}>
          <Skeleton.Button active size="small" style={{ width: 80 }} />
          <Skeleton.Input active size="large" style={{ width: 300 }} />
          <Skeleton active paragraph={{ rows: 2 }} title={false} />
        </Flexbox>
      </Flexbox>
    );
  }

  if (!collection) return null;

  return (
    <Flexbox
      className={cx(styles.banner, isDark ? styles.banner_dark : styles.banner_light)}
      width={'100%'}
    >
      <Flexbox gap={12} style={{ maxWidth: 600, position: 'relative', zIndex: 1 }}>
        <Tag className={styles.tag} color={isDark ? 'default' : 'default'}>
          {t('skills.sections.editorsPick')}
        </Tag>
        <h2 className={cx(styles.title, isDark ? styles.title_dark : styles.title_light)}>
          {collection.title}
        </h2>
        <p
          className={cx(
            styles.description,
            isDark ? styles.description_dark : styles.description_light,
          )}
        >
          {collection.summary}
        </p>
        <Flexbox horizontal gap={12} style={{ marginBlockStart: 8 }}>
          <Button
            style={{ background: isDark ? '#333' : '#333', color: '#fff' }}
            onClick={handleLearnMore}
          >
            {t('skills.sections.learnMore')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

export default EditorsPick;
