import { createStaticStyles, cssVar } from 'antd-style';

/**
 * Shared look for the task-side execution chips (run location + working
 * directory) and their popover rows.
 *
 * They live in one module for the reason the chat side keeps `gitChipStyles`:
 * the two chips sit next to each other in the same bar, so any drift between
 * two copies of these rules reads as a rendering bug rather than a choice.
 */
export const taskExecutionStyles = createStaticStyles(({ css }) => ({
  /**
   * The compact chip used in the create composer's action bar. A caller that
   * wants its own row idiom (the task detail's properties rail does) passes a
   * class of its own instead — the two then never fight over the same box,
   * which inline sizing and a caller class would.
   */
  chip: css`
    flex: none;

    height: 24px;
    padding-block: 3px;
    padding-inline: 8px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;
  `,
  chipLabel: css`
    overflow: hidden;
    max-width: 160px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  check: css`
    flex: none;
    margin-inline-start: auto;
    color: ${cssVar.colorPrimary};
  `,
  checkIndicator: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 20px;
    height: 20px;
    border: 1.5px solid ${cssVar.colorBorder};
    border-radius: 4px;
  `,
  checkIndicatorChecked: css`
    border-color: ${cssVar.colorPrimary};
    color: #fff;
    background: ${cssVar.colorPrimary};
  `,
  icon: css`
    flex: none;
    color: ${cssVar.colorTextTertiary};
  `,
  /**
   * A trigger the caller may not use (no edit permission, or the agent's
   * execution environment is author-fixed). Dimmed and cursor-stopped so a chip
   * that cannot open its picker does not read as one that can.
   */
  triggerDisabled: css`
    cursor: not-allowed;
    opacity: 0.55;

    &:hover {
      background: transparent;
    }
  `,
  row: css`
    cursor: pointer;

    padding-block: 6px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    transition: background-color 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  rowActive: css`
    background: ${cssVar.colorFillSecondary};
  `,
  rowDesc: css`
    overflow: hidden;

    font-size: 11px;
    color: ${cssVar.colorTextDescription};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  rowTitle: css`
    overflow: hidden;

    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  scroll: css`
    overflow-y: auto;
    max-height: 320px;
  `,
  sectionTitle: css`
    padding-block: 6px 2px;
    padding-inline: 8px;

    font-size: 11px;
    font-weight: 500;
    color: ${cssVar.colorTextQuaternary};
    text-transform: uppercase;
    letter-spacing: 0.5px;
  `,
}));
