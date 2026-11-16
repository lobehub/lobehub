import type { VerifyEvidenceChapterKind } from '@lobechat/types';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  stage: {
    display: 'flex',
    justifyContent: 'center',
  },
  overlay: {
    position: 'absolute',
    insetBlockStart: 0,
    insetBlockEnd: 0,
    insetInlineStart: 0,
    insetInlineEnd: 0,
  },
  drawable: {
    touchAction: 'none',
    cursor: 'crosshair',
  },
  region: {
    pointerEvents: 'none',
    position: 'absolute',
    borderWidth: '2px',
    borderStyle: 'solid',
    borderColor: cssVar.colorError,
    borderRadius: '4px',
    boxShadow: '0 0 0 9999px rgb(0 0 0 / 20%)',
  },
  regionLabel: {
    position: 'absolute',
    insetBlockStart: '-22px',
    insetInlineStart: '-2px',
    overflow: 'hidden',
    maxWidth: '240px',
    paddingBlock: '1px',
    paddingInline: '6px',
    borderRadius: '4px',
    fontSize: '12px',
    lineHeight: '18px',
    color: '#fff',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    backgroundColor: cssVar.colorError,
  },
  // A comment region, drawn exactly like the region on a screenshot
  // (`Evidence/Annotation` and `ScreenshotTiles`): a 2px box with two rings —
  // the dark one separates it from a light frame, the light one from a dark
  // frame — in the annotation colour (`colorError`) unless the caller passes
  // the colour the screenshot overlay uses for the same comment.
  mark: {
    pointerEvents: 'none',
    position: 'absolute',
    borderWidth: '2px',
    borderStyle: 'solid',
    borderColor: cssVar.colorError,
    borderRadius: '4px',
    boxShadow: '0 0 0 1px rgb(0 0 0 / 45%), inset 0 0 0 1px rgb(255 255 255 / 45%)',
  },
  // The screenshot's numbered badge: 18px disc on the box's top-left corner.
  markBadge: {
    position: 'absolute',
    insetBlockStart: '-9px',
    insetInlineStart: '-9px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '18px',
    height: '18px',
    borderRadius: '50%',
    fontSize: '12px',
    fontWeight: 600,
    lineHeight: 1,
    color: cssVar.colorTextLightSolid,
    backgroundColor: cssVar.colorError,
  },
  // Selected reads the way an opened screenshot note does: a light outline on its disc.
  markBadgeActive: {
    outlineWidth: '2px',
    outlineStyle: 'solid',
    outlineColor: cssVar.colorTextLightSolid,
  },
  draft: {
    pointerEvents: 'none',
    position: 'absolute',
    borderWidth: '2px',
    borderStyle: 'dashed',
    borderColor: cssVar.colorWarning,
    borderRadius: '4px',
  },
  hint: {
    pointerEvents: 'none',
    position: 'absolute',
    insetBlockStart: '12px',
    insetInlineStart: '50%',
    transform: 'translateX(-50%)',
    paddingBlock: '4px',
    paddingInline: '10px',
    borderRadius: '999px',
    fontSize: '12px',
    color: '#fff',
    whiteSpace: 'nowrap',
    backgroundColor: 'rgb(0 0 0 / 65%)',
  },
});

export const CLAIM_COLOR: Record<VerifyEvidenceChapterKind, string> = {
  check: cssVar.colorSuccess,
  flag: cssVar.colorWarning,
  step: cssVar.colorTextTertiary,
};
