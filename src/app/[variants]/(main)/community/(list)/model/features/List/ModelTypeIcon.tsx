import { Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { startCase } from 'es-toolkit/compat';
import { type LucideIcon } from 'lucide-react';
import {
  AudioLines,
  BoltIcon,
  ImageIcon,
  MessageSquareTextIcon,
  MicIcon,
  MusicIcon,
  PhoneIcon,
  VideoIcon,
} from 'lucide-react';
import { type AiModelType } from 'model-bank';
import { memo } from 'react';

const icons: Record<AiModelType, LucideIcon> = {
  chat: MessageSquareTextIcon,
  embedding: BoltIcon,
  image: ImageIcon,
  realtime: PhoneIcon,
  stt: MicIcon,
  text2music: MusicIcon,
  text2video: VideoIcon,
  tts: AudioLines,
};

const ModelTypeIcon = memo<{ size?: number; type: AiModelType }>(({ type, size = 20 }) => {
  return (
    <Tooltip title={`${startCase(type)} Model`}>
      <Icon color={cssVar.colorTextDescription} icon={icons?.[type]} size={size} />
    </Tooltip>
  );
});

export default ModelTypeIcon;
