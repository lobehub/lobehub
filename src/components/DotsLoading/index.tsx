import { createStaticStyles, cssVar, cx } from 'antd-style';
import { type CSSProperties, memo } from 'react';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    display: inline-flex;
    flex-direction: row;
    gap: var(--dots-loading-gap);
    align-items: center;
  `,
  dot: css`
    width: var(--dots-loading-size);
    height: var(--dots-loading-size);
    border-radius: 50%;

    background-color: var(--dots-loading-color);

    animation: dots-loading-fade 1.2s ease-in-out infinite;

    @keyframes dots-loading-fade {
      0%,
      100% {
        opacity: 0.3;
      }

      50% {
        opacity: 1;
      }
    }
  `,
}));

interface StyleArgs {
  color?: string;
  gap?: number;
  size?: number;
}

interface DotsLoadingProps extends StyleArgs {
  className?: string;
  style?: CSSProperties;
}

const DotsLoading = memo<DotsLoadingProps>(({ size = 4, gap = 3, color, className, style }) => {
  const cssVars = {
    '--dots-loading-color': color || cssVar.colorTextSecondary,
    '--dots-loading-gap': `${gap}px`,
    '--dots-loading-size': `${size}px`,
  } as CSSProperties;

  return (
    <div className={cx(styles.container, className)} style={{ ...cssVars, ...style }}>
      <div className={styles.dot} style={{ animationDelay: '0s' }} />
      <div className={styles.dot} style={{ animationDelay: '0.15s' }} />
      <div className={styles.dot} style={{ animationDelay: '0.3s' }} />
    </div>
  );
});

export default DotsLoading;
