'use client';

import { Avatar as LobeAvatar, type AvatarProps as LobeAvatarProps } from '@lobehub/ui';
import { memo, type ReactNode, type Ref } from 'react';

import GeneratedCharacter from '@/components/AgentAvatar/GeneratedCharacter';
import { parseGeneratedAgentAvatar } from '@/components/AgentAvatar/resolve';

import { remoteAvatarSrc, resolveAvatar } from './fallback';
import { useBrokenSrc } from './useBrokenSrc';

export interface AvatarProps extends LobeAvatarProps {
  /**
   * Rendered in place of the whole avatar when the image fails to load,
   * instead of the name's initials.
   */
  brokenFallback?: ReactNode;
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
 *
 * An agent avatar that picked a generated character (`generated:<seed>`) draws
 * that character here too, so an agent shown through a plain avatar still
 * wears the character it picked instead of a placeholder.
 */
const Avatar = memo<AvatarProps>(
  ({
    alt,
    avatar,
    background,
    brokenFallback,
    name,
    ref,
    size = 48,
    title,
    unoptimized,
    ...rest
  }) => {
    const src = remoteAvatarSrc(avatar);
    const [isBroken, markBroken] = useBrokenSrc(src);

    if (isBroken && brokenFallback) return brokenFallback;

    const characterSeed = parseGeneratedAgentAvatar(avatar);
    if (characterSeed)
      return (
        <GeneratedCharacter
          className={rest.className}
          domProps={rest}
          name={name || title}
          ref={ref as Ref<HTMLElement>}
          seed={characterSeed}
          size={size}
          style={rest.style}
          onClick={rest.onClick}
        />
      );

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
            // Mirrors @lobehub/ui's own avatar <img>: crop a non-square image
            // to the square instead of stretching it.
            style={{ objectFit: 'cover' }}
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
        ref={ref}
        size={size}
        title={title}
        unoptimized={unoptimized}
      />
    );
  },
);

Avatar.displayName = 'Avatar';

export default Avatar;
