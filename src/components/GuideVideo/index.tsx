import { cssVar } from 'antd-style';
import { memo } from 'react';

interface GuideVideoProps {
  height: number;
  src: string;
  width: number;
}

const GuideVideo = memo<GuideVideoProps>(({ height, width, src }) => {
  return (
    <video
      autoPlay
      controls={false}
      height={height}
      loop
      muted
      src={src}
      style={{
        background: cssVar.colorFillSecondary,
        height: 'auto',
        width: '100%',
      }}
      width={width}
    />
  );
});

export default GuideVideo;
