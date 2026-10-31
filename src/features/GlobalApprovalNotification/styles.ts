import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

const footerBackground = `color-mix(in srgb, ${cssVar.colorBgElevated} 92%, ${cssVar.colorFillSecondary})`;

export const styles = stylex.create({
  // Footer hosting the approve / reject actions (portal target). Hidden until
  // the Intervention component fills it.
  actions: {
    backgroundColor: footerBackground,
    backgroundImage: 'none',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: '1px',
    display: { 'default': null, ':empty': 'none' },
    paddingBlockEnd: '12px',
    paddingBlockStart: '8px',
    paddingInline: '12px',
  },
  // Goal cards' footer: the dismiss text button on the left, the form's own
  // actions (portal target) filling the rest.
  goalActions: {
    alignItems: 'center',
    backgroundColor: footerBackground,
    backgroundImage: 'none',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: '1px',
    display: 'flex',
    gap: '8px',
    paddingBlockEnd: '12px',
    paddingBlockStart: '8px',
    paddingInline: '12px',
  },
  reviewSummary: {
    color: cssVar.colorTextSecondary,
    fontSize: '14px',
    lineHeight: 1.6,
    paddingBlockEnd: '8px',
    paddingBlockStart: '4px',
  },
  goalActionsSlot: {
    flex: '1',
    minWidth: 0,
  },
  card: {
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: '1px',
    boxShadow: cssVar.boxShadowSecondary,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    pointerEvents: 'auto',
    width: '100%',
  },
  content: {
    flex: '1',
    maxHeight: '42vh',
    minHeight: 0,
    overflowY: 'auto',
    paddingBlockEnd: '8px',
    paddingBlockStart: '6px',
    paddingInline: '12px',
  },
  header: {
    alignItems: 'center',
    display: 'flex',
    gap: '8px',
    paddingBlock: '8px',
    paddingInline: '12px',
  },
  headerMeta: {
    flex: '1',
    minWidth: 0,
    overflow: 'hidden',
  },
  headerSubtitle: {
    alignItems: 'baseline',
    color: cssVar.colorTextTertiary,
    display: 'flex',
    fontSize: '12px',
    gap: '8px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  // The name leading the subtitle.
  headerSubtitleName: {
    color: cssVar.colorText,
    fontSize: '14px',
    fontWeight: 500,
  },
  headerTitle: {
    color: cssVar.colorText,
    fontSize: '16px',
    fontWeight: 600,
    overflowWrap: 'anywhere',
  },
  // "+N more pending" hint shown when several conversations are waiting; only
  // the top card is actionable at once.
  moreHint: {
    alignSelf: 'center',
    color: cssVar.colorTextTertiary,
    fontSize: '12px',
    paddingBlock: '2px',
    pointerEvents: 'auto',
  },
  // Collapsed "dynamic island" pill.
  pill: {
    alignItems: 'center',
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '999px',
    borderStyle: 'solid',
    borderWidth: '1px',
    boxShadow: cssVar.boxShadowSecondary,
    color: cssVar.colorText,
    cursor: 'pointer',
    display: 'flex',
    fontSize: '13px',
    gap: '8px',
    height: '36px',
    paddingInline: '14px',
    pointerEvents: 'auto',
  },
  pillDot: {
    backgroundColor: cssVar.colorPrimary,
    backgroundImage: 'none',
    borderRadius: '999px',
    flexShrink: 0,
    height: '7px',
    width: '7px',
  },
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    width: '100%',
  },
  // The user request that triggered the tool call — context for the approval.
  // Rendered with the same Markdown component as the User chat bubble, so
  // formatting / skill tags read consistently. A long request scrolls inside a
  // capped body rather than hard-truncating, so the full context stays reachable.
  requestContext: {
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: '1px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    paddingBlockEnd: '12px',
    paddingBlockStart: '4px',
    paddingInline: '12px',
  },
  // The Markdown block's outer margins are trimmed in userRequest.module.css.
  userRequestBody: {
    maxHeight: '120px',
    overflowY: 'auto',
  },
  // Top-center fixed wrapper. The wrapper ignores pointer events so it never
  // blocks the page; only the cards / pill re-enable them.
  wrapper: {
    alignItems: 'center',
    display: 'flex',
    flexDirection: 'column',
    insetBlockStart: 'var(--global-approval-top, 16px)',
    insetInlineStart: '50%',
    pointerEvents: 'none',
    position: 'fixed',
    transform: 'translateX(-50%)',
    width: 'min(640px, 92vw)',
    zIndex: 1000,
  },
});
