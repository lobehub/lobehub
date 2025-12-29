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
    // Extract the path segment (assistant, model, provider, mcp)
    const path = location.pathname.split('/').filter(Boolean);
    if (path[1] && path[1] !== 'user') {
      navigate(urlJoin('/community', path[1]));
    } else {
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
