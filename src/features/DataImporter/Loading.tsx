import { Center } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

// A 3x3 grid of dots, 28px apart (the offsets below are multiples of it).
const loading = stylex.keyframes({
  '12.5%': {
    boxShadow:
      '28px -28px 0 0, 56px -28px 0 0, 84px -28px 0 5px, 28px 0 0 5px, 56px 0 0 0, 84px 0 0 5px, 28px 28px 0 0, 56px 28px 0 0, 84px 28px 0 0',
  },
  '25%': {
    boxShadow:
      '28px -28px 0 5px, 56px -28px 0 0, 84px -28px 0 5px, 28px 0 0 0, 56px 0 0 0, 84px 0 0 0, 28px 28px 0 0, 56px 28px 0 5px, 84px 28px 0 0',
  },
  '50%': {
    boxShadow:
      '28px -28px 0 5px, 56px -28px 0 5px, 84px -28px 0 0, 28px 0 0 0, 56px 0 0 0, 84px 0 0 0, 28px 28px 0 0, 56px 28px 0 0, 84px 28px 0 5px',
  },
  '62.5%': {
    boxShadow:
      '28px -28px 0 0, 56px -28px 0 0, 84px -28px 0 0, 28px 0 0 5px, 56px 0 0 0, 84px 0 0 0, 28px 28px 0 0, 56px 28px 0 5px, 84px 28px 0 5px',
  },
  '75%': {
    boxShadow:
      '28px -28px 0 0, 56px -28px 0 5px, 84px -28px 0 0, 28px 0 0 0, 56px 0 0 0, 84px 0 0 5px, 28px 28px 0 0, 56px 28px 0 0, 84px 28px 0 5px',
  },
  '87.5%': {
    boxShadow:
      '28px -28px 0 0, 56px -28px 0 5px, 84px -28px 0 0, 28px 0 0 0, 56px 0 0 5px, 84px 0 0 0, 28px 28px 0 5px, 56px 28px 0 0, 84px 28px 0 0',
  },
});

const styles = stylex.create({
  loader: {
    animationDuration: '2s',
    animationIterationCount: 'infinite',
    animationName: loading,
    animationTimingFunction: 'linear',
    aspectRatio: '1',
    borderRadius: '50%',
    boxShadow:
      '28px -28px 0 0, 56px -28px 0 0, 84px -28px 0 0, 28px 0 0 5px, 56px 0 0 5px, 84px 0 0 5px, 28px 28px 0 0, 56px 28px 0 0, 84px 28px 0 0',
    color: cssVar.colorPrimary,
    transform: 'translateX(-56px)',
    width: '6px',
  },
});

const DataLoading = () => {
  return (
    <Center style={{ height: 80 }}>
      <div {...stylex.props(styles.loader)} />
    </Center>
  );
};

export default DataLoading;
