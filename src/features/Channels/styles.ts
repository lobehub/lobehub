import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

const HOVER = '@media (hover: hover)';

export const styles = stylex.create({
  layout: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    color: cssVar.colorText,
    backgroundColor: cssVar.colorBgContainer,
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    flex: '1',
    minWidth: 0,
    minHeight: 0,
  },
  conversations: {
    position: 'relative',
    overflow: 'hidden',
    flex: '1',
    minWidth: 0,
    minHeight: 0,
  },
  threadPanel: {
    zIndex: 10,
    flexShrink: 0,
    height: '100%',
    backgroundColor: cssVar.colorBgContainer,
  },
  threadContent: {
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
  },
  threadHeader: {
    borderBlockEndWidth: 1,
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  feed: {
    overflowY: 'auto',
    flex: '1',
    minHeight: 0,
    paddingBlockStart: 8,
    paddingBlockEnd: 24,
  },
  /** One message row; hovering highlights it and reveals its toolbar, like a chat app. */
  messageRow: {
    position: 'relative',
    marginInline: -12,
    paddingInline: 12,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: {
      default: 'transparent',
      [HOVER]: { 'default': 'transparent', ':hover': cssVar.colorFillQuaternary },
    },
  },
  messageAvatar: {
    position: 'absolute',
    insetBlockStart: 12,
    insetInlineStart: 0,
  },
  /** Floats over the row's top-right corner while the row is hovered or focused. */
  messageToolbar: {
    position: 'absolute',
    insetBlockStart: 6,
    insetInlineEnd: 12,
    zIndex: 1,
    display: 'flex',
    alignItems: 'center',
    padding: 2,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorBgElevated,
    boxShadow: cssVar.boxShadowTertiary,
    opacity: {
      default: 1,
      [HOVER]: {
        default: 0,
        [stylex.when.ancestor(':hover')]: 1,
        [stylex.when.ancestor(':focus-within')]: 1,
      },
    },
    pointerEvents: {
      default: 'auto',
      [HOVER]: {
        default: 'none',
        [stylex.when.ancestor(':hover')]: 'auto',
        [stylex.when.ancestor(':focus-within')]: 'auto',
      },
    },
  },
  /** Inline system line in the timeline, such as who joined. */
  event: {
    paddingBlock: 8,
    paddingInlineStart: 48,
    fontSize: cssVar.fontSizeSM,
    lineHeight: 1.8,
    color: cssVar.colorTextSecondary,
  },
  eventMember: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    maxWidth: '100%',
    marginInline: 2,
    verticalAlign: 'baseline',
  },
  eventMemberName: {
    // Let the name supply the inline flex baseline instead of the avatar.
    alignSelf: 'baseline',
    minWidth: 0,
    overflowWrap: 'anywhere',
  },
  /** A mentioned member inside message text. */
  mention: {
    paddingBlock: 1,
    paddingInline: 4,
    borderRadius: 4,
    fontWeight: 500,
    color: cssVar.colorInfo,
    backgroundColor: cssVar.colorInfoBg,
  },
  composer: {
    flexShrink: 0,
    paddingBlockEnd: 12,
  },
  /** Typing activity above the input; keeps its height when empty. */
  composerStatus: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minWidth: 0,
    minHeight: 24,
    paddingInline: 4,
  },
  /** Attach, editor and send on one line; the editor grows and then scrolls. */
  composerRow: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 4,
    paddingBlock: 4,
    paddingInline: 4,
  },
  composerEditor: {
    overflowY: 'auto',
    flex: '1',
    minWidth: 0,
    maxHeight: 240,
    paddingBlock: 0,
  },
  /** Takes the composer's place while the channel or thread is archived. */
  archivedNotice: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBlockEnd: 12,
    paddingBlock: 8,
    paddingInline: 16,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    fontSize: 13,
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillQuaternary,
  },
  muted: {
    fontSize: 12,
    color: cssVar.colorTextSecondary,
  },
  error: {
    fontSize: 13,
    color: cssVar.colorError,
  },
});

export const statusStyles = stylex.create({
  receipts: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    fontSize: cssVar.fontSizeSM,
  },
  state: {
    display: 'inline-flex',
    gap: 4,
    alignItems: 'center',
  },
  dot: {
    flex: 'none',
    width: 6,
    height: 6,
    borderRadius: '50%',
    backgroundColor: 'currentcolor',
  },
  /** A bare red dot beside a message whose reply failed. */
  failureMark: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 18,
    height: 18,
    padding: 0,
    borderWidth: 0,
    borderRadius: '50%',
    color: cssVar.colorError,
    cursor: 'pointer',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorErrorBg },
  },
  failureButton: {
    flex: 'none',
    gap: 4,
    height: 28,
    paddingInline: 6,
  },
  replyList: {
    overflowY: 'auto',
    maxHeight: 'min(480px, 60vh)',
  },
  popover: {
    width: 288,
    maxWidth: 'calc(100vw - 48px)',
    fontSize: cssVar.fontSizeSM,
    color: cssVar.colorText,
    overflowWrap: 'anywhere',
  },
  memberButton: {
    flex: 'none',
    gap: 4,
    height: 32,
    paddingBlock: 4,
    paddingInline: 4,
  },
  memberAvatar: {
    position: 'relative',
    display: 'inline-flex',
    flex: 'none',
  },
  /** Tall enough for a typical roster without scrolling; longer lists scroll. */
  memberList: {
    overflowY: 'auto',
    maxHeight: 'min(520px, 60vh)',
  },
  memberDot: {
    position: 'absolute',
    insetBlockEnd: -1,
    insetInlineEnd: -1,
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: cssVar.colorBgContainer,
    borderRadius: '50%',
  },
});

export const toneStyles = stylex.create({
  attention: { color: cssVar.colorWarning },
  done: { color: cssVar.colorTextSecondary },
  error: { color: cssVar.colorError },
  quiet: { color: cssVar.colorTextSecondary },
  working: { color: cssVar.colorInfo },
});

const blink = stylex.keyframes({
  '0%, 80%, 100%': { opacity: 0.25 },
  '40%': { opacity: 1 },
});

export const activityStyles = stylex.create({
  line: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
    maxWidth: '100%',
    fontSize: cssVar.fontSizeSM,
  },
  button: {
    height: 24,
    paddingInline: 4,
    color: cssVar.colorTextSecondary,
  },
  avatars: {
    display: 'inline-flex',
    flex: 'none',
    gap: 2,
  },
  label: {
    overflow: 'hidden',
    minWidth: 0,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  dots: {
    display: 'inline-flex',
    flex: 'none',
    gap: 3,
    alignItems: 'center',
  },
  typingDot: {
    width: 4,
    height: 4,
    borderRadius: '50%',
    backgroundColor: 'currentcolor',
    animationName: {
      'default': blink,
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
    animationDuration: '1.2s',
    animationIterationCount: 'infinite',
  },
  delay: (index: number) => ({ animationDelay: `${index * 160}ms` }),
});
