import { Center, Video } from '@lobehub/ui';
import { memo, type ReactNode, useEffect, useRef, useState } from 'react';

import Loading from '@/components/Loading/CircleLoading';

interface VideoPreviewProps {
  blob: Blob;
  /** Shown instead of the player when Chromium cannot decode the file. */
  fallback: ReactNode;
}

const VideoPreview = memo<VideoPreviewProps>(({ blob, fallback }) => {
  const [videoSrc, setVideoSrc] = useState<string>();
  const [failed, setFailed] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setVideoSrc(objectUrl);
    setFailed(false);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [blob]);

  // A `video/*` MIME type does not mean Chromium can decode the container or
  // codec. <Video> loads through a <source> child, whose `error` event does not
  // bubble, so listen in the capture phase on the wrapper.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const handleError = () => setFailed(true);
    wrapper.addEventListener('error', handleError, true);

    return () => {
      wrapper.removeEventListener('error', handleError, true);
    };
  }, [videoSrc]);

  if (failed) return fallback;
  if (!videoSrc) return <Loading />;

  return (
    <Center height={'100%'} padding={16} width={'100%'}>
      {/* Keyed by the object URL: <Video> feeds it through a <source> child,
          which the element only picks up on mount. */}
      <Video
        key={videoSrc}
        ref={wrapperRef}
        src={videoSrc}
        styles={{ video: { maxHeight: '100%', objectFit: 'contain' }, wrapper: { margin: 0 } }}
        variant={'borderless'}
      />
    </Center>
  );
});

VideoPreview.displayName = 'VideoPreview';

export default VideoPreview;
