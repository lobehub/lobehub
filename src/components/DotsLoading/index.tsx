import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type CSSProperties, memo } from 'react';

import { sx } from '@/styles/sx';

const fade = stylex.keyframes({
  '0%, 100%': { opacity: 0.3 },
  '50%': { opacity: 1 },
});

const styles = stylex.create({
  container: {
    display: 'inline-flex',
    flexDirection: 'row',
    gap: 'var(--dots-loading-gap)',
    alignItems: 'center',
  },
  dot: {
    width: 'var(--dots-loading-size)',
    height: 'var(--dots-loading-size)',
    borderRadius: '50%',
    backgroundColor: 'var(--dots-loading-color)',
    animationName: fade,
    animationDuration: '1.2s',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
  },
});

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
    <div {...sx([styles.container], className, { ...cssVars, ...style })}>
      <div {...sx([styles.dot], undefined, { animationDelay: '0s' })} />
      <div {...sx([styles.dot], undefined, { animationDelay: '0.15s' })} />
      <div {...sx([styles.dot], undefined, { animationDelay: '0.3s' })} />
    </div>
  );
});

export default DotsLoading;
