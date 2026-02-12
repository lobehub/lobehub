import { type IconSize, type TooltipProps } from '@lobehub/ui';
import { Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { CircleHelp } from 'lucide-react';
import { type CSSProperties } from 'react';
import { memo } from 'react';

interface InfoTooltipProps extends Omit<TooltipProps, 'children'> {
  iconStyle?: CSSProperties;
  size?: IconSize;
}

const InfoTooltip = memo<InfoTooltipProps>(({ size, iconStyle, ...res }) => {
  return (
    <Tooltip {...res}>
      <Icon
        icon={CircleHelp}
        size={size}
        style={{ color: cssVar.colorTextTertiary, ...iconStyle }}
      />
    </Tooltip>
  );
});

export default InfoTooltip;
