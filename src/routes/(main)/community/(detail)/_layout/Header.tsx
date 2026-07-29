'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { ArrowLeft } from 'lucide-react';
import { memo } from 'react';
import { useLocation } from 'react-router';
import urlJoin from 'url-join';

import NavHeader from '@/features/NavHeader';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import StoreSearchBar from '@/routes/(main)/community/features/Search';
import UserAvatar from '@/routes/(main)/community/features/UserAvatar';
import { useDiscoverStore } from '@/store/discover';

import { styles } from './Header/style';

const Header = memo(() => {
  const location = useLocation();
  const navigate = useWorkspaceAwareNavigate();
  const path = location.pathname.split('/').filter(Boolean);
  const communityIndex = path.indexOf('community');
  const detailType = communityIndex >= 0 ? path[communityIndex + 1] : undefined;
  const detailSlug = communityIndex >= 0 ? path[communityIndex + 2] : undefined;
  const profileUsername =
    (detailType === 'user' || detailType === 'org') && detailSlug
      ? decodeURIComponent(detailSlug)
      : '';

  const useUserProfile = useDiscoverStore((s) => s.useUserProfile);
  const { data: detailProfile } = useUserProfile({ username: profileUsername });
  const detailAvatar =
    detailProfile?.user.avatarUrl || detailProfile?.user.userName || detailProfile?.user.namespace;

  const handleGoBack = () => {
    // group_agent goes back to agent list page
    if (detailType === 'group_agent') {
      navigate('/community/agent');
      return;
    }

    // Types that have their own list pages
    const typesWithListPage = ['agent', 'model', 'provider', 'mcp', 'skill'];

    if (detailType && typesWithListPage.includes(detailType)) {
      navigate(urlJoin('/community', detailType));
    } else {
      // For user or any other type without a list page
      navigate('/community');
    }
  };

  const cssVariables: Record<string, string> = {
    '--header-border-color': cssVar.colorBorderSecondary,
  };

  return (
    <NavHeader
      className={styles.headerContainer}
      right={<UserAvatar avatarOverride={detailAvatar} />}
      style={cssVariables}
      left={
        <Flexbox horizontal align={'center'} flex={1} gap={8}>
          <ActionIcon icon={ArrowLeft} size={'small'} onClick={handleGoBack} />
          <StoreSearchBar />
        </Flexbox>
      }
      styles={{
        left: { flex: 1 },
      }}
    />
  );
});

export default Header;
