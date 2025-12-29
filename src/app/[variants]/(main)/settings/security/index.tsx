'use client';

import { Skeleton } from '@lobehub/ui';
import dynamic from 'next/dynamic';
import { memo } from 'react';
import { Navigate } from 'react-router-dom';

import { enableClerk } from '@/const/auth';

const ClerkProfile = dynamic(() => import('./features/ClerkProfile'), {
  loading: () => (
    <div style={{ flex: 1 }}>
      <Skeleton paragraph={{ rows: 8 }} title={false} />
    </div>
  ),
});

const SecuritySettings = memo(() => {
  return enableClerk ? <ClerkProfile /> : <Navigate replace to="/settings" />;
});

export default SecuritySettings;
