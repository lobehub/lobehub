import { Building2, Wallet } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { type CellProps } from '@/components/Cell';

/**
 * Aico billing / org surfaces on the mobile Me home list.
 * `/platform` stays reachable by URL only (no list entry).
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
    { type: 'divider' },
  ];
}
