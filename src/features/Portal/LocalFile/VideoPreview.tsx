import { Center, Video } from '@lobehub/ui';
import { memo, useEffect, useState } from 'react';

import Loading from '@/components/Loading/CircleLoading';

interface VideoPreviewProps {
  blob: Blob;
}

const VideoPreview = memo<VideoPreviewProps>(({ blob }) => {
  const [videoSrc, setVideoSrc] = useState<string>();

  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setVideoSrc(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [blob]);

  if (!videoSrc) return <Loading />;

  return (
    <Center height={'100%'} padding={16} width={'100%'}>
      {/* Keyed by the object URL: <Video> feeds it through a <source> child,
          which the element only picks up on mount. */}
      <Video
        key={videoSrc}
        src={videoSrc}
        styles={{ video: { maxHeight: '100%', objectFit: 'contain' }, wrapper: { margin: 0 } }}
        variant={'borderless'}
      />
    </Center>
  );
});

VideoPreview.displayName = 'VideoPreview';

export default VideoPreview;
