'use client';

import { useAicoPanelContainerProps } from '@/features/AicoPanels';
import { OrgAdminMembers } from '@/features/OrgAdmin';
import SettingContainer from '@/features/Setting/SettingContainer';

const OrgPage = () => {
  const containerProps = useAicoPanelContainerProps(960);

  return (
    <SettingContainer {...containerProps}>
      <OrgAdminMembers />
    </SettingContainer>
  );
};

export default OrgPage;
