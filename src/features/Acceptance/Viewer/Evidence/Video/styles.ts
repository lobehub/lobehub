import type { VerifyEvidenceChapterKind } from '@lobechat/types';
import { createStaticStyles, cssVar } from '@lobehub/ui';

export const styles = createStaticStyles(({ css }) => ({
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
