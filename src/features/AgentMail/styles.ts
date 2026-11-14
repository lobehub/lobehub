import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

/**
 * Shared surfaces for the mail page.
 *
 * Filled-and-rounded rather than outlined: a border here would read as a
 * card-inside-a-card boundary (the settings panel is already the container),
 * and the accounts are a list of peers, not separate panels.
 */
const definitions = stylex.create({
  accounts: {
    flexShrink: 0,
    overflowY: 'auto',
    maxHeight: '40%',
  },
  card: {
    paddingBlock: '12px',
    paddingInline: '14px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
  },
  detailPane: {
    overflowY: 'auto',
    minWidth: 0,
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
      'default': 'transparent',
      ':hover': cssVar.colorFillTertiary,
    },
  },
  inboxRowSelected: {
    backgroundColor: {
      'default': cssVar.colorFillSecondary,
      ':hover': cssVar.colorFillSecondary,
    },
  },
  listPane: {
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    width: '384px',
    minHeight: 0,
    borderInlineEndWidth: '1px',
    borderInlineEndStyle: 'solid',
    borderInlineEndColor: cssVar.colorBorderSecondary,
  },
  mailboxTrigger: {
    // The dropdown tints an open trigger; on a card that reads as a stray box.
    backgroundColor: 'transparent',
    display: 'flex',
    flex: '1',
    gap: '8px',
    alignItems: 'center',
    cursor: 'pointer',
    minWidth: 0,
  },
  mobileDetail: {
    position: 'absolute',
    inset: 0,
    zIndex: 1,
    backgroundColor: cssVar.colorBgContainer,
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
  accounts: stylex.props(definitions.accounts).className ?? '',
  card: stylex.props(definitions.card).className ?? '',
  detailPane: stylex.props(definitions.detailPane).className ?? '',
  empty: stylex.props(definitions.empty).className ?? '',
  icon: stylex.props(definitions.icon).className ?? '',
  inboxRow: stylex.props(definitions.inboxRow).className ?? '',
  inboxRowSelected:
    stylex.props(definitions.inboxRow, definitions.inboxRowSelected).className ?? '',
  listPane: stylex.props(definitions.listPane).className ?? '',
  mailboxTrigger: stylex.props(definitions.mailboxTrigger).className ?? '',
  mobileDetail: stylex.props(definitions.mobileDetail).className ?? '',
  subject: stylex.props(definitions.subject).className ?? '',
  unreadDot: stylex.props(definitions.unreadDot).className ?? '',
};
