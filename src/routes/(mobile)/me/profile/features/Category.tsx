'use client';

import { ChartColumnBigIcon, LogOut, UserCircle } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { type CellProps } from '@/components/Cell';
import Cell from '@/components/Cell';
import { ProfileTabs } from '@/store/global/initialState';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

const Category = memo(() => {
  const [isLogin, signOut] = useUserStore((s) => [authSelectors.isLogin(s), s.logout]);
  const navigate = useNavigate();
  const { t } = useTranslation('auth');
  const items: CellProps[] = [
    {
      icon: UserCircle,
      key: ProfileTabs.Profile,
      label: t('tab.profile'),
      onClick: () => navigate('/settings/profile'),
    },
    {
      icon: ChartColumnBigIcon,
      key: ProfileTabs.Stats,
      label: t('tab.stats'),
      onClick: () => navigate('/settings/stats'),
    },
    isLogin && {
      type: 'divider',
    },
    isLogin && {
      icon: LogOut,
      key: 'logout',
      label: t('signout', { ns: 'auth' }),
      onClick: () => {
        signOut();
        navigate('/signin');
      },
    },
  ].filter(Boolean) as CellProps[];

  return items?.map(({ key, ...item }, index) => <Cell key={key || index} {...item} />);
});

export default Category;
