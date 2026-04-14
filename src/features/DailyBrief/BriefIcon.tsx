import { type BriefType } from '@lobechat/types';
import { Block, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import type { CircleDot } from 'lucide-react';
import { CheckCheckIcon, EyeIcon, Lightbulb, PencilRulerIcon, SirenIcon } from 'lucide-react';
import { memo } from 'react';

const BRIEF_TYPE_ICON: Record<BriefType, typeof CircleDot> = {
  decision: PencilRulerIcon,
  error: SirenIcon,
  insight: EyeIcon,
  result: CheckCheckIcon,
};

const BRIEF_TYPE_COLOR: Record<BriefType, string | undefined> = {
  decision: cssVar.colorWarning,
  error: cssVar.colorError,
  insight: cssVar.colorInfo,
  result: cssVar.colorSuccess,
} as const;

const BRIEF_TYPE_COLOR_BG: Record<BriefType, string | undefined> = {
  decision: cssVar.colorWarningBgHover,
  error: cssVar.colorErrorBgHover,
  insight: cssVar.colorInfoBgHover,
  result: cssVar.colorSuccessBgHover,
} as const;

interface BriefIconProps {
  size?: number;
  type: BriefType;
}

const BriefIcon = memo<BriefIconProps>(({ size = 28, type }) => {
  const icon = BRIEF_TYPE_ICON[type] || Lightbulb;
  const color = BRIEF_TYPE_COLOR[type] || cssVar.colorPrimary;

  return (
    <Block
      align={'center'}
      height={size}
      justify={'center'}
      width={size}
      style={{
        background: BRIEF_TYPE_COLOR_BG[type],
      }}
    >
      <Icon color={color} icon={icon} size={size * 0.6} />
    </Block>
  );
});

export default BriefIcon;
