'use client';

import { Flexbox } from '@lobehub/ui';

import { OrgAdminMembers } from '@/features/OrgAdmin';

const OrgMembersPage = () => (
  <Flexbox padding={24} style={{ maxWidth: 960, width: '100%' }}>
    <OrgAdminMembers />
  </Flexbox>
);

export default OrgMembersPage;
