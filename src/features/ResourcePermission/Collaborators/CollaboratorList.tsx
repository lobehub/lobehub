'use client';

import {
  ActionIcon,
  confirmModal,
  createStaticStyles,
  cssVar,
  Flexbox,
  SkeletonAvatar,
  SkeletonText,
  Tag,
  Text,
} from '@lobehub/ui';
import { XIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFetchWorkspaceMembers } from '@/business/client/hooks/useFetchWorkspaceMembers';
import { useWorkspaceMembers } from '@/business/client/hooks/useWorkspaceMembers';
import AsyncError from '@/components/AsyncError';
import UserAvatar from '@/components/UserAvatar';
import type { PermissionResourceType, ResourceCollaborator } from '@/services/resourcePermission';
import { densityVars } from '@/styles/densityVars';
import { getWorkspaceMemberName } from '@/utils/workspaceMemberName';

import { useAccessLevelOptions } from '../useAccessLevelOptions';
import { useResourceCollaborators } from '../useResourceCollaborators';

const styles = createStaticStyles(({ css }) => ({
  empty: css`
    padding-block: ${densityVars.contentGap};
    font-size: ${densityVars.fontSize};
    color: ${cssVar.colorTextDescription};
  `,
  row: css`
    padding-block: 8px;
  `,
}));

/** Collaborator rows carry no nickname; it comes from the workspace's member list. */
const displayName = (collaborator: ResourceCollaborator, nickname?: string | null) =>
  getWorkspaceMemberName({ ...collaborator, config: { nickname } });

interface CollaboratorListProps {
  resourceId: string;
  resourceType: PermissionResourceType;
}

/**
 * The collaborator grants of one resource: who is lifted above the workspace
 * access level, at which grade, with per-row revoke. Static management list —
 * rows are not links and carry no hover chrome.
 */
const CollaboratorList = memo<CollaboratorListProps>(({ resourceId, resourceType }) => {
  const { t } = useTranslation('setting');
  const { collaborators, error, isLoading, mutate, mutating, removeCollaborator } =
    useResourceCollaborators(resourceType, resourceId);

  const levelOptions = useAccessLevelOptions({ isPrivate: false, resourceType });
  // The roster supplies nicknames; this list may be the only member consumer on the page.
  useFetchWorkspaceMembers();
  const workspaceMembers = useWorkspaceMembers();
  const nicknames = useMemo(
    () => new Map(workspaceMembers.map((member) => [member.userId, member.config?.nickname])),
    [workspaceMembers],
  );

  if (error) return <AsyncError error={error} variant={'inline'} onRetry={() => mutate()} />;

  if (isLoading)
    return (
      <Flexbox gap={4}>
        {[0, 1].map((key) => (
          <Flexbox horizontal align={'center'} className={styles.row} gap={12} key={key}>
            <SkeletonAvatar size={32} />
            <SkeletonText style={{ marginBottom: 0, width: 160 }} />
          </Flexbox>
        ))}
      </Flexbox>
    );

  if (!collaborators || collaborators.length === 0)
    return <div className={styles.empty}>{t('permission.collaborators.empty')}</div>;

  return (
    <Flexbox>
      {collaborators.map((collaborator) => {
        const name = displayName(collaborator, nicknames.get(collaborator.userId));
        const email = collaborator.user?.email;
        const levelLabel = levelOptions.find(
          (option) => option.value === collaborator.accessLevel,
        )?.label;

        return (
          <Flexbox
            horizontal
            align={'center'}
            className={styles.row}
            gap={12}
            key={collaborator.userId}
          >
            <UserAvatar avatar={collaborator.user?.avatar} name={name} size={32} />
            <Flexbox flex={1} style={{ minWidth: 0 }}>
              <Text ellipsis weight={500}>
                {name}
              </Text>
              {email && email !== name ? (
                <Text ellipsis fontSize={12} type={'secondary'}>
                  {email}
                </Text>
              ) : null}
            </Flexbox>
            {levelLabel ? <Tag>{levelLabel}</Tag> : null}
            <ActionIcon
              disabled={mutating}
              icon={XIcon}
              size={'small'}
              title={t('permission.collaborators.remove')}
              onClick={() =>
                confirmModal({
                  cancelText: t('cancel', { ns: 'common' }),
                  okButtonProps: { danger: true },
                  okText: t('permission.collaborators.remove'),
                  onOk: () => void removeCollaborator(collaborator.userId),
                  content: t('permission.collaborators.removeConfirmDesc', { name }),
                  title: t('permission.collaborators.removeConfirmTitle', { name }),
                })
              }
            />
          </Flexbox>
        );
      })}
    </Flexbox>
  );
});

CollaboratorList.displayName = 'CollaboratorList';

export default CollaboratorList;
