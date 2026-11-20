import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';

import { sx } from '@/styles/sx';

const MIN_LABEL_ZOOM = 0.25;

const styles = stylex.create({
  icon: {
    display: 'block',
    flexShrink: 0,
    opacity: 0.22,
  },
  label: {
    alignItems: 'center',
    boxSizing: 'border-box',
    color: cssVar.colorText,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    insetBlockStart: '50%',
    insetInlineStart: '50%',
    justifyContent: 'center',
    overflow: 'hidden',
    padding: 8,
    position: 'absolute',
    textAlign: 'center',
  },
  layer: {
    inset: 0,
    pointerEvents: 'none',
    position: 'absolute',
  },
  status: {
    color: cssVar.colorTextTertiary,
    fontSize: 12,
    lineHeight: '16px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  text: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    maxWidth: '100%',
  },
  title: {
    color: cssVar.colorTextSecondary,
    fontSize: 13,
    fontWeight: 500,
    lineHeight: '18px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  resting: {
    outlineColor: cssVar.colorBorderSecondary,
    outlineStyle: 'solid',
  },
  waiting: {
    backgroundColor: cssVar.colorFillQuaternary,
    outlineColor: cssVar.colorTextQuaternary,
    outlineStyle: 'dashed',
  },
});

interface BoardPlaceholderProps {
  icon?: LucideIcon;
  k: number;
  status?: string;
  title: string;
}

const BoardPlaceholder = ({ icon: StatusIcon, k, status, title }: BoardPlaceholderProps) => {
  const labelZoom = Math.max(k, MIN_LABEL_ZOOM);
  return (
    <div
      {...sx(styles.layer, status ? styles.waiting : styles.resting, {
        outlineOffset: -1 / k,
        outlineWidth: 1 / k,
      })}
    >
      <div
        {...sx(styles.label, {
          height: `${100 * labelZoom}%`,
          transform: `translate(-50%, -50%) scale(${1 / labelZoom})`,
          width: `${100 * labelZoom}%`,
        })}
      >
        {StatusIcon && <StatusIcon size={24} {...stylex.props(styles.icon)} />}
        <span {...stylex.props(styles.text)}>
          <span {...stylex.props(styles.title)}>{title}</span>
          {status && <span {...stylex.props(styles.status)}>{status}</span>}
        </span>
      </div>
    </div>
  );
};

export default BoardPlaceholder;
