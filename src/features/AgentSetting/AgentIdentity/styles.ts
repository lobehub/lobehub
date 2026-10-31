import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

/**
 * Shared surfaces for the identity tab.
 *
 * Filled-and-rounded rather than outlined: a border here would read as a
 * card-inside-a-card boundary (the settings panel is already the container),
 * and the accounts are a list of peers, not separate panels.
 */
const definitions = stylex.create({
  card: {
    paddingBlock: '12px',
    paddingInline: '14px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
  },
  empty: {
    fontSize: '13px',
    lineHeight: 1.6,
    color: cssVar.colorTextTertiary,
    textAlign: 'center',
  },
  icon: {
    flexShrink: 0,
    color: cssVar.colorTextSecondary,
  },
  inboxRow: {
    cursor: 'pointer',
    paddingBlock: '10px',
    paddingInline: '14px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: {
      'default': cssVar.colorFillQuaternary,
      ':hover': cssVar.colorFillTertiary,
    },
  },
  subject: {
    fontSize: '13px',
    color: cssVar.colorTextSecondary,
  },
  unreadDot: {
    flexShrink: 0,
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    backgroundColor: cssVar.colorPrimary,
  },
});

export const identityStyles = {
  card: stylex.props(definitions.card).className ?? '',
  empty: stylex.props(definitions.empty).className ?? '',
  icon: stylex.props(definitions.icon).className ?? '',
  inboxRow: stylex.props(definitions.inboxRow).className ?? '',
  subject: stylex.props(definitions.subject).className ?? '',
  unreadDot: stylex.props(definitions.unreadDot).className ?? '',
};
