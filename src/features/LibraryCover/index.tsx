'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type CSSProperties, memo, type ReactNode } from 'react';

import { resolveLibraryCover } from './presets';

export * from './presets';

const styles = stylex.create({
  cover: {
    position: 'relative',
    overflow: 'hidden',
    flex: 'none',
    width: '100%',
    backgroundColor: cssVar.colorFillTertiary,
  },
  image: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
});

interface LibraryCoverProps {
  children?: ReactNode;
  /** Stored cover value (`preset:<id>` or an image URL). */
  cover?: string | null;
  height?: number | string;
  /** Picks the default cover when none is stored — the library id. */
  seed: string;
  style?: CSSProperties;
}

const LibraryCover = memo<LibraryCoverProps>(({ children, cover, height = 120, seed, style }) => {
  const resolved = resolveLibraryCover(cover, seed);

  const coverProps = stylex.props(styles.cover);

  return (
    <div
      className={coverProps.className}
      style={{
        ...coverProps.style,
        // A gradient preset is the background; an image sits on the neutral fill,
        // which is also what a broken image URL degrades to.
        ...(resolved.kind === 'preset' ? { backgroundImage: resolved.background } : {}),
        height,
        ...style,
      }}
    >
      {resolved.kind === 'image' && (
        <img alt="" src={resolved.url} {...stylex.props(styles.image)} />
      )}
      {children}
    </div>
  );
});

LibraryCover.displayName = 'LibraryCover';

export default LibraryCover;
