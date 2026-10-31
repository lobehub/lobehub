import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

// The task breadcrumb's list reset lives in `breadcrumb.module.css`: it selects
// the <ol> / <li> the Breadcrumb renders.
export const styles = stylex.create({
  subtaskTreeTitle: { color: cssVar.colorTextSecondary },

  /**
   * One line of the activity timeline. The rail is drawn per line so a run of
   * lines joins up; the first and last line of a run only draw their inner
   * half, so the rail starts and ends at a mark.
   *
   * Inset so the 16px mark is centred under the 24px avatar inside a comment
   * card (8px card padding + 12px to the avatar's centre): the rail and the
   * faces in the cards sit on one vertical line, the cards just run wider.
   */
  activityLine: {
    'position': 'relative',
    'paddingBlock': '5px',
    'paddingInlineStart': '12px',
    '::before': {
      content: '""',
      position: 'absolute',
      insetBlockStart: { 'default': 0, ':first-child': '50%' },
      insetBlockEnd: { 'default': 0, ':last-child': '50%' },
      insetInlineStart: '19.5px',
      display: { 'default': null, ':only-child': 'none' },
      width: '1px',
      backgroundColor: cssVar.colorBorderSecondary,
      backgroundImage: 'none',
    },
  },

  /** The 16px mark on the rail: a type icon or a face. Opaque so it covers the rail. */
  activityMark: {
    position: 'relative',
    zIndex: 1,
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },

  /** A run of adjacent lines; cancels the feed's card gap so they sit tight. */
  activityTimeline: { marginBlock: '-4px' },

  activityAvatar: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    color: cssVar.colorTextQuaternary,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },

  /** The comment actions appear while the card is hovered or holds focus. */
  commentCard: { position: 'relative' },

  commentActions: {
    position: 'absolute',
    insetBlockStart: '8px',
    insetInlineEnd: '8px',
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover')]: 1,
      [stylex.when.ancestor(':focus-within')]: 1,
    },
    transition: 'opacity 0.15s ease',
  },

  agentAuthorName: {
    cursor: 'pointer',
    color: { 'default': null, ':hover': cssVar.colorText },
    transition: 'color 0.15s ease',
  },

  commentInputCard: {
    paddingBlock: '4px',
    paddingInline: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { 'default': 'transparent', ':focus-within': cssVar.colorBorder },
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: {
      'default': cssVar.colorFillTertiary,
      ':hover': cssVar.colorFillSecondary,
      ':focus-within': cssVar.colorFillTertiary,
    },
    backgroundImage: 'none',
    transition: 'background 0.15s ease, border-color 0.15s ease',
  },
});
