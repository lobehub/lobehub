import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

const spin = stylex.keyframes({
  to: { transform: 'rotate(360deg)' },
});

const styles = stylex.create({
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    minHeight: '96px',
  },
  spinner: {
    width: '28px',
    height: '28px',
    borderWidth: '2px',
    borderStyle: 'solid',
    borderColor: cssVar.colorFillSecondary,
    borderBlockStartColor: cssVar.colorTextSecondary,
    borderRadius: '50%',
    animationName: spin,
    animationDuration: '0.8s',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
});

/**
 * Loading state for a content region whose chrome is already on screen.
 *
 * Deliberately draws no structure: it fills whatever container it is given, so
 * it cannot promise a layout the incoming page does not have. That is why it —
 * and not a skeleton — sits in the main layout's outlet boundary, which is
 * shared by pages as different as a settings form, a community grid and a
 * conversation. `BrandTextLoading` stays for full-page boundaries.
 */
const ContentLoading = () => (
  <div {...stylex.props(styles.container)}>
    <span aria-label={'Loading'} role={'status'} {...stylex.props(styles.spinner)} />
  </div>
);

export default ContentLoading;
