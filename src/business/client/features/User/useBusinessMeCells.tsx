import { Building2, Shield, Wallet } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { type CellProps } from '@/components/Cell';

/**
 * Aico billing / org surfaces on the mobile Me home list.
 */
export default function useBusinessMeCells(): CellProps[] {
  const { t } = useTranslation('aico');
  const navigate = useNavigate();

  return [
    {
      icon: Wallet,
      key: 'aico-wallet',
      label: t('nav.wallet'),
      onClick: () => navigate('/wallet'),
    },
    {
      icon: Building2,
      key: 'aico-org',
      label: t('nav.org'),
      onClick: () => navigate('/org'),
    },
    {
      icon: Shield,
      key: 'aico-platform',
      label: t('nav.platform'),
      onClick: () => navigate('/platform'),
    },
    { type: 'divider' },
  ];
}
