'use client';

import { Github } from '@lobehub/icons';
import { Avatar, Center } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { parseGithubRepository } from './CreateFromGithub/githubRepository';

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
  /** The repository URL an environment checks out. */
  url?: string;
}

/**
 * A repository told apart at a glance: its owner's round GitHub avatar, the
 * GitHub mark when the URL names no GitHub owner.
 */
const RepositoryAvatar = ({ size = 16, url }: RepositoryAvatarProps) => {
  const owner = url ? parseGithubRepository(url)?.fullName.split('/')[0] : undefined;

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
