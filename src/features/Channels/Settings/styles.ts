import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const settingsStyles = stylex.create({
  scroll: {
    overflowY: 'auto',
    flex: '1',
    minHeight: 0,
  },
  content: {
    width: '100%',
    maxWidth: 720,
    marginInline: 'auto',
    paddingBlock: 24,
    paddingInline: 24,
  },
  row: {
    paddingBlockStart: 16,
    borderBlockStartWidth: 1,
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
});
