import { PROJECT_MEMBER_ROLES, type ProjectMemberRole } from '@lobechat/types';
import { Block, Button, Empty, Flexbox, Select, Text, toast } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import SkeletonBar from '@/components/Skeleton/Bar';
import { projectReviewService } from '@/services/projectReview';

import { MemberRow } from './MemberRow';
import { isForbidden, useProjectMembers } from './useProjectReview';

export function MembersSettings({ projectId }: { projectId: string }) {
  const { t } = useTranslation('project');
  const { data, error, mutate } = useProjectMembers(projectId);
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<ProjectMemberRole>('member');
  const [busyId, setBusyId] = useState<string>();
  const [adding, setAdding] = useState(false);

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

  const submit = async () => {
    if (!userId) return;
    setAdding(true);
    try {
      await projectReviewService.setMemberRole(projectId, userId, role);
      setUserId(null);
      await mutate();
    } catch (error) {
      console.error('Failed to add project member', error);
      toast.error(t('review.members.setRoleError'));
    } finally {
      setAdding(false);
    }
  };

  return (
    <Flexbox gap={20}>
      <Flexbox gap={6}>
        <Text fontSize={16} weight={600}>
          {t('review.members.title')}
        </Text>
        <Text type="secondary">{t('review.members.roleInheritance')}</Text>
      </Flexbox>
      <Block variant="outlined">
        <form
          style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '14px 16px' }}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Select
            showSearch
            aria-label={t('review.members.selectMember')}
            disabled={adding}
            placeholder={t('review.members.selectMember')}
            style={{ flex: '1 1 240px', minWidth: 0 }}
            value={userId}
            options={availableMembers.map((member) => ({
              label:
                member.email && member.email !== member.name
                  ? `${member.name} (${member.email})`
                  : member.name,
              value: member.userId,
            }))}
            onChange={(value) => setUserId(typeof value === 'string' ? value : null)}
          />
          <Select
            aria-label={t('review.members.role')}
            disabled={adding}
            style={{ width: 140 }}
            value={role}
            options={PROJECT_MEMBER_ROLES.map((item) => ({
              label: t(`review.role.${item}`),
              value: item,
            }))}
            onChange={(value) => value && setRole(value as ProjectMemberRole)}
          />
          <Button disabled={!userId} htmlType="submit" loading={adding} type="primary">
            {t('review.members.setRole')}
          </Button>
        </form>
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
