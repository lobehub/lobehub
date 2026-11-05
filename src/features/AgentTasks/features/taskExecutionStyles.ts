import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

/**
 * Shared look for the task-side execution chips (environment + working
 * directory) and their popover rows.
 *
 * They live in one module for the reason the chat side keeps `gitChipStyles`:
 * the two chips sit next to each other in the same bar, so any drift between
 * two copies of these rules reads as a rendering bug rather than a choice.
 */
export const taskExecutionStyles = stylex.create({
  /**
   * The compact chip used in the create composer's action bar. A caller that
   * wants its own row idiom (the task detail's properties rail does) passes a
   * class of its own instead — the two then never fight over the same box,
   * which inline sizing and a caller class would.
   */
  chip: {
    flex: 'none',
    height: '24px',
    paddingBlock: '3px',
    paddingInline: '8px',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    whiteSpace: 'nowrap',
  },
  chipLabel: {
    overflow: 'hidden',
    maxWidth: '160px',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  /**
   * The directory axis' trigger — deliberately NOT the chip the run location
   * wears.
   *
   * Where a run goes is the task's one real decision; the directory follows from
   * that target and only shows once the task stops following the agent. Giving
   * the two the same weight reads as two equal choices. This is the muted text affordance the
   * chat composer's own directory / repo pickers use, so the two surfaces agree
   * on the hierarchy as well.
   */
  directoryTrigger: {
    cursor: 'pointer',
    display: 'flex',
    flex: 'none',
    gap: '6px',
    alignItems: 'center',
    minWidth: 0,
    paddingBlock: '2px',
    paddingInline: '6px',
    borderRadius: '4px',
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
    whiteSpace: 'nowrap',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
    transition: 'background 0.2s',
  },
  check: { flex: 'none', marginInlineStart: 'auto', color: cssVar.colorPrimary },
  /** Provenance tag on a directory row (the device's own default). */
  badge: {
    flex: 'none',
    paddingInline: '5px',
    borderRadius: '999px',
    fontSize: '10px',
    lineHeight: '15px',
    color: cssVar.colorTextTertiary,
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  /**
   * Slot for the design-system checkbox in a clickable row: the ROW is the
   * control, so the box must not take the click a second time.
   */
  checkboxSlot: { pointerEvents: 'none', display: 'inline-flex', flex: 'none' },
  followSummary: {
    minWidth: 0,
    paddingBlockStart: '2px',
    fontSize: '11px',
    color: cssVar.colorTextTertiary,
  },
  switchRow: { paddingBlock: '6px', paddingInline: '8px' },
  emptyHint: {
    paddingBlock: '12px',
    paddingInline: '8px',
    fontSize: '12px',
    color: cssVar.colorTextQuaternary,
    textAlign: 'center',
  },
  /**
   * A selection the task does NOT own, reported rather than offered.
   *
   * The directory axis follows the target: on a machine it is a path, in the
   * cloud it is a repo, and when the task's target leaves nothing choosable the
   * honest answer is a muted line saying what the run will use — not an
   * interactive chip that looks like it can change something.
   */
  hint: {
    display: 'flex',
    flex: 'none',
    gap: '4px',
    alignItems: 'center',
    minWidth: 0,
    paddingInline: '6px',
    fontSize: '12px',
    color: cssVar.colorTextQuaternary,
    whiteSpace: 'nowrap',
  },
  hintValue: {
    overflow: 'hidden',
    maxWidth: '200px',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  icon: { flex: 'none', color: cssVar.colorTextTertiary },
  /**
   * A trigger the caller may not use (no edit permission, or the agent's
   * execution environment is author-fixed). Dimmed and cursor-stopped so a chip
   * that cannot open its picker does not read as one that can.
   */
  triggerDisabled: {
    cursor: 'not-allowed',
    opacity: 0.55,
    backgroundColor: { 'default': null, ':hover': 'transparent' },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  /**
   * A picker row. Rendered on a native `<button>` (see `TaskPickerOption`), so
   * the reset below is what keeps it looking like the plain row it replaced:
   * without it the platform's button chrome, centring and font would show
   * through the popover.
   *
   * No focus style here: the design system draws one global keyboard ring
   * (`ConfigProvider` installs it) around whatever is focused, so a local
   * outline would only draw a second ring inside it.
   */
  row: {
    cursor: { 'default': 'pointer', ':disabled': 'not-allowed' },
    display: 'block',
    boxSizing: 'border-box',
    width: '100%',
    paddingBlock: '6px',
    paddingInline: '8px',
    borderStyle: 'none',
    borderRadius: cssVar.borderRadius,
    font: 'inherit',
    color: 'inherit',
    textAlign: 'start',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
    transition: 'background-color 0.2s',
  },
  rowActive: {
    backgroundColor: { 'default': cssVar.colorFillSecondary, ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
  },
  rowDesc: {
    overflow: 'hidden',
    fontSize: '11px',
    color: cssVar.colorTextDescription,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rowTitle: {
    overflow: 'hidden',
    fontSize: '13px',
    fontWeight: 500,
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  scroll: { overflowY: 'auto', maxHeight: '320px' },
  sectionTitle: {
    paddingBlockStart: '6px',
    paddingBlockEnd: '2px',
    paddingInline: '8px',
    fontSize: '11px',
    fontWeight: 500,
    color: cssVar.colorTextQuaternary,
  },
});
