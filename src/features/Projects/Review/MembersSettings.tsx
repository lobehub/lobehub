import type { ProjectMemberRole } from '@lobechat/types';
import { Block, Button, Empty, Flexbox, Text, toast } from '@lobehub/ui';
import { UserPlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import SkeletonBar from '@/components/Skeleton/Bar';
import { projectReviewService } from '@/services/projectReview';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { openAddMemberModal } from './AddMemberModal';
import { MemberRow } from './MemberRow';
import { actorLast } from './memberSearch';
import { isForbidden, useProjectMembers } from './useProjectReview';

export function MembersSettings({ projectId }: { projectId: string }) {
  const { t } = useTranslation('project');
  const { data, error, mutate } = useProjectMembers(projectId);
  const actorId = useUserStore(userProfileSelectors.userId);
  const [busyId, setBusyId] = useState<string>();

  if (isForbidden(error)) return <Empty description={t('review.accessForbidden')} />;
  if (error) return <AsyncError error={error} onRetry={() => mutate()} />;
  if (!data) return <SkeletonBar height={120} />;
  if (!data.workspaceId) return <Empty description={t('review.members.workspaceOnly')} />;
  const availableMembers = data.availableMembers ?? [];
  const members = data.members ?? [];

  const run = async (id: string, action: () => Promise<unknown>) => {
    setBusyId(id);
    try {
      await action();
      await mutate();
    } catch (error) {
      console.error('Failed to update project member', error);
      toast.error(t('review.members.updateError'));
    } finally {
      setBusyId(undefined);
    }
  };

  const add = async (userIds: string[], role: ProjectMemberRole) => {
    try {
      for (const userId of actorLast(userIds, actorId)) {
        await projectReviewService.setMemberRole(projectId, userId, role);
      }
    } catch (error) {
      console.error('Failed to add project members', error);
      toast.error(t('review.members.setRoleError'));
      throw error;
    } finally {
      // Members added before a failure still show up.
      await mutate();
    }
  };

  return (
    <Flexbox gap={20}>
      <Flexbox horizontal align="flex-start" gap={16} justify="space-between">
        <Flexbox gap={6}>
          <Text fontSize={16} weight={600}>
            {t('review.members.title')}
          </Text>
          <Text type="secondary">{t('review.members.roleInheritance')}</Text>
        </Flexbox>
        <Button
          icon={UserPlusIcon}
          type="primary"
          onClick={() => openAddMemberModal({ candidates: availableMembers, onAdd: add })}
        >
          {t('review.members.add')}
        </Button>
      </Flexbox>
      <Block variant="outlined">
        {!members.length && (
          <Text style={{ padding: '12px 16px' }} type="secondary">
            {t('review.members.empty')}
          </Text>
        )}
        {members.map((member) => (
          <MemberRow
            busy={busyId === member.id}
            key={member.id}
            member={member}
            onRoleChange={(next) =>
              run(member.id, () =>
                projectReviewService.setMemberRole(projectId, member.userId, next),
              )
            }
          />
        ))}
      </Block>
    </Flexbox>
  );
}
