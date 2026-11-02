import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({
  draggable: { WebkitAppRegion: 'drag' },
  nodrag: { WebkitAppRegion: 'no-drag' },
});

export const draggable = stylex.props(styles.draggable).className ?? '';

export const nodrag = stylex.props(styles.nodrag).className ?? '';

export const electronStylish = {
  draggable,
  nodrag,
};
