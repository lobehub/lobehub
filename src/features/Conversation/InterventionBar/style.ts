import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  actions: {
    paddingBlockStart: '8px',
    paddingBlockEnd: '10px',
    paddingInline: '10px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,

    // ChatInput rounds its border without clipping, so this tinted strip would
    // paint square over the card's bottom corners. Sits inside the 1px border.
    borderEndStartRadius: `calc(${cssVar.borderRadiusLG} - 1px)`,
    borderEndEndRadius: `calc(${cssVar.borderRadiusLG} - 1px)`,

    backgroundColor: `color-mix(in srgb, ${cssVar.colorBgElevated} 92%, ${cssVar.colorFillSecondary})`,
    backgroundImage: 'none',
    display: { 'default': null, ':empty': 'none' },
  },
  container: {
    marginBlockEnd: '12px',
  },
  content: {
    // ChatInput's maxHeight owns the vertical scrolling; an overflow:auto here
    // never scrolls itself but still severs position:sticky inside intervention
    // bodies from that real scroll container.
    overflowY: 'visible',
    flex: '1',
    minHeight: '0',
    paddingBlockStart: 0,
    paddingBlockEnd: '8px',
  },
  tabBar: {
    overflowX: 'auto',
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    paddingBlock: '6px',
    paddingInline: '4px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  tabCounter: {
    fontSize: '11px',
    color: cssVar.colorTextTertiary,
    whiteSpace: 'nowrap',
  },
  tabTrailing: {
    display: 'flex',
    flexShrink: 0,
    gap: '8px',
    alignItems: 'center',
    marginInlineStart: 'auto',
    paddingBlock: '4px',
    paddingInline: '10px',
  },
});
