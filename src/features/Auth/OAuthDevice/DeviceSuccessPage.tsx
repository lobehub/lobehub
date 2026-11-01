'use client';

import OAuthGuard from '../OAuthGuard';
import DeviceSuccess from './DeviceSuccess';

const DeviceSuccessPage = () => (
  <OAuthGuard>
    <DeviceSuccess />
  </OAuthGuard>
);

export default DeviceSuccessPage;
