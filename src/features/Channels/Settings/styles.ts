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
    maxWidth: 800,
    marginInline: 'auto',
    paddingBlock: 24,
    paddingInline: 24,
  },
  card: {
    overflow: 'hidden',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 12,
    backgroundColor: cssVar.colorBgContainer,
  },
  plainCard: {
    overflow: 'visible',
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: 'transparent',
  },
  plainBody: {
    padding: 0,
  },
  dangerCard: {
    borderColor: cssVar.colorErrorBorder,
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: 24,
  },
  footer: {
    display: 'flex',
    gap: 16,
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingBlock: 12,
    paddingInline: 24,
    borderBlockStartWidth: 1,
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorFillQuaternary,
  },
  dangerFooter: {
    borderBlockStartColor: cssVar.colorErrorBorder,
    backgroundColor: cssVar.colorErrorBg,
  },
  action: {
    flex: 'none',
    marginInlineStart: 'auto',
  },
  field: {
    maxWidth: 320,
  },
});
