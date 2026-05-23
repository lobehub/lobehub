'use client';

import { Flexbox, Tag } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChannelPlatformDefinition } from '../const';
import { getPlatformIcon } from '../const';

const styles = createStaticStyles(({ css, cssVar }) => ({
  desc: css`
    max-width: 360px;

    font-size: 14px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
    text-align: center;
  `,
  header: css`
    width: 100%;
    max-width: 1024px;
    padding-block: 16px;
    border-block-end: 1px solid ${cssVar.colorBorder};
  `,
  main: css`
    position: relative;

    overflow-y: auto;
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;

    padding: 24px;

    background: ${cssVar.colorBgContainer};
  `,
  placeholder: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 16px;
    align-items: center;
    justify-content: center;

    width: 100%;
    max-width: 1024px;
    padding-block: 48px;
  `,
  title: css`
    font-size: 18px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
}));

interface ComingSoonDetailProps {
  platformDef: ChannelPlatformDefinition;
}

const ComingSoonDetail = memo<ComingSoonDetailProps>(({ platformDef }) => {
  const { t } = useTranslation('agent');
  const PlatformIcon = getPlatformIcon(platformDef.name);
  const ColorIcon =
    PlatformIcon && 'Color' in PlatformIcon ? (PlatformIcon as any).Color : PlatformIcon;

  return (
    <main className={styles.main}>
      <Flexbox horizontal align="center" className={styles.header} gap={8}>
        {ColorIcon && <ColorIcon size={32} />}
        {platformDef.name}
        <Tag size={'small'}>{t('channel.comingSoon')}</Tag>
      </Flexbox>
      <div className={styles.placeholder}>
        {ColorIcon && <ColorIcon size={64} />}
        <div className={styles.title}>
          {t('channel.comingSoonTitle', { name: platformDef.name })}
        </div>
        <div className={styles.desc}>{t('channel.comingSoonDesc')}</div>
      </div>
    </main>
  );
});

export default ComingSoonDetail;
