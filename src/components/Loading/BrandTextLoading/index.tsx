'use client';

import { createStyles } from 'antd-style';
import { memo } from 'react';

interface BrandTextLoadingProps {
  debugId?: string;
}

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 100%;
    height: 100%;
    min-height: 240px;
  `,
  brand: css`
    user-select: none;

    display: flex;
    gap: 12px;
    align-items: center;

    color: ${token.colorText};
  `,
  mark: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 44px;
    height: 44px;
    border-radius: 14px;

    font-size: 24px;
    font-weight: 800;
    line-height: 1;
    color: #fff;

    background: linear-gradient(135deg, #7c3aed, #06b6d4);
    box-shadow: 0 0 40px rgb(124 58 237 / 45%);

    animation: chinnahub-pulse 1.8s ease-in-out infinite;

    @keyframes chinnahub-pulse {
      0%,
      100% {
        transform: scale(1);
        opacity: 0.78;
      }

      50% {
        transform: scale(1.08);
        opacity: 1;
      }
    }
  `,
  text: css`
    font-size: 28px;
    font-weight: 700;
    line-height: 1.1;
    letter-spacing: -0.04em;
  `,
}));

const BrandTextLoading = memo<BrandTextLoadingProps>(({ debugId }) => {
  const { styles } = useStyles();

  return (
    <div className={styles.container} data-debug-id={debugId}>
      <div aria-label="Loading ChinnaHub" className={styles.brand} role="status">
        <div className={styles.mark}>C</div>
        <div className={styles.text}>ChinnaHub</div>
      </div>
    </div>
  );
});

BrandTextLoading.displayName = 'BrandTextLoading';

export default BrandTextLoading;
