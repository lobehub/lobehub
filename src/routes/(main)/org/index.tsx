'use client';

import { OrgAdminMembers } from '@/features/OrgAdmin';
import SettingContainer from '@/features/Setting/SettingContainer';

const OrgPage = () => (
  <SettingContainer
    flex={1}
    maxWidth={960}
    paddingBlock={'24px 48px'}
    paddingInline={24}
    style={{ minHeight: 0 }}
  >
    <OrgAdminMembers />
  </SettingContainer>
);

export default OrgPage;
