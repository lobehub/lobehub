'use client';

import { ActionIcon, cssVar, Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ArrowLeft } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import urlJoin from 'url-join';

import { MARKETPLACE_CONNECTOR_PATH, MARKETPLACE_SEGMENT } from '@/features/Marketplace/paths';
import NavHeader from '@/features/NavHeader';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import StoreSearchBar from '@/routes/(main)/community/features/Search';
import UserAvatar from '@/routes/(main)/community/features/UserAvatar';
import { useDiscoverStore } from '@/store/discover';
import { userSelectors } from '@/store/discover/selectors';

import { styles } from './Header/style';

const Header = memo(() => {
  const { t } = useTranslation('common');
  const location = useLocation();
  const navigate = useWorkspaceAwareNavigate();
  const path = location.pathname.split('/').filter(Boolean);
  const communityIndex = path.indexOf(MARKETPLACE_SEGMENT);
  const detailType = communityIndex >= 0 ? path[communityIndex + 1] : undefined;
  const detailSlug = communityIndex >= 0 ? path[communityIndex + 2] : undefined;
  const profileUsername =
    (detailType === 'user' || detailType === 'org') && detailSlug
      ? decodeURIComponent(detailSlug)
      : '';

  const useUserProfile = useDiscoverStore((s) => s.useUserProfile);
  const { queryKey: detailProfileQueryKey } = useUserProfile({ username: profileUsername });
  // The replica view of this profile; the sync hook only reports the fetch flags.
  const detailProfile = useDiscoverStore(userSelectors.userProfile(detailProfileQueryKey));
  const detailAvatar =
    detailProfile?.user.avatarUrl || detailProfile?.user.userName || detailProfile?.user.namespace;

  const handleGoBack = () => {
    const catalog = location.state?.marketplaceCatalog;
    if (typeof catalog === 'string') {
      navigate(catalog, { escape: true, replace: true });
      return;
    }
    if (detailType === 'mcp') {
      navigate(MARKETPLACE_CONNECTOR_PATH);
      return;
    }
    // group_agent goes back to agent list page
    if (detailType === 'group_agent') {
      navigate('/marketplace/agent');
      return;
    }

    // Types that have their own list pages
    const typesWithListPage = ['agent', 'model', 'provider', 'mcp', 'skill'];

    if (detailType && typesWithListPage.includes(detailType)) {
      navigate(urlJoin('/marketplace', detailType));
    } else {
      // For user or any other type without a list page
      navigate('/marketplace');
    }
  };

  const cssVariables: Record<string, string> = {
    '--header-border-color': cssVar.colorBorderSecondary,
  };

  return (
    <NavHeader
      className={stylex.props(styles.headerContainer).className}
      right={<UserAvatar avatarOverride={detailAvatar} />}
      style={cssVariables}
      left={
        <Flexbox horizontal align={'center'} flex={1} gap={8}>
          <ActionIcon icon={ArrowLeft} size={'small'} title={t('back')} onClick={handleGoBack} />
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
