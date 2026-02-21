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
      loop
      muted
      controls={false}
      height={height}
      src={src}
      width={width}
      style={{
        background: cssVar.colorFillSecondary,
        height: 'auto',
        width: '100%',
      }}
    />
  );
});

export default GuideVideo;
