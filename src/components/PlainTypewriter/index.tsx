'use client';

import { memo, type ReactNode } from 'react';

import { usePlainTypewriter } from './usePlainTypewriter';

export interface PlainTypewriterProps {
  cursorCharacter?: ReactNode;
  deletePauseDuration?: number;
  deletingSpeed?: number;
  hideCursorWhileTyping?: boolean | 'typing' | 'afterTyping';
  pauseDuration?: number;
  sentences: string[];
  typingSpeed?: number;
}

/**
 * Typewriter that keeps the visible string in a single text node.
 *
 * Unlike `@lobehub/ui` TypewriterEffect (which wraps each grapheme in an
 * `inline-block` span), this preserves Arabic/Persian cursive joining so the
 * newest character connects to the previous ones while typing.
 */
const PlainTypewriter = memo<PlainTypewriterProps>(
  ({
    sentences,
    typingSpeed = 100,
    deletingSpeed = 50,
    pauseDuration = 2000,
    deletePauseDuration = 0,
    cursorCharacter,
    hideCursorWhileTyping = false,
  }) => {
    const { displayedText, showCursor } = usePlainTypewriter({
      deletePauseDuration,
      deletingSpeed,
      hideCursorWhileTyping,
      pauseDuration,
      sentences,
      typingSpeed,
    });

    return (
      <span style={{ whiteSpace: 'pre-wrap' }}>
        {displayedText}
        {cursorCharacter && showCursor ? (
          <span style={{ display: 'inline-block', marginInlineStart: '0.25rem' }}>
            {cursorCharacter}
          </span>
        ) : null}
      </span>
    );
  },
);

PlainTypewriter.displayName = 'PlainTypewriter';

export default PlainTypewriter;
