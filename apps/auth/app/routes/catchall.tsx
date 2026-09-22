import { useEffect } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';

// The worker answers `/` and unmatched paths before React Router sees them; this
// only runs for a client-side navigation that fell through the route table.
export default function AuthCatchAll() {
  useEffect(() => {
    window.location.replace('/signin');
  }, []);

  return <Loading debugId={'AuthCatchAll'} />;
}
