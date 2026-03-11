'use client';

import { Center } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    padding: ${cssVar.paddingSM};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  video: css`
    max-width: 100%;
    max-height: 100%;
    border-radius: ${cssVar.borderRadius};

    object-fit: contain;
    box-shadow: ${cssVar.boxShadowTertiary};

    &::-webkit-media-controls-panel {
      background: linear-gradient(to bottom, transparent 0%, rgb(0 0 0 / 30%) 100%);
    }

    &:focus {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }
  `,
}));

interface VideoViewerProps {
  fileId: string;
  url: string | null;
}

const VideoViewer = memo<VideoViewerProps>(({ url }) => {
  if (!url) return null;

  return (
    <Center className={styles.container} height={'100%'} width={'100%'}>
      <video controls className={styles.video} height={'100%'} src={url} width={'100%'} />
    </Center>
  );
});

export default VideoViewer;
