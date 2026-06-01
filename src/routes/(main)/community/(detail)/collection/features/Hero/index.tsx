'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { Tag } from 'antd';
import { createStaticStyles, responsive } from 'antd-style';
import { ArrowLeftIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import PublishedTime from '@/components/PublishedTime';

const styles = createStaticStyles(({ css }) => ({
  author: css`
    font-size: 13px;
    color: rgb(255 255 255 / 70%);
  `,
  backButton: css`
    position: absolute;
    inset-block-start: 16px;
    inset-inline-start: 16px;
    color: rgb(255 255 255 / 80%);

    &:hover {
      color: rgb(255 255 255);
      background: rgb(255 255 255 / 15%);
    }
  `,
  container: css`
    position: relative;

    overflow: hidden;

    width: 100%;
    min-height: 280px;
    padding-block: 80px 40px;
    padding-inline: 40px;

    background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%);

    ${responsive.sm} {
      min-height: 240px;
      padding-block: 60px 24px;
      padding-inline: 20px;
    }
  `,
  cover: css`
    position: absolute;
    inset: 0;

    opacity: 0.4;
    background-position: center;
    background-size: cover;
  `,
  description: css`
    max-width: 500px;
    margin: 0;

    font-size: 15px;
    line-height: 1.6;
    color: rgb(255 255 255 / 85%);

    ${responsive.sm} {
      font-size: 14px;
    }
  `,
  tag: css`
    border: none;

    font-size: 10px;
    font-weight: 700;
    color: rgb(255 255 255 / 90%);
    text-transform: uppercase;
    letter-spacing: 1px;

    background: rgb(255 255 255 / 20%);
  `,
  title: css`
    margin: 0;

    font-size: 36px;
    font-weight: 700;
    line-height: 1.2;
    color: rgb(255 255 255);

    ${responsive.sm} {
      font-size: 28px;
    }
  `,
}));

interface HeroProps {
  cover?: string;
  createdAt: string;
  description?: string;
  itemCount: number;
  mobile?: boolean;
  summary: string;
  title: string;
  updatedAt: string;
}

const Hero = memo<HeroProps>(
  ({ title, summary, description, itemCount, cover, createdAt, updatedAt, mobile }) => {
    const { t } = useTranslation('discover');
    const navigate = useNavigate();

    const handleBack = useCallback(() => {
      navigate('/community/skill');
    }, [navigate]);

    // Use description if available, otherwise fall back to summary
    const displayDescription = description || summary;

    return (
      <div className={styles.container}>
        {cover && <div className={styles.cover} style={{ backgroundImage: `url(${cover})` }} />}
        <ActionIcon className={styles.backButton} icon={ArrowLeftIcon} onClick={handleBack} />
        <Flexbox gap={16} style={{ maxWidth: 600, position: 'relative', zIndex: 1 }}>
          <Tag className={styles.tag}>{t('skills.collection.editorCollection')}</Tag>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.description}>{displayDescription}</p>
          <Flexbox horizontal align={'center'} className={styles.author} gap={8}>
            <span>{t('skills.collection.skillCount', { count: itemCount })}</span>
            {(updatedAt || createdAt) && (
              <>
                <span>·</span>
                <PublishedTime date={updatedAt || createdAt} template={'MMM DD, YYYY'} />
              </>
            )}
          </Flexbox>
        </Flexbox>
      </div>
    );
  },
);

export default Hero;
