import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const replicaStyles = stylex.create({
  actions: {
    display: 'flex',
    flexShrink: 0,
    flexWrap: 'wrap',
    gap: '4px',
    alignItems: 'center',
    paddingBlock: '6px',
    paddingInline: '8px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  badge: {
    paddingInline: '4px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusXS,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '10px',
    lineHeight: '16px',
    color: cssVar.colorTextTertiary,
  },
  badgePending: {
    borderColor: cssVar.colorWarningBorder,
    color: cssVar.colorWarning,
  },
  editor: {
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    gap: '8px',
    minHeight: 0,
    padding: '12px',
  },
  editorError: {
    fontSize: cssVar.fontSizeSM,
    color: cssVar.colorError,
    overflowWrap: 'anywhere',
  },
  editorFooter: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: cssVar.fontSizeSM,
    color: cssVar.colorTextTertiary,
  },
  editorInput: {
    flex: '1',
    minHeight: '200px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: cssVar.fontSizeSM,
  },
  persistToggle: { display: 'flex', gap: '6px', alignItems: 'center' },
  resourceMeta: { display: 'flex', flexShrink: 0, gap: '4px' },
});
