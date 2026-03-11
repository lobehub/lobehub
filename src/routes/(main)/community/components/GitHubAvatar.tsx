import { type AvatarProps } from '@lobehub/ui';
import { Avatar } from '@lobehub/ui';
import qs from 'query-string';
import { memo } from 'react';
import urlJoin from 'url-join';

interface GitHubAvatarProps extends Omit<AvatarProps, 'avatar'> {
  username: string;
}

const GitHubAvatar = memo<GitHubAvatarProps>(({ username, size = 24 }) => {
  const url = qs.stringifyUrl({
    query: { size: size * 2 },
    url: urlJoin('https://github.com', `${username}.png`),
  });

  return <Avatar alt={username} avatar={url} shape={'square'} size={size} />;
});

export default GitHubAvatar;
