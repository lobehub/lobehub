'use client';

import SubscriptionAccounts from '@/features/SubscriptionAccounts';
import { WorkspaceAdminOnly } from '@/features/WorkspaceSetting';

const WorkspaceSubscriptionAccountsSetting = () => (
  <WorkspaceAdminOnly>
    <SubscriptionAccounts />
  </WorkspaceAdminOnly>
);

WorkspaceSubscriptionAccountsSetting.displayName = 'WorkspaceSubscriptionAccountsSetting';

export default WorkspaceSubscriptionAccountsSetting;
