'use client';

import { Github } from '@lobehub/icons';
import { Avatar, Center } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({
  fallback: {
    flex: 'none',
    borderRadius: '50%',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
  },
});

interface RepositoryAvatarProps {
  size?: number;
  /** The repository an environment checks out: its GitHub URL, or `owner/name`. */
  url?: string;
}

/**
 * A repository told apart at a glance: its owner's round GitHub avatar, the
 * GitHub mark when the URL names no GitHub owner.
 */
/** The owner of `https://github.com/owner/name`, `git@github.com:owner/name` or `owner/name`. */
export const githubOwner = (url?: string) =>
  url
    ? /^(?:https:\/\/github\.com\/|git@github\.com:)?([\w.-]+)\/[\w.-]+/.exec(url.trim())?.[1]
    : undefined;

const RepositoryAvatar = ({ size = 16, url }: RepositoryAvatarProps) => {
  const owner = githubOwner(url);

  if (!owner)
    return (
      <Center height={size} width={size} {...stylex.props(styles.fallback)}>
        <Github size={Math.round(size * 0.65)} />
      </Center>
    );

  return (
    <Avatar
      avatar={`https://github.com/${owner}.png?size=${size * 2}`}
      shape={'circle'}
      size={size}
      style={{ flex: 'none' }}
      title={owner}
    />
  );
};

export default RepositoryAvatar;
