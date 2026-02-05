'use client';

import { SiGithub, SiX } from '@icons-pack/react-simple-icons';
import { ActionIcon, Avatar, Button, Flexbox, Text, Tooltip, TooltipGroup } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Globe } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserDetailContext } from '../DetailProvider';
import FollowButton from '../FollowButton';
import FollowStats from '../FollowStats';
import Banner from './Banner';

const UserHeader = memo(() => {
  const { t } = useTranslation('discover');
  const { user, isOwner, onEditProfile } = useUserDetailContext();

  const displayName = user.displayName || user.userName || user.namespace;
  const username = user.userName || user.namespace;

  // Normalize avatar URL - convert relative paths to absolute URLs
  const avatarUrl = useMemo(() => {
    if (!user.avatarUrl) return undefined;
    // If it's a relative path (starts with /), prepend the origin
    if (user.avatarUrl.startsWith('/')) {
      return `${window.location.origin}${user.avatarUrl}`;
    }
    return user.avatarUrl;
  }, [user.avatarUrl]);

  const bannerUrl = useMemo(() => {
    if (!user.bannerUrl) return null;
    // If it's a relative path (starts with /), prepend the origin
    if (user.bannerUrl.startsWith('/')) {
      return `${window.location.origin}${user.bannerUrl}`;
    }
    return user.bannerUrl;
  }, [user.bannerUrl]);

  return (
    <>
      <Banner avatar={avatarUrl} bannerUrl={bannerUrl} />
      <Flexbox gap={16}>
        <Avatar
          avatar={avatarUrl}
          shape={'square'}
          size={64}
          style={{ boxShadow: `0 0 0 4px ${cssVar.colorBgContainer}`, flexShrink: 0 }}
        />
        <Flexbox horizontal align={'flex-start'} gap={16} justify={'space-between'}>
          <Flexbox
            gap={4}
            style={{
              overflow: 'hidden',
            }}
          >
            <Text ellipsis as={'h1'} fontSize={24} style={{ margin: 0 }} weight={'bold'}>
              {displayName}
            </Text>
            <Text ellipsis fontSize={12} type={'secondary'}>
              @{username}
            </Text>
          </Flexbox>
          {isOwner ? (
            onEditProfile && (
              <Button shape={'round'} onClick={() => onEditProfile()}>
                {t('user.editProfile')}
              </Button>
            )
          ) : (
            <FollowButton userId={user.id} />
          )}
        </Flexbox>

        <FollowStats />

        {user.description && <Text as={'p'}>{user.description}</Text>}

        <TooltipGroup>
          <Flexbox horizontal align={'center'} gap={8}>
            {user.socialLinks?.github && (
              <Tooltip title={`@${user.socialLinks?.github}`}>
                <a
                  href={`https://github.com/${user?.socialLinks?.github}`}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <ActionIcon icon={<SiGithub size={16} />} size={20} variant={'outlined'} />
                </a>
              </Tooltip>
            )}
            {user.socialLinks?.twitter && (
              <Tooltip title={`@${user.socialLinks?.twitter}`}>
                <a
                  href={`https://twitter.com/${user?.socialLinks?.twitter}`}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <ActionIcon icon={<SiX size={16} />} size={20} variant={'outlined'} />
                </a>
              </Tooltip>
            )}
            {user.socialLinks?.website && (
              <Tooltip title={user.socialLinks?.website}>
                <a href={user?.socialLinks?.website} rel="noopener noreferrer" target="_blank">
                  <ActionIcon icon={Globe} size={20} variant={'outlined'} />
                </a>
              </Tooltip>
            )}
          </Flexbox>
        </TooltipGroup>
      </Flexbox>
    </>
  );
});

export default UserHeader;
