import * as stylex from '@stylexjs/stylex';

import { activityStyles } from './styles';

/** Three blinking dots after a "typing" label, like a chat app's typing indicator. */
export const TypingDots = () => (
  <span aria-hidden {...stylex.props(activityStyles.dots)}>
    {[0, 1, 2].map((index) => (
      <span key={index} {...stylex.props(activityStyles.typingDot, activityStyles.delay(index))} />
    ))}
  </span>
);
