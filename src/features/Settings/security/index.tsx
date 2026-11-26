'use client';

import { Navigate } from 'react-router';

// Account security lives on the Profile page; `/settings` itself now opens
// the personal space's own settings.
const Page = () => {
  return <Navigate replace to="/settings/profile" />;
};

export default Page;
