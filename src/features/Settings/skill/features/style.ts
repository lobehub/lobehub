import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  connected: {
    fontSize: '12px',
    color: cssVar.colorSuccess,
  },
  container: {
    paddingBlock: '6px',
    paddingInline: '4px',
  },
  disconnected: {
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
  disconnectedIcon: {
    opacity: 0.4,
  },
  disconnectedTitle: {
    opacity: 0.5,
  },
  error: {
    fontSize: '12px',
    color: cssVar.colorError,
  },
  icon: {
    overflow: 'hidden',
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    borderRadius: '4px',
  },
  pending: {
    fontSize: '12px',
    color: cssVar.colorWarning,
  },
  title: {
    cursor: 'pointer',
    fontSize: '14px',
    color: { 'default': cssVar.colorText, ':hover': cssVar.colorPrimary },
  },
});
