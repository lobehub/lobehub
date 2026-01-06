import { createStaticStyles, keyframes } from 'antd-style';
import { memo } from 'react';

const smallLoaderAnim = keyframes`
  100% {
    transform: rotate(1turn);
  }
`;

const styles = createStaticStyles(({ css, cssVar }) => ({
  background: css`
    position: absolute;
    inset: 0;

    aspect-ratio: 1;
    width: 100%;
    border-radius: 50%;

    background: ${cssVar.colorFill};

    mask: radial-gradient(
      farthest-side,
      #0000 calc(100% - var(--circle-loader-border-width, 2.5px)),
      #000 0
    );
  `,
  container: css`
    position: relative;
    width: 13px;
    height: 13px;
  `,

  loader: css`
    position: absolute;
    inset: 0;

    aspect-ratio: 1;
    width: 100%;
    border-radius: 50%;

    background:
      radial-gradient(farthest-side, ${cssVar.colorTextSecondary} 94%, #0000) top/
        var(--circle-loader-border-width, 2.5px) var(--circle-loader-border-width, 2.5px) no-repeat,
      conic-gradient(#0000 50%, ${cssVar.colorTextSecondary});

    mask: radial-gradient(
      farthest-side,
      #0000 calc(100% - var(--circle-loader-border-width, 2.5px)),
      #000 0
    );

    animation: ${smallLoaderAnim} 1s infinite linear;
  `,
}));

const CircleLoader = memo(() => {
  return (
    <div className={styles.container}>
      <div className={styles.loader} />
      <div className={styles.background} />
    </div>
  );
});

export default CircleLoader;
