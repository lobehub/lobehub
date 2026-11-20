import { createStaticStyles } from '@lobehub/ui';

import { densityVars } from '@/styles/densityVars';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  actionBtn: css`
    &:hover {
      border-color: ${cssVar.colorBorder} !important;
      background: ${cssVar.colorFillQuaternary} !important;
    }
  `,
  actionBtnPrimary: css`
    width: auto !important;
    padding-inline: ${densityVars.contentGap} !important;
  `,
  expandLink: css`
    border: 1px solid ${cssVar.colorFillTertiary} !important;
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  resolvedTag: css`
    font-size: 13px;
    color: ${cssVar.colorTextQuaternary};
  `,
  card: css`
    .brief-comment-btn,
    .brief-view-run-btn {
      opacity: 0;
    }

    &:hover {
      border-color: ${cssVar.colorBorder} !important;

      .brief-comment-btn,
      .brief-view-run-btn {
        opacity: 1;
      }
    }
  `,
  clickableHeader: css`
    cursor: pointer;
  `,
}));
