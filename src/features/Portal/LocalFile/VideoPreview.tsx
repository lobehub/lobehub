import { Center, Video } from '@lobehub/ui';
import { memo, useEffect, useRef, useState } from 'react';

import Loading from '@/components/Loading/CircleLoading';
import { localFileService } from '@/services/electron/localFileService';

import UnsupportedPreview from './UnsupportedPreview';

type VideoState =
  | { status: 'loading' }
  | { src: string; status: 'ready' }
  | { oversized: boolean; status: 'unplayable' };

interface VideoPreviewProps {
  allowExternalFile?: boolean;
  filePath: string;
  workingDirectory: string;
}

/**
 * Local desktop video player. It reads the file itself rather than through the
 * session-long SWR preview cache, so the bytes (up to 200 MB) live only while
 * this view is mounted: unmounting aborts an in-flight read and revokes the
 * object URL.
 */
const VideoPreview = memo<VideoPreviewProps>(
  ({ allowExternalFile, filePath, workingDirectory }) => {
    const [state, setState] = useState<VideoState>({ status: 'loading' });
    const wrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      const controller = new AbortController();
      let objectUrl: string | undefined;
      setState({ status: 'loading' });

      localFileService
        .readLocalVideo({ allowExternalFile, path: filePath, workingDirectory }, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          if (!result.ok) {
            setState({ oversized: true, status: 'unplayable' });
            return;
          }
          objectUrl = URL.createObjectURL(result.blob);
          setState({ src: objectUrl, status: 'ready' });
        })
        .catch(() => {
          if (!controller.signal.aborted) setState({ oversized: false, status: 'unplayable' });
        });

      return () => {
        controller.abort();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    }, [allowExternalFile, filePath, workingDirectory]);

    const src = state.status === 'ready' ? state.src : undefined;

    // A `video/*` MIME type does not mean Chromium can decode the container or
    // codec. <Video> loads through a <source> child, whose `error` event does not
    // bubble, so listen in the capture phase on the wrapper.
    useEffect(() => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;

      const handleError = () => setState({ oversized: false, status: 'unplayable' });
      wrapper.addEventListener('error', handleError, true);

      return () => {
        wrapper.removeEventListener('error', handleError, true);
      };
    }, [src]);

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
