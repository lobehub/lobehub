import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

/**
 * The composer's working-directory chip — for a run on a machine and for one in
 * the cloud sandbox. One declaration, because the two stand in the same slot
 * and are read as one control: a second copy drifts (a darker hover here, a
 * wider gap there) into looking like a different kind of thing.
 */
export const workingDirectoryChipStyles = stylex.create({
  chip: {
    cursor: 'pointer',
    display: 'flex',
    flex: 'none',
    gap: '6px',
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
  label: {
    overflow: 'hidden',
    maxWidth: '140px',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  /** Shown, not picked — e.g. a directory owned by the conversation's project. */
  readonly: {
    cursor: 'default',
    backgroundColor: { 'default': null, ':hover': 'transparent' },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
});
