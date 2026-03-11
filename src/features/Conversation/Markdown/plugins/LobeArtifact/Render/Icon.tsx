import { SiReact } from '@icons-pack/react-simple-icons';
import { Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { CodeXml, GlobeIcon, ImageIcon, Loader2, OrigamiIcon } from 'lucide-react';
import { memo } from 'react';

interface ArtifactProps {
  type: string;
}

const SIZE = 28;
const ArtifactIcon = memo<ArtifactProps>(({ type }) => {
  if (!type)
    return <Icon spin icon={Loader2} size={SIZE} style={{ color: cssVar.colorTextSecondary }} />;

  switch (type) {
    case 'application/lobe.artifacts.code': {
      return <Icon icon={CodeXml} size={SIZE} style={{ color: cssVar.colorTextSecondary }} />;
    }

    case 'application/lobe.artifacts.react': {
      return <SiReact size={SIZE} style={{ color: cssVar.colorTextSecondary }} />;
    }

    case 'image/svg+xml': {
      return <Icon icon={ImageIcon} size={SIZE} style={{ color: cssVar.colorTextSecondary }} />;
    }
    case 'text/html': {
      return <Icon icon={GlobeIcon} size={SIZE} style={{ color: cssVar.colorTextSecondary }} />;
    }
    default: {
      return (
        <Icon color={cssVar.purple} icon={OrigamiIcon} size={{ size: SIZE, strokeWidth: 1.2 }} />
      );
    }
  }
});

export default ArtifactIcon;
