import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { Star } from 'lucide-react';
import { memo } from 'react';

/** `value` out of five stars, filled to the nearest half. */
const Stars = memo<{ size?: number; value: number }>(({ size = 12, value }) => {
  const rounded = Math.round(value * 2) / 2;
  return (
    <span style={{ display: 'inline-flex', gap: Math.max(1, size / 8) }}>
      {[1, 2, 3, 4, 5].map((index) => {
        const fill = rounded >= index ? 1 : rounded >= index - 0.5 ? 0.5 : 0;
        return (
          <span key={index} style={{ display: 'inline-flex', position: 'relative' }}>
            <Star color={cssVar.colorFillSecondary} fill={cssVar.colorFillSecondary} size={size} />
            {fill > 0 && (
              <span
                style={{
                  // A flex box, not a line box: an inline SVG sits on the text
                  // baseline and drops below the grey star underneath it.
                  display: 'flex',
                  inset: 0,
                  overflow: 'hidden',
                  position: 'absolute',
                  width: `${fill * 100}%`,
                }}
              >
                <Star
                  color={cssVar.colorWarning}
                  fill={cssVar.colorWarning}
                  size={size}
                  style={{ flex: 'none' }}
                />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
});

Stars.displayName = 'MarketStars';

export default Stars;
