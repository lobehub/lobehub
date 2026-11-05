'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChannelPlatformDefinition } from '../const';
import { getPlatformIcon } from '../const';

const styles = stylex.create({
  desc: {
    maxWidth: '360px',
    fontSize: '14px',
    lineHeight: 1.6,
    color: cssVar.colorTextSecondary,
    textAlign: 'center',
  },
  main: {
    position: 'relative',
    display: 'flex',
    flex: 'none',
    flexDirection: 'column',
    alignItems: 'center',
    width: '100%',
    padding: '24px',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  placeholder: {
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    gap: '16px',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    maxWidth: '1024px',
    paddingBlock: '48px',
  },
  title: { fontSize: '18px', fontWeight: 500, color: cssVar.colorText },
});

interface ComingSoonDetailProps {
  platformDef: ChannelPlatformDefinition;
}

const ComingSoonDetail = memo<ComingSoonDetailProps>(({ platformDef }) => {
  const { t } = useTranslation('agent');
  const PlatformIcon = getPlatformIcon(platformDef.name);
  const ColorIcon =
    PlatformIcon && 'Color' in PlatformIcon ? (PlatformIcon as any).Color : PlatformIcon;

  return (
    <main {...stylex.props(styles.main)}>
      <div {...stylex.props(styles.placeholder)}>
        {ColorIcon && <ColorIcon size={64} />}
        <div {...stylex.props(styles.title)}>
          {t('channel.comingSoonTitle', { name: platformDef.name })}
        </div>
        <div {...stylex.props(styles.desc)}>{t('channel.comingSoonDesc')}</div>
      </div>
    </main>
  );
});

export default ComingSoonDetail;
