'use client';

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
  main: css`
    position: relative;

    display: flex;
    flex: none;
    flex-direction: column;
    align-items: center;

    width: 100%;
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
