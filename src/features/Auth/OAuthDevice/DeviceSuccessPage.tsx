'use client';

import { memo } from 'react';

import OAuthGuard from '../OAuthGuard';
import DeviceSuccess from './DeviceSuccess';

const DeviceSuccessPage = memo(() => (
  <OAuthGuard>
    <DeviceSuccess />
  </OAuthGuard>
));

DeviceSuccessPage.displayName = 'DeviceSuccessPage';

export default DeviceSuccessPage;
