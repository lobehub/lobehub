'use client';

import { PlatformAdminPanel } from '@/features/PlatformAdmin';
import SettingContainer from '@/features/Setting/SettingContainer';

const PlatformAdminPage = () => (
  <SettingContainer
    flex={1}
    maxWidth={1100}
    paddingBlock={'24px 48px'}
    paddingInline={24}
    style={{ minHeight: 0 }}
  >
    <PlatformAdminPanel />
  </SettingContainer>
);

export default PlatformAdminPage;
