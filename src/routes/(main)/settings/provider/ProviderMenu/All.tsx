import { WalletCards } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import NavItem from '@/features/NavPanel/components/NavItem';

export const PROVIDER_ALL_PATH = 'all';

const All = memo((props: { onClick: (activeTab: string) => void }) => {
  const { onClick } = props;
  const { t } = useTranslation('modelProvider');
  const location = useLocation();

  // Extract providerId from pathname: /settings/provider/xxx -> xxx
  const activeKey = useMemo(() => {
    const pathParts = location.pathname.split('/');
    // pathname is like /settings/provider/all or /settings/provider/openai
    if (pathParts.length >= 4 && pathParts[2] === 'provider') {
      return pathParts[3];
    }
    return null;
  }, [location.pathname]);

  return (
    <NavItem
      active={activeKey === PROVIDER_ALL_PATH}
      icon={WalletCards}
      title={t('menu.all')}
      onClick={() => {
        onClick(PROVIDER_ALL_PATH);
      }}
    />
  );
});
export default All;
