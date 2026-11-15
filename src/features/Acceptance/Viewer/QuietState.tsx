'use client';

import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import type { StyleXStyles } from '@stylexjs/stylex';
import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBlock: '24px',
    paddingInline: '24px',
    textAlign: 'center',
  },
  icon: { display: 'inline-flex' },
  muted: { color: cssVar.colorTextTertiary },
  warning: { color: cssVar.colorWarning },
  title: {
    fontSize: '14px',
    fontWeight: 600,
    lineHeight: '22px',
    color: cssVar.colorText,
  },
  description: {
    maxWidth: '280px',
    margin: '0',
    fontSize: '14px',
    lineHeight: '22px',
    color: cssVar.colorTextSecondary,
  },
  action: { marginBlockStart: '4px' },
});

interface QuietStateProps {
  action?: ReactNode;
  description?: ReactNode;
  icon: LucideIcon;
  title: ReactNode;
  tone?: 'muted' | 'warning';
  xstyle?: StyleXStyles;
}

const QuietState = ({
  action,
  description,
  icon,
  title,
  tone = 'muted',
  xstyle,
}: QuietStateProps) => (
  <div {...stylex.props(styles.root, xstyle)}>
    <span {...stylex.props(styles.icon, styles[tone])}>
      <Icon icon={icon} size={24} />
    </span>
    <div {...stylex.props(styles.title)}>{title}</div>
    {description && <p {...stylex.props(styles.description)}>{description}</p>}
    {action && <div {...stylex.props(styles.action)}>{action}</div>}
  </div>
);

export default QuietState;
