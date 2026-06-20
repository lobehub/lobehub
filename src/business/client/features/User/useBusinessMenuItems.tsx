import { Icon } from '@lobehub/ui';
import { ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router';
import useSWR from 'swr';

import { lambdaClient } from '@/libs/trpc/client';

export default function useBusinessMenuItems(isSignin: boolean | undefined) {
  const navigate = useNavigate();
  const { data } = useSWR(isSignin ? ['business/personal-billing'] : null, () =>
    lambdaClient.personalBilling.get.query(),
  );

  if (!isSignin || !data?.isSuperAdmin) return [];

  return [
    {
      icon: <Icon icon={ShieldCheck} />,
      key: 'business-admin',
      label: 'Super-admin: Business',
      onClick: () => navigate('/admin/business'),
    },
  ];
}
