'use client';

import { Button, Icon, useVideoState, type VideoPlayer } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Info, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  root: {
    position: 'absolute',
    zIndex: 2,
    insetBlockStart: 0,
    insetBlockEnd: 0,
    insetInlineStart: 0,
    insetInlineEnd: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
    fontSize: '14px',
    lineHeight: '22px',
    color: cssVar.colorText,
    textAlign: 'center',
    backgroundColor: cssVar.colorBgLayout,
    backgroundImage: 'none',
  },
  icon: { color: cssVar.colorWarning },
  title: { fontWeight: 600 },
  body: { margin: 0, color: cssVar.colorTextSecondary },
  actions: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    marginBlockStart: '4px',
  },
  download: {
    fontSize: '12px',
    lineHeight: '20px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    textDecorationLine: 'underline',
    textUnderlineOffset: '2px',
  },
});

const reloadVideo = (player: VideoPlayer) => {
  // lobe-ui's store resets its own status in reload(), which VideoPlayer does
  // not declare; a bare video.load() would leave the player reporting an error.
  if ('reload' in player && typeof player.reload === 'function') player.reload();
  else player.video?.load();
};

interface VideoLoadFailedProps {
  onRetry?: () => Promise<unknown> | void;
  player: VideoPlayer;
  src: string;
}

export const VideoLoadFailed = ({ onRetry, player, src }: VideoLoadFailedProps) => {
  const { t } = useTranslation('verify');
  const failed = useVideoState(player, (state) => state.status === 'error');
  const [retrying, setRetrying] = useState(false);
  if (!failed) return null;

  const retry = async () => {
    setRetrying(true);
    try {
      await onRetry?.();
      reloadVideo(player);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div role={'alert'} {...stylex.props(styles.root)}>
      <Icon icon={Info} size={24} {...stylex.props(styles.icon)} />
      <div {...stylex.props(styles.title)}>{t('acceptance.video.story.loadFailedTitle')}</div>
      <p {...stylex.props(styles.body)}>{t('acceptance.video.story.loadFailedBody')}</p>
      <div {...stylex.props(styles.actions)}>
        <Button icon={RefreshCw} loading={retrying} onClick={() => void retry()}>
          {t('acceptance.video.reload')}
        </Button>
        <a href={src} rel={'noreferrer'} target={'_blank'} {...stylex.props(styles.download)}>
          {t('acceptance.video.download')}
        </a>
      </div>
    </div>
  );
};
