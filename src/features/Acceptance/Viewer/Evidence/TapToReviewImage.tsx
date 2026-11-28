'use client';

import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode } from 'react';

import { floatingActionHostMarker } from '../markers.stylex';

const styles = stylex.create({
  host: {
    position: 'relative',
    width: '100%',
  },
  button: {
    cursor: 'pointer',
    width: '100%',
    padding: 0,
    borderWidth: 0,
    borderStyle: 'none',
    borderColor: 'currentcolor',
    textAlign: 'start',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
  },
  image: {
    display: 'block',
    width: '100%',
    maxWidth: '100%',
    height: '180px',
    borderRadius: '8px',
    objectFit: 'cover',
    objectPosition: 'top',
  },
});

interface TapToReviewImageProps {
  action?: ReactNode;
  alt: string;
  caption?: ReactNode;
  onReview: () => void;
  src: string;
}

// The tap reviews; the comment shortcut sits beside the button rather than
// inside it, since a button cannot hold another one.
export const TapToReviewImage = memo<TapToReviewImageProps>(
  ({ action, alt, caption, onReview, src }) => (
    <div {...stylex.props(styles.host, action ? floatingActionHostMarker : null)}>
      <button type={'button'} {...stylex.props(styles.button)} onClick={onReview}>
        <img alt={alt} loading={'lazy'} src={src} {...stylex.props(styles.image)} />
        {caption}
      </button>
      {action}
    </div>
  ),
);

TapToReviewImage.displayName = 'AcceptanceTapToReviewImage';
