import { Center, Video } from '@lobehub/ui';
import { memo } from 'react';

import Loading from '@/components/Loading/CircleLoading';

import UnsupportedPreview from './UnsupportedPreview';
import { useLocalVideo } from './useLocalVideo';

interface VideoPreviewProps {
  allowExternalFile?: boolean;
  filePath: string;
  revision: string;
  workingDirectory: string;
}

/** Local desktop video player; see `useLocalVideo` for how the bytes are held. */
const VideoPreview = memo<VideoPreviewProps>(
  ({ allowExternalFile, filePath, revision, workingDirectory }) => {
    const { markUnplayable, state } = useLocalVideo({
      allowExternalFile,
      filePath,
      revision,
      workingDirectory,
    });
    const src = state.status === 'ready' ? state.src : undefined;

    if (state.status === 'unplayable')
      return <UnsupportedPreview isLocalFile filePath={filePath} oversized={state.oversized} />;
    if (!src) return <Loading />;

    return (
      <Center height={'100%'} padding={16} width={'100%'}>
        {/* A `video/*` MIME type does not mean Chromium can decode the container
          or codec; the element's own error event marks it unplayable. */}
        <Video
          src={src}
          style={{ background: 'transparent', height: '100%', maxWidth: '100%' }}
          styles={{
            frame: {
              borderRadius: 8,
              height: '100%',
              marginInline: 'auto',
              maxWidth: '100%',
              width: 'auto',
            },
          }}
          onError={markUnplayable}
        />
      </Center>
    );
  },
);

VideoPreview.displayName = 'VideoPreview';

export default VideoPreview;
