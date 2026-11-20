import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { densityTokens } from '@/styles/density.stylex';

export const pickerStyles = stylex.create({
  picker: {
    display: 'flex',
    gap: 8,
    height: 500,
    maxHeight: '55vh',
    minHeight: 240,
    padding: densityTokens['--lobe-density-content-gap'],
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
  },
  pane: { flex: '1', minWidth: 0, minHeight: 0, overflowY: 'auto' },
  selected: {
    borderInlineStartWidth: 1,
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: cssVar.colorBorderSecondary,
    paddingInlineStart: densityTokens['--lobe-density-content-gap'],
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: 8,
    cursor: 'pointer',
    borderRadius: cssVar.borderRadius,
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
  },
  /** Group heading or note inside a pane, aligned with the row content. */
  section: {
    paddingBlock: 4,
    paddingInline: 8,
  },
});
