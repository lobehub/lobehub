import type { VerifyEvidenceChapterKind } from '@lobechat/types';
import { createStaticStyles, cssVar } from 'antd-style';

/**
 * The player chrome is dark in both themes, as video chrome is everywhere: it
 * sits on the black letterbox and must not flash white around a dark recording.
 */
export const styles = createStaticStyles(({ css }) => ({
  player: css`
    position: relative;

    overflow: hidden;

    width: 100%;
    border-radius: ${cssVar.borderRadiusLG};

    background: #000;
    outline: none;

    &:focus-visible {
      box-shadow: 0 0 0 2px ${cssVar.colorPrimaryBorder};
    }
  `,
  frame: css`
    position: relative;
    width: 100%;
    background: #000;

    video {
      display: block;
      width: 100%;
      height: 100%;
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
  draft: css`
    pointer-events: none;
    position: absolute;
    border: 2px dashed ${cssVar.colorWarning};
    border-radius: 4px;
  `,
  centerPlay: css`
    pointer-events: none;

    position: absolute;
    inset-block-start: 50%;
    inset-inline-start: 50%;
    transform: translate(-50%, -50%);

    display: flex;
    align-items: center;
    justify-content: center;

    width: 56px;
    height: 56px;
    border-radius: 50%;

    color: #fff;

    background: rgb(0 0 0 / 55%);
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
  caption: css`
    position: absolute;
    inset-block-end: 14px;
    inset-inline-start: 50%;
    transform: translateX(-50%);

    display: flex;
    flex-direction: column;
    gap: 2px;

    max-width: 80%;
    padding-block: 6px 8px;
    padding-inline: 12px;
    border-radius: 8px;

    font-size: 13px;
    line-height: 1.5;
    color: #fff;

    background: rgb(0 0 0 / 78%);
  `,
  captionTitle: css`
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    font-size: 12px;
    color: rgb(255 255 255 / 85%);
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
  bar: css`
    padding-block: 6px 8px;
    padding-inline: 12px;
    color: #eee;
    background: #151515;
  `,
  time: css`
    margin-inline-start: 6px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: #ddd;
    white-space: nowrap;
  `,
  frameNo: css`
    overflow: hidden;

    margin-inline-start: 8px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: #888;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  barButton: css`
    cursor: pointer;

    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;

    min-width: 28px;
    height: 28px;
    padding-inline: 6px;
    border: none;
    border-radius: 6px;

    font-size: 12px;
    color: #ddd;

    background: transparent;

    &:hover {
      background: rgb(255 255 255 / 10%);
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimaryBorder};
    }
  `,
  barButtonActive: css`
    color: #fff;
    background: rgb(255 255 255 / 12%);
  `,
  /* ---------------- timeline ---------------- */
  timeline: css`
    user-select: none;
    position: relative;
    padding-block: 14px 4px;
  `,
  track: css`
    touch-action: none;
    cursor: pointer;
    position: relative;
    height: 20px;
  `,
  rail: css`
    position: absolute;
    inset-block-start: 8px;
    inset-inline: 0;

    height: 4px;
    border-radius: 2px;

    background: rgb(255 255 255 / 18%);
  `,
  played: css`
    position: absolute;
    inset-block-start: 8px;
    inset-inline-start: 0;

    height: 4px;
    border-radius: 2px;

    background: #fff;
  `,
  head: css`
    pointer-events: none;

    position: absolute;
    inset-block-start: 4px;
    transform: translateX(-50%);

    width: 12px;
    height: 12px;
    border-radius: 50%;

    background: #fff;
    box-shadow: 0 0 0 3px rgb(0 0 0 / 40%);
  `,
  stepTick: css`
    pointer-events: none;

    position: absolute;
    inset-block-start: 7px;
    transform: translateX(-50%);

    width: 2px;
    height: 6px;

    background: #151515;
  `,
  claimMark: css`
    cursor: pointer;

    position: absolute;
    z-index: 3;
    inset-block-start: -9px;
    transform: translateX(-50%);

    width: 8px;
    height: 8px;
    padding: 0;
    border: 1.5px solid #151515;
    border-radius: 50%;

    &:hover {
      transform: translateX(-50%) scale(1.4);
    }
  `,
  noteMark: css`
    cursor: pointer;

    position: absolute;
    z-index: 2;
    inset-block-start: -2px;
    transform: translateX(-50%);

    width: 10px;
    height: 10px;
    padding: 0;
    border: 2px solid #151515;
    border-radius: 50%;

    background: ${cssVar.colorError};

    &:hover {
      transform: translateX(-50%) scale(1.3);
    }
  `,
  noteMarkActive: css`
    box-shadow: 0 0 0 2px ${cssVar.colorErrorBorder};
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
  preview: css`
    pointer-events: none;

    position: absolute;
    z-index: 5;
    inset-block-end: 34px;
    transform: translateX(-50%);

    overflow: hidden;

    width: 176px;
    border: 1px solid #333;
    border-radius: 8px;

    background: #000;
    box-shadow: 0 6px 20px rgb(0 0 0 / 50%);

    canvas {
      display: block;
      width: 176px;
      height: 99px;
    }
  `,
  previewMeta: css`
    padding-block: 4px;
    padding-inline: 8px;

    font-size: 11px;
    line-height: 1.5;
    color: #ddd;

    background: #1b1b1b;
  `,
  mono: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  `,
}));

/** Marker colours, shared by the timeline marks, the caption and the claim list. */
export const CLAIM_COLOR: Record<VerifyEvidenceChapterKind, string> = {
  check: cssVar.colorSuccess,
  flag: cssVar.colorWarning,
  step: cssVar.colorTextTertiary,
};
