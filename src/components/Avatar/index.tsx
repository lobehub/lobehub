'use client';

import { Avatar as LobeAvatar, type AvatarProps as LobeAvatarProps } from '@lobehub/ui/base-ui';
import { memo } from 'react';

import { remoteAvatarSrc, resolveAvatar } from './fallback';
import { useBrokenSrc } from './useBrokenSrc';

export interface AvatarProps extends LobeAvatarProps {
  /**
   * Seed for the fallback initials. Defaults to `title`; pass it when the
   * visible name differs from the tooltip title.
   */
  name?: string;
}

/**
 * Avatar with an identity-preserving fallback.
 *
 * `@lobehub/ui`'s Avatar falls back to `String(title).slice(0, 2)`, which
 * renders a literal "UN" — the first letters of `"undefined"` — whenever the
 * image 404s and no title was passed. This wrapper derives the initials from
 * the name instead, so a missing image still reads as *this* agent rather than
 * as a broken one.
 *
 * The image element is rendered here rather than left to the library so this
 * component owns the `error` event. Probing the URL separately would let the
 * two disagree, and on disagreement the library's own "UN" fallback wins.
 */
const Avatar = memo<AvatarProps>(
  ({ alt, avatar, background, name, size = 48, title, unoptimized, ...rest }) => {
    const src = remoteAvatarSrc(avatar);
    const [isBroken, markBroken] = useBrokenSrc(src);

    const imgAlt = alt || name || title || 'avatar';
    const resolved = resolveAvatar({
      avatar:
        src && !isBroken ? (
          <img
            alt={imgAlt}
            draggable={false}
            height={size}
            loading={'lazy'}
            src={src}
            width={size}
            onError={markBroken}
          />
        ) : (
          avatar
        ),
      background,
      isBroken,
      name,
      title,
    });

    return (
      <LobeAvatar
        {...rest}
        alt={imgAlt}
        avatar={resolved.avatar}
        background={resolved.background}
        size={size}
        title={title}
        unoptimized={unoptimized}
      />
    );
  },
);

Avatar.displayName = 'Avatar';

export default Avatar;
