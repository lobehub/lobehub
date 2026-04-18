import { createStyles, keyframes } from 'antd-style';
import { type CSSProperties, memo } from 'react';

const fade = keyframes`
  0%, 100% {
    opacity: 0.3;
  }
  50% {
    opacity: 1;
  }
`;

interface StyleParams {
  color?: string;
  gap: number;
  size: number;
}

const useStyles = createStyles(({ css, token }, { size, gap, color }: StyleParams) => ({
  container: css`
    display: inline-flex;
    flex-direction: row;
    gap: ${gap}px;
    align-items: center;
  `,
  dot: css`
    width: ${size}px;
    height: ${size}px;
    border-radius: 50%;

    background-color: ${color || token.colorTextSecondary};

    animation: ${fade} 1.2s ease-in-out infinite;
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
  const { styles: s, cx } = useStyles({ color, gap, size });
  return (
    <div className={cx(s.container, className)} style={style}>
      <div className={s.dot} style={{ animationDelay: '0s' }} />
      <div className={s.dot} style={{ animationDelay: '0.15s' }} />
      <div className={s.dot} style={{ animationDelay: '0.3s' }} />
    </div>
  );
});

export default DotsLoading;
