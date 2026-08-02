import { createStaticStyles, cssVar } from 'antd-style';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 100%;
    height: 100%;
    min-height: 96px;
  `,
  spinner: css`
    width: 28px;
    height: 28px;
    border: 2px solid ${cssVar.colorFillSecondary};
    border-block-start-color: ${cssVar.colorTextSecondary};
    border-radius: 50%;

    animation: content-loading-spin 0.8s linear infinite;

    @keyframes content-loading-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `,
}));

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
  <div className={styles.container}>
    <span aria-label={'Loading'} className={styles.spinner} role={'status'} />
  </div>
);

export default ContentLoading;
