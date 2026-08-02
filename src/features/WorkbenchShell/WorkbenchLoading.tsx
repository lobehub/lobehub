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

    animation: workbench-spin 0.8s linear infinite;

    @keyframes workbench-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `,
}));

const WorkbenchLoading = () => (
  <div className={styles.container}>
    <span aria-label={'Loading'} className={styles.spinner} role={'status'} />
  </div>
);

export default WorkbenchLoading;
