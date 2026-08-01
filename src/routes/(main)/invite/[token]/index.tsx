'use client';

import { AcceptOrgInvite } from '@/features/OrgAdmin';
import SettingContainer from '@/features/Setting/SettingContainer';

const InviteTokenPage = () => (
  <SettingContainer
    flex={1}
    maxWidth={960}
    paddingBlock={'24px 48px'}
    paddingInline={24}
    style={{ minHeight: 0 }}
  >
    <AcceptOrgInvite />
  </SettingContainer>
);

export default InviteTokenPage;
