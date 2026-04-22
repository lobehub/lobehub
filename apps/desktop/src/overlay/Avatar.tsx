import { FluentEmoji, getEmoji } from '@lobehub/fluent-emoji';
import { memo, useMemo } from 'react';

import * as styles from './avatar.css.ts';

export interface OverlayAvatarProps {
  avatar?: string | null;
  background?: string | null;
  size?: number;
  title?: string | null;
}

const URL_PATTERN = /^(?:blob:|data:|file:|https?:|\/|\.\.?\/)/;

const isUrl = (value: string) => URL_PATTERN.test(value);

const firstGlyph = (value?: string | null) => {
  if (!value) return '?';
  const trimmed = value.trim();
  return trimmed ? Array.from(trimmed)[0] ?? '?' : '?';
};

const OverlayAvatar = memo<OverlayAvatarProps>(({ avatar, background, size = 18, title }) => {
  const emoji = useMemo(
    () => (avatar && typeof avatar === 'string' ? getEmoji(avatar) : undefined),
    [avatar],
  );

  const boxStyle = {
    background: background ?? undefined,
    height: size,
    width: size,
  };

  if (emoji) {
    return (
      <span className={styles.emojiBox} style={boxStyle}>
        <FluentEmoji emoji={emoji} size={Math.round(size * 0.82)} type="3d" />
      </span>
    );
  }

  if (avatar && isUrl(avatar)) {
    return (
      <img
        alt={title ?? 'avatar'}
        className={styles.image}
        draggable={false}
        src={avatar}
        style={boxStyle}
      />
    );
  }

  return (
    <span className={styles.textBox} style={boxStyle}>
      {firstGlyph(title ?? avatar)}
    </span>
  );
});

OverlayAvatar.displayName = 'OverlayAvatar';

export default OverlayAvatar;
