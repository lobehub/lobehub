import { Center, Video } from '@lobehub/ui';
import { memo, useEffect, useRef } from 'react';

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
    const wrapperRef = useRef<HTMLDivElement>(null);
    const src = state.status === 'ready' ? state.src : undefined;

    // A `video/*` MIME type does not mean Chromium can decode the container or
    // codec. <Video> loads through a <source> child, whose `error` event does not
    // bubble, so listen in the capture phase on the wrapper.
    useEffect(() => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;

      wrapper.addEventListener('error', markUnplayable, true);

      return () => {
        wrapper.removeEventListener('error', markUnplayable, true);
      };
    }, [markUnplayable, src]);

    if (state.status === 'unplayable')
      return <UnsupportedPreview isLocalFile filePath={filePath} oversized={state.oversized} />;
    if (!src) return <Loading />;

    return (
      <Center height={'100%'} padding={16} width={'100%'}>
        {/* Keyed by the object URL: <Video> feeds it through a <source> child,
          which the element only picks up on mount. */}
        <Video
          key={src}
          ref={wrapperRef}
          src={src}
          styles={{ video: { maxHeight: '100%', objectFit: 'contain' }, wrapper: { margin: 0 } }}
          variant={'borderless'}
        />
      </Center>
    );
  },
);

VideoPreview.displayName = 'VideoPreview';

export default VideoPreview;
