'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { ArrowLeft } from 'lucide-react';
import { memo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import StoreSearchBar from '@/app/[variants]/(main)/community/features/Search';
import UserAvatar from '@/app/[variants]/(main)/community/features/UserAvatar';
import NavHeader from '@/features/NavHeader';

import { styles } from './Header/style';

const Header = memo(() => {
  const location = useLocation();
  const navigate = useNavigate();

  const handleGoBack = () => {
    // Extract the path segment (agent, model, provider, mcp, group_agent, user)
    const path = location.pathname.split('/').filter(Boolean);
    const detailType = path[1];

    // group_agent goes back to agent list page
    if (detailType === 'group_agent') {
      navigate('/community/agent');
      return;
    }

    // Types that have their own list pages
    const typesWithListPage = ['agent', 'model', 'provider', 'mcp'];

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
      left={
        <Flexbox align={'center'} flex={1} gap={8} horizontal>
          <ActionIcon icon={ArrowLeft} onClick={handleGoBack} size={'small'} />
          <StoreSearchBar />
        </Flexbox>
      }
      right={<UserAvatar />}
      style={cssVariables}
      styles={{
        left: { flex: 1 },
      }}
    />
  );
});

export default Header;
