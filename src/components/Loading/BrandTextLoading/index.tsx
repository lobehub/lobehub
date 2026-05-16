'use client';

import { createStyles } from 'antd-style';
import { memo } from 'react';

interface BrandTextLoadingProps {
  debugId?: string;
}

const useStyles = createStyles(({ css }) => ({
  container: css`
    display: flex;
    flex-direction: column;
    gap: 18px;
    align-items: center;
    justify-content: center;

    width: 100%;
    height: 100%;
    min-height: 240px;

    animation: ch-fadein 0.45s cubic-bezier(0.4, 0, 0.2, 1) both;

    @keyframes ch-fadein {
      from {
        transform: translateY(10px);
        opacity: 0;
      }

      to {
        transform: translateY(0);
        opacity: 1;
      }
    }
  `,
  wrapper: css`
    position: relative;

    display: flex;
    flex-direction: column;
    gap: 18px;
    align-items: center;
  `,
  glow: css`
    pointer-events: none;

    position: absolute;
    z-index: 0;
    inset-block-start: 50%;
    inset-inline-start: 50%;
    transform: translate(-50%, -50%);

    width: 220px;
    height: 48px;
    border-radius: 50%;

    background: linear-gradient(90deg, rgb(124 58 237 / 25%), rgb(6 182 212 / 25%));
    filter: blur(28px);

    animation: ch-glow 2.8s ease-in-out infinite alternate;

    @keyframes ch-glow {
      0% {
        transform: translate(-50%, -50%) scaleX(0.85);
        opacity: 0.4;
      }

      100% {
        transform: translate(-50%, -50%) scaleX(1.15);
        opacity: 0.9;
      }
    }
  `,
  text: css`
    user-select: none;

    position: relative;
    z-index: 1;

    font-size: 38px;
    font-weight: 700;
    line-height: 1;
    color: transparent;
    letter-spacing: -0.05em;

    background: linear-gradient(
      90deg,
      #5a5a6e 0%,
      #a0a0c0 15%,
      #d4d4f0 28%,
      #fff 40%,
      #c8c8e8 52%,
      #7c3aed 64%,
      #06b6d4 78%,
      #e0e0ff 88%,
      #7c7ca0 100%
    );
    background-clip: text;
    background-size: 250% auto;

    animation: ch-liquid 2.8s ease-in-out infinite alternate;

    -webkit-text-fill-color: transparent;

    @keyframes ch-liquid {
      0% {
        background-position: 0% center;
      }

      100% {
        background-position: 250% center;
      }
    }
  `,
  dots: css`
    display: flex;
    gap: 7px;
    align-items: center;

    span {
      display: inline-block;

      width: 6px;
      height: 6px;
      border-radius: 50%;

      background: linear-gradient(135deg, #7c3aed, #06b6d4);

      animation: ch-dot 1.5s ease-in-out infinite;

      &:nth-child(1) {
        animation-delay: 0s;
      }

      &:nth-child(2) {
        animation-delay: 0.22s;
      }

      &:nth-child(3) {
        animation-delay: 0.44s;
      }
    }

    @keyframes ch-dot {
      0%,
      80%,
      100% {
        transform: scale(0.65);
        opacity: 0.3;
      }

      40% {
        transform: scale(1);
        opacity: 1;
      }
    }
  `,
}));

const BrandTextLoading = memo<BrandTextLoadingProps>(({ debugId }) => {
  const { styles } = useStyles();

  return (
    <div className={styles.container} data-debug-id={debugId}>
      <div aria-label="Loading ChinnaHub" className={styles.wrapper} role="status">
        <div className={styles.glow} />
        <div className={styles.text}>ChinnaHub</div>
        <div className={styles.dots}>
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
});

BrandTextLoading.displayName = 'BrandTextLoading';

export default BrandTextLoading;
