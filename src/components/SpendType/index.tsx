import { Icon, Tooltip } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { CircleDotDashed, Database, ImagePlus, MessageSquareText, Video } from 'lucide-react';
import { memo, type ReactNode } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chat: css`
    color: ${cssVar.colorInfo};
  `,
  embedding: css`
    color: ${cssVar.purple};
  `,
  imageGeneration: css`
    color: ${cssVar.colorSuccess};
  `,
  videoGeneration: css`
    color: ${cssVar.colorWarning};
  `,
}));

export type SpendTypeValue = 'chat' | 'embedding' | 'imageGeneration' | 'videoGeneration';

interface SpendTypeProps {
  /** The readable label — shown on hover, since the cell itself is icon-only. */
  children?: ReactNode;
  type: SpendTypeValue;
}

const getIcon = (type: string) => {
  switch (type) {
    case 'chat': {
      return MessageSquareText;
    }
    case 'embedding': {
      return Database;
    }
    case 'imageGeneration': {
      return ImagePlus;
    }
    case 'videoGeneration': {
      return Video;
    }
    default: {
      return CircleDotDashed;
    }
  }
};

const SpendType = memo<SpendTypeProps>(({ type, children }) => (
  <Tooltip title={children}>
    <Icon className={styles[type]} icon={getIcon(type)} size={16} />
  </Tooltip>
));

export default SpendType;
