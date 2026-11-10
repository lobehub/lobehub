import type { VerifyEvidenceChapterKind } from '@lobechat/types';
import { createStaticStyles, cssVar } from '@lobehub/ui';

export const styles = createStaticStyles(({ css }) => ({
  player: css`
    &:fullscreen {
      display: flex;
      flex-direction: column;
      border-radius: 0;
    }

    &:fullscreen > [data-video-controls] {
      flex: none;
    }

    &:fullscreen > [data-acceptance-video-stage] {
      container-type: size;
      flex: 1;
      align-items: center;

      min-width: 0;
      min-height: 0;
    }

    &:fullscreen > [data-acceptance-video-stage] > .lobe-video__frame {
      flex: none;
      width: min(100cqw, calc(100cqh * var(--acceptance-video-aspect)));
      max-width: none;
      height: min(100cqh, calc(100cqw / var(--acceptance-video-aspect)));
    }
  `,
  stage: css`
    display: flex;
    justify-content: center;
  `,
  frame: css`
    max-width: var(--acceptance-video-frame-width);
  `,
  // Keep stepping and fullscreen visible on a phone; the frame is also named on its comment card.
  compactControls: css`
    @media (width <= 767px) {
      .lobe-video__frame-number {
        display: none;
      }
    }
  `,
  overlay: css`
    position: absolute;
    inset: 0;
  `,
  drawable: css`
    touch-action: none;
    cursor: crosshair;
  `,
  region: css`
    pointer-events: none;

    position: absolute;

    border: 2px solid ${cssVar.colorError};
    border-radius: 4px;

    box-shadow: 0 0 0 9999px rgb(0 0 0 / 20%);
  `,
  regionLabel: css`
    position: absolute;
    inset-block-start: -22px;
    inset-inline-start: -2px;

    overflow: hidden;

    max-width: 240px;
    padding-block: 1px;
    padding-inline: 6px;
    border-radius: 4px;

    font-size: 11px;
    line-height: 18px;
    color: #fff;
    text-overflow: ellipsis;
    white-space: nowrap;

    background: ${cssVar.colorError};
  `,
  /**
   * A comment region, drawn exactly like the region on a screenshot
   * (`Evidence/Annotation` and `ScreenshotTiles`): a 2px box with two rings —
   * the dark one separates it from a light frame, the light one from a dark
   * frame — in the annotation colour (`colorError`) unless the caller passes
   * the colour the screenshot overlay uses for the same comment.
   */
  mark: css`
    pointer-events: none;

    position: absolute;

    border: 2px solid ${cssVar.colorError};
    border-radius: 4px;

    box-shadow:
      0 0 0 1px rgb(0 0 0 / 45%),
      inset 0 0 0 1px rgb(255 255 255 / 45%);
  `,
  /** The screenshot's numbered badge: 18px disc on the box's top-left corner. */
  markBadge: css`
    position: absolute;
    inset-block-start: -9px;
    inset-inline-start: -9px;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 18px;
    height: 18px;
    border-radius: 50%;

    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    color: ${cssVar.colorTextLightSolid};

    background: ${cssVar.colorError};
  `,
  /** Selected reads the way an opened screenshot note does: a light outline on its disc. */
  markBadgeActive: css`
    outline: 2px solid ${cssVar.colorTextLightSolid};
  `,
  draft: css`
    pointer-events: none;
    position: absolute;
    border: 2px dashed ${cssVar.colorWarning};
    border-radius: 4px;
  `,
  hint: css`
    pointer-events: none;

    position: absolute;
    inset-block-start: 12px;
    inset-inline-start: 50%;
    transform: translateX(-50%);

    padding-block: 4px;
    padding-inline: 10px;
    border-radius: 999px;

    font-size: 12px;
    color: #fff;
    white-space: nowrap;

    background: rgb(0 0 0 / 65%);
  `,
  dispute: css`
    cursor: pointer;

    flex: none;

    padding-block: 1px;
    padding-inline: 8px;
    border: 1px solid rgb(255 255 255 / 30%);
    border-radius: 4px;

    font-size: 12px;
    color: #fff;

    background: transparent;

    &:disabled {
      cursor: default;
      opacity: 0.5;
    }

    &:hover:not(:disabled) {
      background: rgb(255 255 255 / 12%);
    }
  `,
  noteSpan: css`
    pointer-events: none;

    position: absolute;
    inset-block-start: 6px;

    height: 8px;
    border-radius: 2px;

    opacity: 0.6;
    background: ${cssVar.colorError};
  `,
  rangeBand: css`
    pointer-events: none;

    position: absolute;
    inset-block: 2px;

    border-radius: 3px;

    background: color-mix(in srgb, ${cssVar.colorWarning} 25%, transparent);
    box-shadow: inset 0 0 0 1px ${cssVar.colorWarning};
  `,
  lane: css`
    touch-action: none;
    cursor: text;

    position: relative;

    height: 16px;
    margin-block-start: 4px;
    border-radius: 4px;

    background: repeating-linear-gradient(
      90deg,
      rgb(255 255 255 / 6%) 0,
      rgb(255 255 255 / 6%) 1px,
      transparent 1px,
      transparent 12px
    );
  `,
  laneLabel: css`
    pointer-events: none;

    position: absolute;
    inset-block-start: 0;
    inset-inline-start: 6px;

    font-size: 10px;
    line-height: 16px;
    color: #777;
  `,
}));

export const CLAIM_COLOR: Record<VerifyEvidenceChapterKind, string> = {
  check: cssVar.colorSuccess,
  flag: cssVar.colorWarning,
  step: cssVar.colorTextTertiary,
};
