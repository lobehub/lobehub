'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { AgentBottomPendant, AgentTopPendant } from './resolveAgentBadge';

const styles = stylex.create({
  // Both pendants are absolutely positioned over the avatar, so wearing one
  // never changes the card height or shifts the name baseline.
  root: {
    display: 'inline-flex',
    flex: 'none',
    position: 'relative',
  },
  chip: {
    borderColor: cssVar.colorBgContainer,
    borderStyle: 'solid',
    borderWidth: 1.5,
    boxShadow: cssVar.boxShadowTertiary,
    color: cssVar.colorTextLightSolid,
    fontSize: 10,
    fontWeight: 600,
    insetInlineStart: '50%',
    lineHeight: '16px',
    maxWidth: 'calc(100% + 16px)',
    overflow: 'hidden',
    paddingInline: 6,
    pointerEvents: 'none',
    position: 'absolute',
    textOverflow: 'ellipsis',
    transform: 'translateX(-50%)',
    whiteSpace: 'nowrap',
    zIndex: 1,
  },
  bottom: {
    borderRadius: 999,
    insetBlockEnd: -6,
  },
  // Arch cap: rounded top, flatter bottom, sitting on the avatar's crown.
  top: {
    borderEndEndRadius: 4,
    borderEndStartRadius: 4,
    borderStartEndRadius: 9,
    borderStartStartRadius: 9,
    insetBlockStart: -10,
  },
  // White 10px text needs a dark enough plate: darken free-form label colors
  // (gray / yellow presets) before use.
  official: {
    backgroundColor: cssVar.colorPrimary,
  },
  event: {
    backgroundColor: cssVar.colorErrorActive,
  },
  eventColor: (color: string) => ({
    backgroundColor: `color-mix(in srgb, ${color} 62%, black)`,
  }),
});

interface AgentPendantProps {
  bottom?: AgentBottomPendant;
  children: ReactNode;
  top?: AgentTopPendant;
}

/** Avatar pendants: an identity chip on the chin and an event arch on the crown. */
const AgentPendant = memo<AgentPendantProps>(({ bottom, children, top }) => {
  const { t } = useTranslation('common');

  return (
    <span {...stylex.props(styles.root)}>
      {children}
      {top ? (
        <span
          {...stylex.props(
            styles.chip,
            styles.top,
            styles.event,
            top.color ? styles.eventColor(top.color) : null,
          )}
        >
          {top.label}
        </span>
      ) : null}
      {bottom ? (
        <span {...stylex.props(styles.chip, styles.bottom, styles[bottom])}>
          {t(`agentViewAll.pendant.${bottom}`)}
        </span>
      ) : null}
    </span>
  );
});

AgentPendant.displayName = 'AgentPendant';

export default AgentPendant;
