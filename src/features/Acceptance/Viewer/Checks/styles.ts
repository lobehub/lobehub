import { createStaticStyles, cssVar } from 'antd-style';

export const styles = createStaticStyles(({ css }) => ({
  /**
   * Regions whose evidence a later round replaced. Kept quiet on purpose: it is
   * a footnote to the check, not a second checklist — full-strength cards here
   * competed with the evidence the reader actually came for.
   */
  staleRegions: css`
    margin-block-start: 4px;
    padding-block: 10px;
    padding-inline-start: 12px;
    border-inline-start: 2px solid ${cssVar.colorBorderSecondary};

    opacity: 0.75;

    &:hover {
      opacity: 1;
    }
  `,
  chip: css`
    padding-inline: 6px;
    border-radius: 4px;

    font-size: 11px;
    line-height: 18px;
    color: ${cssVar.colorTextTertiary};
    white-space: nowrap;

    background: ${cssVar.colorFillTertiary};
  `,
  chipClickable: css`
    cursor: pointer;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  emptyCard: css`
    padding-block: 48px;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  celebrateIcon: css`
    @keyframes acceptance-celebrate-pop {
      0% {
        transform: scale(0.6);
        opacity: 0;
      }

      60% {
        transform: scale(1.15);
      }

      100% {
        transform: scale(1);
        opacity: 1;
      }
    }

    animation: acceptance-celebrate-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  `,
  groupCard: css`
    background: ${cssVar.colorBgContainer};
  `,
  groupHeader: css`
    cursor: pointer;
    padding-block: 10px;
    padding-inline: 16px;
    background: ${cssVar.colorFillQuaternary};

    .acceptance-group-actions {
      opacity: 0;
      transition: opacity 0.2s;
    }

    &:hover {
      .acceptance-group-actions {
        opacity: 1;
      }
    }
  `,
  historyToggle: css`
    cursor: pointer;

    display: inline-flex;
    gap: 4px;
    align-items: center;

    width: fit-content;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  row: css`
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    /* The list opens flush with the content above it. Grouped lists are
       unaffected: their first child is the group header, so rows are never
       first. */
    &:first-child {
      border-block-start: none;
    }
  `,
  seqChip: css`
    flex: none;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    line-height: 22px;
    color: ${cssVar.colorTextSecondary};
    letter-spacing: 0.02em;
  `,
  seqChipClickable: css`
    cursor: copy;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  rowActions: css`
    opacity: 0;
    transition: opacity 0.2s;
  `,
  rowChevron: css`
    @media (width <= 767px) {
      grid-area: 1 / 4;
    }
  `,
  rowMeta: css`
    transition: opacity 0.2s;

    @media (width <= 767px) {
      grid-area: 1 / 3;
      flex-wrap: wrap;
      justify-content: flex-end;
      min-width: 0;

      &:empty {
        display: none;
      }
    }

    @media (hover: hover) and (pointer: fine) {
      pointer-events: none;
      opacity: 0;
    }
  `,
  rowTitle: css`
    @media (width <= 767px) {
      grid-area: 2 / 1 / auto / -1;
    }
  `,
  rowHeader: css`
    cursor: pointer;
    padding-block: 12px;
    padding-inline: 16px;

    &:hover,
    &:focus-within {
      .acceptance-row-actions {
        opacity: 1;
      }

      .acceptance-row-meta {
        pointer-events: auto;
        opacity: 1;
      }
    }

    /* The hover wash marks the collapsed row as a click target. An OPEN row is
       in reading mode — a gray band flashing between the white body and the
       white page just severs the title from its content, so no wash there. */
    &:not([data-expanded]):hover {
      background: ${cssVar.colorFillQuaternary};
    }

    @media (width <= 767px) {
      display: grid;
      grid-template-columns: 16px max-content minmax(0, 1fr) 14px;
      row-gap: 4px;

      padding-block: 8px;
      padding-inline: 0;
    }
  `,
  stepDot: css`
    flex: none;

    width: 9px;
    height: 9px;
    margin-block-start: 5px;
    border: 2px solid;
    border-radius: 50%;

    background: ${cssVar.colorBgContainer};
  `,
  stepRail: css`
    flex: 1;
    width: 1px;
    margin-block-start: 6px;
    background: ${cssVar.colorBorderSecondary};
  `,
  titleEllipsis: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));
