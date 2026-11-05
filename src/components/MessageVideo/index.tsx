'use client';

import { Video } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ExternalLink } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

// Mirrors the @lobehub/ui (6.15) Video control-bar button style, which the library does not export.
const styles = stylex.create({
  action: {
    cursor: 'pointer',
    display: 'inline-flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 28,
    height: 28,
    padding: 0,
    borderRadius: 6,
    color: 'inherit',
    backgroundColor: { ':hover': '#ffffff1f', 'default': 'transparent' },
    outline: { ':focus-visible': '2px solid #fff9', 'default': 'none' },
  },
});

export interface MessageVideoProps {
  maxHeight?: number;
  poster?: string;
  src: string;
}

/**
 * Inline video player for conversation messages and tool renders, built on the
 * @lobehub/ui Video player with an open-original-file action.
 */
const MessageVideo = memo<MessageVideoProps>(({ maxHeight = 400, poster, src }) => {
  const { t } = useTranslation('common');

  return (
    <Video.Root maxHeight={maxHeight} poster={poster} src={src}>
      <Video.Frame>
        <Video.Caption />
        <Video.CenterPlay />
        <Video.Controls
          extra={
            // Stored files are served cross-origin, where `download` is ignored, so open the
            // original in a new tab and let the browser save it from there.
            <a
              aria-label={t('openOriginalFile')}
              {...stylex.props(styles.action)}
              href={src}
              rel="noreferrer"
              target="_blank"
              title={t('openOriginalFile')}
            >
              <ExternalLink size={15} />
            </a>
          }
        >
          <Video.Timeline />
        </Video.Controls>
        <Video.LoadError />
      </Video.Frame>
    </Video.Root>
  );
});

MessageVideo.displayName = 'MessageVideo';

export default MessageVideo;
