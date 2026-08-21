'use client';

import { Icon } from '@lobehub/ui';
import { Button, createModal } from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { PlusIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { PermissionResourceType, ResourceAccessLevel } from '@/services/resourcePermission';

import AddCollaboratorsContent from './AddCollaboratorsContent';
import CollaboratorList from './CollaboratorList';

/**
 * The level a newly added collaborator receives, per resource type. Grants are
 * single-level today: they lift the member to the resource's full member-side
 * access (for a knowledge base, `edit` = may open it and browse the files).
 */
export const COLLABORATOR_GRANT_LEVELS: Partial<
  Record<PermissionResourceType, ResourceAccessLevel>
> = {
  knowledgeBase: 'edit',
};

interface CollaboratorTargetProps {
  resourceId: string;
  resourceType: PermissionResourceType;
}

const createAddCollaboratorsModal = ({
  grantLevel,
  resourceId,
  resourceType,
}: CollaboratorTargetProps & { grantLevel: ResourceAccessLevel }) =>
  createModal({
    content: (
      <AddCollaboratorsContent
        grantLevel={grantLevel}
        resourceId={resourceId}
        resourceType={resourceType}
      />
    ),
    footer: null,
    maskClosable: true,
    styles: {
      // The content owns its paddings: search header, edge-to-edge scroll
      // list, and a divided sticky footer.
      content: { overflow: 'hidden', padding: 0 },
    },
    title: t('permission.collaborators.addModal.title', { ns: 'setting' }),
    width: 'min(90vw, 520px)',
  });

export const AddCollaboratorButton = memo<CollaboratorTargetProps>(
  ({ resourceId, resourceType }) => {
    const { t } = useTranslation('setting');
    const grantLevel = COLLABORATOR_GRANT_LEVELS[resourceType];

    const handleOpen = useCallback(() => {
      if (!grantLevel) return;
      createAddCollaboratorsModal({ grantLevel, resourceId, resourceType });
    }, [grantLevel, resourceId, resourceType]);

    // A resource type with no configured grant level has no collaborator flow:
    // the server rejects any level the modal could submit, so the entry point
    // must not exist rather than open a dialog that cannot succeed.
    if (!grantLevel) return null;

    return (
      <Button icon={<Icon icon={PlusIcon} />} size={'small'} onClick={handleOpen}>
        {t('permission.collaborators.add')}
      </Button>
    );
  },
);

AddCollaboratorButton.displayName = 'AddCollaboratorButton';

export { default as CollaboratorList } from './CollaboratorList';
export default CollaboratorList;
