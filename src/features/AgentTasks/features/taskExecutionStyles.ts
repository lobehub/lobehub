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
  /**
   * The directory axis' trigger — deliberately NOT the chip the run location
   * wears.
   *
   * Where a run goes is the task's one real decision; the directory follows from
   * that target and is inherited most of the time. Giving the two the same
   * weight reads as two equal choices. This is the muted text affordance the
   * chat composer's own directory / repo pickers use, so the two surfaces agree
   * on the hierarchy as well.
   */
  directoryTrigger: css`
    cursor: pointer;

    display: flex;
    flex: none;
    gap: 6px;
    align-items: center;

    min-width: 0;
    padding-block: 2px;
    padding-inline: 6px;
    border-radius: 4px;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    white-space: nowrap;

    transition: background 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  check: css`
    flex: none;
    margin-inline-start: auto;
    color: ${cssVar.colorPrimary};
  `,
  /** Provenance tag on a directory row (the device's own default). */
  badge: css`
    flex: none;

    padding-inline: 5px;
    border-radius: 999px;

    font-size: 10px;
    line-height: 15px;
    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorFillSecondary};
  `,
  /**
   * Slot for the design-system checkbox in a clickable row: the ROW is the
   * control, so the box must not take the click a second time.
   */
  checkboxSlot: css`
    pointer-events: none;
    display: inline-flex;
    flex: none;
  `,
  emptyHint: css`
    padding-block: 12px;
    padding-inline: 8px;

    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
    text-align: center;
  `,
  /**
   * A selection the task does NOT own, reported rather than offered.
   *
   * The directory axis follows the target: on a machine it is a path, in the
   * cloud it is a repo, and when the task's target leaves nothing choosable the
   * honest answer is a muted line saying what the run will use — not an
   * interactive chip that looks like it can change something.
   */
  hint: css`
    display: flex;
    flex: none;
    gap: 4px;
    align-items: center;

    min-width: 0;
    padding-inline: 6px;

    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
    white-space: nowrap;
  `,
  hintValue: css`
    overflow: hidden;
    max-width: 200px;
    text-overflow: ellipsis;
    white-space: nowrap;
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
