import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  dropZone: {
    position: 'relative',
    overflow: 'hidden',
    height: '100%',
  },
  dropZoneActive: {
    backgroundColor: cssVar.colorPrimaryBg,
    backgroundImage: 'none',
    outlineWidth: '1px',
    outlineStyle: 'dashed',
    outlineColor: cssVar.colorPrimaryBorder,
    outlineOffset: '-4px',
  },
  header: {
    minWidth: '1040px',
    height: '40px',
    minHeight: '40px',
    color: cssVar.colorTextDescription,
  },
  headerItem: {
    height: '100%',
    paddingBlock: '6px',
    paddingInlineStart: 0,
    paddingInlineEnd: '24px',
  },
  scrollContainer: {
    overflowX: 'auto',
    overflowY: 'hidden',
    flex: '1',
  },
  selectAllHint: {
    position: 'sticky',
    zIndex: 1,
    insetBlockStart: '40px',
    minWidth: '1040px',
    paddingBlock: '8px',
    paddingInline: '16px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    fontSize: '12px',
    color: cssVar.colorTextDescription,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
});
