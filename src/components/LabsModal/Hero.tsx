'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    width: 100%;
    max-width: 800px;
    margin-block: 0;
    margin-inline: auto;
    padding-block: 24px 8px;
    padding-inline: 16px;
  `,
  desc: css`
    color: ${cssVar.colorTextSecondary};
  `,
  title: css`
    font-size: 22px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
}));

const Hero = memo(() => {
  const { t } = useTranslation('labs');

  return (
    <div className={styles.container}>
      <Flexbox gap={8}>
        <div className={styles.title}>🪄 {t('title')}</div>
        <div className={styles.desc}>{t('desc')}</div>
      </Flexbox>
    </div>
  );
});

Hero.displayName = 'LabsHero';

export default Hero;
