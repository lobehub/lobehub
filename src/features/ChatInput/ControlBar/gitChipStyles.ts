import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

/**
 * Chips shared by the live git status and by the snapshot that stands in for it
 * once the recorded directory is gone. Both render into the same composer bar,
 * so the separator and the PR chip must be pixel-identical — and `staleTrigger`,
 * the deliberately muted variant of `trigger`, lives next to the live one so the
 * two can't drift apart.
 */
export const gitChipStyles = stylex.create({
  prTrigger: {
    cursor: 'pointer',
    display: 'flex',
    flex: 'none',
    gap: '4px',
    alignItems: 'center',
    paddingBlock: '2px',
    paddingInline: '4px',
    borderRadius: '4px',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    whiteSpace: 'nowrap',
    transition: 'background 0.2s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  separator: {
    flex: 'none',
    width: '1px',
    height: '10px',
    backgroundColor: cssVar.colorSplit,
    backgroundImage: 'none',
  },
  // Muted so the snapshot never reads as live state, but still a control: the
  // recovery action is the only thing this cluster can still do.
  staleTrigger: {
    cursor: 'pointer',
    display: 'flex',
    flex: 'none',
    gap: '4px',
    alignItems: 'center',
    maxWidth: '200px',
    paddingBlock: '2px',
    paddingInline: '4px',
    borderRadius: '4px',
    fontSize: '12px',
    color: cssVar.colorTextQuaternary,
    whiteSpace: 'nowrap',
    transition: 'background 0.2s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  trigger: {
    cursor: 'pointer',
    display: 'flex',
    flex: 'none',
    gap: '4px',
    alignItems: 'center',
    paddingBlock: '2px',
    paddingInline: '4px',
    borderRadius: '4px',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    whiteSpace: 'nowrap',
    transition: 'background 0.2s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
});
