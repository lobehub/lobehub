import { Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  AudioLines,
  Bot,
  CircleDotDashed,
  Database,
  FileText,
  Globe,
  ImagePlus,
  MessageSquareText,
  Mic,
  Music,
  Video,
} from 'lucide-react';
import { memo, type ReactNode } from 'react';

const styles = stylex.create({
  agentRun: { color: cssVar.geekblue },
  chat: { color: cssVar.colorInfo },
  embedding: { color: cssVar.purple },
  imageGeneration: { color: cssVar.colorSuccess },
  musicGeneration: { color: cssVar.volcano },
  speechRecognition: { color: cssVar.colorInfo },
  textToSpeech: { color: cssVar.cyan },
  videoGeneration: { color: cssVar.colorWarning },
  webCrawl: { color: cssVar.gold },
  webSearch: { color: cssVar.blue },
});

export type SpendTypeValue =
  | 'agentRun'
  | 'chat'
  | 'embedding'
  | 'imageGeneration'
  | 'musicGeneration'
  | 'speechRecognition'
  | 'textToSpeech'
  | 'videoGeneration'
  | 'webCrawl'
  | 'webSearch';

interface SpendTypeProps {
  /** The readable label — shown on hover, since the cell itself is icon-only. */
  children?: ReactNode;
  type: SpendTypeValue;
}

const getIcon = (type: string) => {
  switch (type) {
    case 'agentRun': {
      return Bot;
    }
    case 'chat': {
      return MessageSquareText;
    }
    case 'embedding': {
      return Database;
    }
    case 'imageGeneration': {
      return ImagePlus;
    }
    case 'musicGeneration': {
      return Music;
    }
    case 'speechRecognition': {
      return Mic;
    }
    case 'textToSpeech': {
      return AudioLines;
    }
    case 'videoGeneration': {
      return Video;
    }
    case 'webCrawl': {
      return FileText;
    }
    case 'webSearch': {
      return Globe;
    }
    default: {
      return CircleDotDashed;
    }
  }
};

const SpendType = memo<SpendTypeProps>(({ type, children }) => (
  <Tooltip title={children}>
    <Icon className={stylex.props(styles[type]).className} icon={getIcon(type)} size={16} />
  </Tooltip>
));

export default SpendType;
