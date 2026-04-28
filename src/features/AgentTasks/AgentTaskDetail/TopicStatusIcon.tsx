import { Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CircleX,
  type LucideIcon,
} from 'lucide-react';
import { memo } from 'react';

type TopicRunStatus = 'canceled' | 'completed' | 'failed' | 'pending' | 'running' | 'timeout';

const STATIC_META: Record<
  Exclude<TopicRunStatus, 'running'>,
  { color: string; icon: LucideIcon }
> = {
  canceled: { color: cssVar.colorTextSecondary, icon: CircleSlash },
  completed: { color: cssVar.colorSuccess, icon: CircleCheck },
  failed: { color: cssVar.colorError, icon: CircleX },
  pending: { color: cssVar.colorTextQuaternary, icon: CircleDashed },
  timeout: { color: cssVar.colorWarning, icon: CircleAlert },
};

const RunningIcon = memo<{ size: number }>(({ size }) => {
  const mainColor = cssVar.colorWarning;
  const ringColor = `color-mix(in srgb, ${cssVar.colorWarning} 35%, transparent)`;
  return (
    <svg aria-hidden fill="none" height={size} viewBox="0 0 16 16" width={size}>
      <circle cx="8" cy="8" r="6.5" stroke={ringColor} strokeWidth="1.5" />
      <path
        d="M14.5 8 A 6.5 6.5 0 0 1 8 14.5"
        fill="none"
        stroke={mainColor}
        strokeLinecap="round"
        strokeWidth="1.5"
      >
        <animateTransform
          attributeName="transform"
          dur="1s"
          from="0 8 8"
          repeatCount="indefinite"
          to="360 8 8"
          type="rotate"
        />
      </path>
      <circle cx="8" cy="8" fill={mainColor} r="2.5" stroke={ringColor} strokeWidth="1" />
    </svg>
  );
});

interface TopicStatusIconProps {
  size?: number;
  status?: string | null;
}

const TopicStatusIcon = memo<TopicStatusIconProps>(({ size = 16, status }) => {
  if (status === 'running') return <RunningIcon size={size} />;
  const key = (status ?? 'pending') as keyof typeof STATIC_META;
  const meta = STATIC_META[key] ?? STATIC_META.pending;
  return <Icon color={meta.color} icon={meta.icon} size={size} />;
});

export default TopicStatusIcon;
