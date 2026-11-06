'use client';

import { Center } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

const CONTROLS = '::-webkit-media-controls-panel';

const styles = stylex.create({
  container: {
    padding: cssVar.paddingSM,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  video: {
    maxWidth: '100%',
    maxHeight: '100%',
    borderRadius: cssVar.borderRadius,
    objectFit: 'contain',
    boxShadow: cssVar.boxShadowTertiary,
    outlineColor: { 'default': null, ':focus': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus': '2px' },
    outlineStyle: { 'default': null, ':focus': 'solid' },
    outlineWidth: { 'default': null, ':focus': '2px' },
    backgroundColor: { default: null, [CONTROLS]: 'transparent' },
    backgroundImage: {
      default: null,
      [CONTROLS]: 'linear-gradient(to bottom, transparent 0%, rgb(0 0 0 / 30%) 100%)',
    },
    backgroundPosition: { default: null, [CONTROLS]: '0% 0%' },
    backgroundSize: { default: null, [CONTROLS]: 'auto' },
    backgroundRepeat: { default: null, [CONTROLS]: 'repeat' },
    backgroundOrigin: { default: null, [CONTROLS]: 'padding-box' },
    backgroundClip: { default: null, [CONTROLS]: 'border-box' },
    backgroundAttachment: { default: null, [CONTROLS]: 'scroll' },
  },
});

interface VideoViewerProps {
  fileId: string;
  url: string | null;
}

const VideoViewer = memo<VideoViewerProps>(({ url }) => {
  if (!url) return null;

  return (
    <Center className={stylex.props(styles.container).className} height={'100%'} width={'100%'}>
      <video
        controls
        className={stylex.props(styles.video).className}
        height={'100%'}
        src={url}
        width={'100%'}
      />
    </Center>
  );
});

export default VideoViewer;
