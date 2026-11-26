'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

const styles = stylex.create({
  fan: {
    flexShrink: 0,
    height: 36,
    position: 'relative',
    width: 36,
  },
  image: {
    borderColor: cssVar.colorBgElevated,
    borderRadius: 5,
    borderStyle: 'solid',
    borderWidth: 1.5,
    boxShadow: '0 1px 3px rgb(0 0 0 / 18%)',
    height: 28,
    insetBlockStart: 4,
    insetInlineStart: 5,
    objectFit: 'cover',
    position: 'absolute',
    width: 26,
  },
  transform: (transform: string) => ({ transform }),
});

/**
 * Back cards first, cover last so it paints on top. Two images tilt the back
 * one to the right; three spread the back pair to both sides.
 */
const TRANSFORMS: Record<number, string[]> = {
  2: ['translateX(4px) rotate(10deg)', 'translateX(-2px) rotate(-4deg)'],
  3: ['translateX(-5px) rotate(-12deg)', 'translateX(5px) rotate(12deg)', 'rotate(0deg)'],
};

interface CollectionFanProps {
  /** Two or three image URLs, cover first. */
  urls: string[];
}

/** Collection card thumbnail: the cover in front with up to two more images fanned behind it. */
const CollectionFan = memo<CollectionFanProps>(({ urls }) => {
  const [cover, ...rest] = urls;
  const ordered = [...rest, cover];
  const transforms = TRANSFORMS[ordered.length] ?? TRANSFORMS[3];

  return (
    <div {...stylex.props(styles.fan)}>
      {ordered.map((url, index) => (
        <img
          alt=""
          key={url}
          loading="lazy"
          src={url}
          {...stylex.props(styles.image, styles.transform(transforms[index]))}
        />
      ))}
    </div>
  );
});

CollectionFan.displayName = 'CollectionFan';

export default CollectionFan;
