import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  analyzeAction: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
  },
  analyzeProgress: {
    pointerEvents: 'none',
    position: 'absolute',
    zIndex: 1,
    inset: 0,
    transform: 'rotate(-90deg)',
  },
  columnHeader: {
    flex: 'none',
    borderBlockEndWidth: 1,
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  editorColumn: {
    width: '100%',
    maxWidth: 720,
    marginInline: 'auto',
  },
  section: {
    paddingBlock: 12,
    paddingInline: 16,
  },
  sidecarCard: {
    paddingBlock: 8,
    paddingInline: 10,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
});
