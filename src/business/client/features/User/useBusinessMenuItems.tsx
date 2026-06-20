import { ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router';

export default function useBusinessMenuItems(isSignin: boolean | undefined) {
  const navigate = useNavigate();

  if (!isSignin) return [];

  return [
    {
      icon: ShieldCheck,
      key: 'business-admin',
      label: 'Super-admin: Business',
      onClick: () => navigate('/admin/business'),
    },
  ];
}
