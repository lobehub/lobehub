import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

const styles = stylex.create({
  frame: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    flex: '1',
    minHeight: 0,
    width: '100%',
  },
});

interface BoardFrameProps {
  src: string;
  title: string;
}

// Board pages are served from the app's own origin; the sandbox must never grant
// `allow-same-origin`, or a page could read the app's cookies and storage.
const BoardFrame = memo<BoardFrameProps>(({ src, title }) => (
  <iframe
    {...stylex.props(styles.frame)}
    loading={'lazy'}
    referrerPolicy={'no-referrer'}
    sandbox={'allow-scripts allow-popups allow-forms'}
    src={src}
    title={title}
  />
));

BoardFrame.displayName = 'ArtboardBoardFrame';

export default BoardFrame;
