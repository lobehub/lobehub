import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  container: { height: '100%' },
  document: { position: 'relative' },
  documentContainer: {
    flex: '1',
    paddingBlock: '10px',
    backgroundColor: cssVar.colorBgLayout,
  },
  page: {
    overflow: 'hidden',
    marginBlockEnd: '12px',
    borderRadius: '4px',
    boxShadow: cssVar.boxShadowTertiary,
  },
});
