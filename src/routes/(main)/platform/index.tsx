'use client';

import { useAicoPanelContainerProps } from '@/features/AicoPanels';
import { PlatformAdminPanel } from '@/features/PlatformAdmin';
import SettingContainer from '@/features/Setting/SettingContainer';

const PlatformAdminPage = () => {
  const containerProps = useAicoPanelContainerProps(1100);

  return (
    <SettingContainer {...containerProps}>
      <PlatformAdminPanel />
    </SettingContainer>
  );
};

export default PlatformAdminPage;
