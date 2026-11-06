import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

// The background image URL is resolved at runtime (`imageUrl`), so Preview sets
// `backgroundImage` inline next to this class.
export const styles = stylex.create({
  background: {
    padding: '24px',
    backgroundColor: cssVar.colorBgLayout,
    backgroundPosition: 'center',
    backgroundSize: '120% 120%',
  },
  container: {
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  container_withBackground_true: {
    overflow: 'hidden',
    borderWidth: '2px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: cssVar.borderRadiusLG,
  },
  footer: {
    padding: '16px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorder,
  },
  header: {
    marginBlockEnd: '-24px',
    paddingBlock: '16px',
    paddingInline: '24px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorder,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  role: {
    marginBlockStart: '12px',
    paddingBlockStart: '12px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'dashed',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    opacity: 0.75,
  },
  url: {
    color: cssVar.colorTextDescription,
  },
});
