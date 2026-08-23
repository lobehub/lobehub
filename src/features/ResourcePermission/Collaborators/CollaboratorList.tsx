'use client';

import { ActionIcon, Avatar, Flexbox, SkeletonAvatar, SkeletonTitle, Tag, Text } from '@lobehub/ui';
import { Popconfirm } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { XIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import type { PermissionResourceType, ResourceCollaborator } from '@/services/resourcePermission';

import { useAccessLevelOptions } from '../useAccessLevelOptions';
import { useResourceCollaborators } from '../useResourceCollaborators';

const styles = createStaticStyles(({ css }) => ({
  empty: css`
    padding-block: 12px;
    font-size: 14px;
    color: ${cssVar.colorTextDescription};
  `,
  row: css`
    padding-block: 8px;
  `,
}));

const displayName = (collaborator: ResourceCollaborator) =>
  collaborator.user?.fullName ||
  collaborator.user?.username ||
  collaborator.user?.email ||
  collaborator.userId;

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

  if (error) return <AsyncError error={error} variant={'inline'} onRetry={() => mutate()} />;

  if (isLoading)
    return (
      <Flexbox gap={4}>
        {[0, 1].map((key) => (
          <Flexbox horizontal align={'center'} className={styles.row} gap={12} key={key}>
            <SkeletonAvatar size={32} />
            <SkeletonTitle style={{ marginBottom: 0, width: 160 }} />
          </Flexbox>
        ))}
      </Flexbox>
    );

  if (!collaborators || collaborators.length === 0)
    return <div className={styles.empty}>{t('permission.collaborators.empty')}</div>;

  return (
    <Flexbox>
      {collaborators.map((collaborator) => {
        const name = displayName(collaborator);
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
            <Avatar avatar={collaborator.user?.avatar || undefined} size={32} title={name} />
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
            <Popconfirm
              arrow={false}
              cancelText={t('cancel', { ns: 'common' })}
              okButtonProps={{ danger: true }}
              okText={t('permission.collaborators.remove')}
              placement={'topRight'}
              title={t('permission.collaborators.removeConfirmTitle', { name })}
              onConfirm={() => void removeCollaborator(collaborator.userId)}
            >
              <ActionIcon
                disabled={mutating}
                icon={XIcon}
                size={'small'}
                title={t('permission.collaborators.remove')}
              />
            </Popconfirm>
          </Flexbox>
        );
      })}
    </Flexbox>
  );
});

CollaboratorList.displayName = 'CollaboratorList';

export default CollaboratorList;
