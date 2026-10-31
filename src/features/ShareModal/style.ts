import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';

export { previewClassName } from './useContainerStyles';

export const styles = stylex.create({
  footer: {
    flex: 'none',
    gap: '8px',
    minHeight: '64px',
    paddingBlockStart: '12px',
    paddingBlockEnd: { default: '12px', [media.sm]: '16px' },
    paddingInlineStart: { default: '20px', [media.sm]: '16px' },
    paddingInlineEnd: '16px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    flexDirection: { default: null, [media.sm]: 'column' },
    alignItems: { default: null, [media.sm]: 'stretch' },
  },
  meta: {
    overflow: 'hidden',
    flex: '1',
    fontSize: '12px',
    color: cssVar.colorTextDescription,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textAlign: { default: null, [media.sm]: 'center' },
  },
  stage: {
    position: 'relative',
    overflow: 'auto',
    flex: '1',
    minHeight: '0',
    paddingBlockStart: { default: '24px', [media.sm]: '16px' },
    paddingBlockEnd: '0',
    paddingInlineStart: { default: '32px', [media.sm]: '16px' },
    paddingInlineEnd: { default: '32px', [media.sm]: '16px' },
    backgroundColor: cssVar.colorBgLayout,
    backgroundImage: 'none',
  },
  toolbar: {
    'overflowX': 'auto',
    'flex': 'none',
    'gap': '6px',
    'minHeight': '48px',
    'paddingInline': '16px',
    'borderBlockEndWidth': '1px',
    'borderBlockEndStyle': 'solid',
    'borderBlockEndColor': cssVar.colorBorderSecondary,
    'whiteSpace': { default: 'nowrap', [media.sm]: 'normal' },
    'flexWrap': { default: null, [media.sm]: 'wrap' },
    'paddingBlock': { default: null, [media.sm]: '8px' },
    '::-webkit-scrollbar': { display: 'none' },
  },
  toolbarDivider: {
    flex: 'none',
    width: '1px',
    height: '18px',
    marginInline: '6px',
    backgroundColor: cssVar.colorBorder,
    backgroundImage: 'none',
    display: { default: null, [media.sm]: 'none' },
  },
});
