'use client';

import { Flexbox } from '@lobehub/ui';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFetchWorkspaceMembers } from '@/business/client/hooks/useFetchWorkspaceMembers';
import Page from '@/routes/(main)/settings/stats';
import WorkspaceWelcome from '@/routes/(main)/settings/stats/features/overview/WorkspaceWelcome';
import { type UserDisplay } from '@/routes/(main)/settings/stats/types';

interface WorkspaceStatsMemberProfile {
  avatar?: string | null;
  email?: string | null;
  fullName?: string | null;
  username?: string | null;
}

interface WorkspaceStatsMember {
  deletedAt?: Date | string | null;
  user?: WorkspaceStatsMemberProfile | null;
  userId: string;
}

const WorkspaceStatsSetting = () => {
  const { t } = useTranslation('auth');

  const { data: members = [] } = useFetchWorkspaceMembers({ includeDeleted: true });

  const memberMap = useMemo(() => {
    const map = new Map<string, UserDisplay>();
    for (const m of members) {
      const member = m as WorkspaceStatsMember;
      const profile = member.user;
      const name = profile?.fullName || profile?.username || profile?.email || member.userId;
      map.set(member.userId, {
        avatar: profile?.avatar ?? null,
        name: member.deletedAt ? t('usage.activeModels.removedUserName', { name }) : name,
      });
    }
    return map;
  }, [members, t]);

  const resolveUser = useCallback(
    (userId: string): UserDisplay => memberMap.get(userId) ?? { avatar: null, name: userId },
    [memberMap],
  );

  return (
    <Flexbox gap={16}>
      <Page
        enableUserDimension
        headerNode={<WorkspaceWelcome />}
        resolveUser={resolveUser}
        showSettingHeader={false}
      />
    </Flexbox>
  );
};

WorkspaceStatsSetting.displayName = 'WorkspaceStatsSetting';

export default WorkspaceStatsSetting;
