import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  container: {
    cursor: 'pointer',
    width: '100%',
    paddingBlock: '10px',
    paddingInlineStart: '8px',
    paddingInlineEnd: '12px',
    borderRadius: '8px',
    color: cssVar.colorText,
    backgroundColor: { 'default': cssVar.colorBgElevated, ':hover': cssVar.colorFillSecondary },
    backgroundImage: 'none',
  },
  plugin: { display: 'flex', gap: '4px', alignItems: 'center', width: 'fit-content' },
  tag: {
    cursor: 'default',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    borderRadius: '4px',
  },
  tagBlue: {
    color: cssVar.geekblue,
    backgroundColor: cssVar.geekblue1,
    backgroundImage: 'none',
  },
  tagGreen: {
    color: cssVar.green,
    backgroundColor: cssVar.green1,
    backgroundImage: 'none',
  },
});
