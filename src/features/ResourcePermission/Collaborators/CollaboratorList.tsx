'use client';

import {
  ActionIcon,
  confirmModal,
  Flexbox,
  SkeletonAvatar,
  SkeletonText,
  Tag,
  Text,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { XIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import UserAvatar from '@/components/UserAvatar';
import type { PermissionResourceType, ResourceCollaborator } from '@/services/resourcePermission';

import { useAccessLevelOptions } from '../useAccessLevelOptions';
import { useResourceCollaborators } from '../useResourceCollaborators';

const styles = stylex.create({
  empty: { paddingBlock: '12px', fontSize: '14px', color: cssVar.colorTextDescription },
  row: { paddingBlock: '8px' },
});

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
          <Flexbox
            horizontal
            align={'center'}
            className={stylex.props(styles.row).className}
            gap={12}
            key={key}
          >
            <SkeletonAvatar size={32} />
            <SkeletonText style={{ marginBottom: 0, width: 160 }} />
          </Flexbox>
        ))}
      </Flexbox>
    );

  if (!collaborators || collaborators.length === 0)
    return <div {...stylex.props(styles.empty)}>{t('permission.collaborators.empty')}</div>;

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
            className={stylex.props(styles.row).className}
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
