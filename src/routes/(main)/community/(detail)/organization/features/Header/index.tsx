'use client';

import { SiGithub, SiX } from '@icons-pack/react-simple-icons';
import { ActionIcon, Avatar, Flexbox, Tag, Text, Tooltip, TooltipGroup } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Globe } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import FollowButton from '@/routes/(main)/community/(detail)/features/FollowButton';

import { useOrganizationDetailContext } from '../DetailProvider';
import FollowStats from '../FollowStats';
import Banner from './Banner';

const normalizeUrl = (input?: string | null) => {
  if (!input) return undefined;
  if (input.startsWith('/')) return `${window.location.origin}${input}`;
  return input;
};

const OrganizationHeader = memo(() => {
  const { t } = useTranslation('discover');
  const { user } = useOrganizationDetailContext();

  const displayName = user.displayName || user.userName || user.namespace;
  const username = user.userName || user.namespace;
  const avatarUrl = useMemo(() => normalizeUrl(user.avatarUrl), [user.avatarUrl]);
  const bannerUrl = useMemo(() => normalizeUrl(user.bannerUrl), [user.bannerUrl]);

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
          <Flexbox gap={4} style={{ overflow: 'hidden' }}>
            <Flexbox horizontal align={'center'} gap={8}>
              <Text ellipsis as={'h1'} fontSize={24} style={{ margin: 0 }} weight={'bold'}>
                {displayName}
              </Text>
              <Tag style={{ flexShrink: 0, margin: 0 }}>{t('user.accountType.organization')}</Tag>
            </Flexbox>
            <Text ellipsis fontSize={12} type={'secondary'}>
              @{username}
            </Text>
          </Flexbox>
          <FollowButton userId={user.id} />
        </Flexbox>

        <FollowStats />

        {user.description && <Text as={'p'}>{user.description}</Text>}

        <TooltipGroup>
          <Flexbox horizontal align={'center'} gap={8}>
            {user.socialLinks?.github && (
              <Tooltip title={`@${user.socialLinks.github}`}>
                <a
                  href={`https://github.com/${user.socialLinks.github}`}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <ActionIcon icon={<SiGithub size={16} />} size={20} variant={'outlined'} />
                </a>
              </Tooltip>
            )}
            {user.socialLinks?.twitter && (
              <Tooltip title={`@${user.socialLinks.twitter}`}>
                <a
                  href={`https://twitter.com/${user.socialLinks.twitter}`}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <ActionIcon icon={<SiX size={16} />} size={20} variant={'outlined'} />
                </a>
              </Tooltip>
            )}
            {user.socialLinks?.website && (
              <Tooltip title={user.socialLinks.website}>
                <a href={user.socialLinks.website} rel="noopener noreferrer" target="_blank">
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

export default OrganizationHeader;
