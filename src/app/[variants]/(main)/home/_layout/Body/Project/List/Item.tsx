import { BoxIcon } from 'lucide-react';
import { memo, useCallback } from 'react';

import { useKnowledgeBaseStore } from '@/store/knowledgeBase';

import NavItem from '../../../../../../../../features/NavPanel/components/NavItem';
import Actions from './Actions';
import Editing from './Editing';
import { useProjectItemDropdownMenu } from './useDropdownMenu';

interface ProjectItemProps {
  id: string;
  name: string;
}

const ProjectItem = memo<ProjectItemProps>(({ id, name }) => {
  const [editing, isLoading, isUpdating] = useKnowledgeBaseStore((s) => [
    s.knowledgeBaseRenamingId === id,
    s.knowledgeBaseLoadingIds.includes(id),
    s.knowledgeBaseUpdatingId === id,
  ]);

  const toggleEditing = useCallback(
    (visible?: boolean) => {
      useKnowledgeBaseStore.setState(
        { knowledgeBaseRenamingId: visible ? id : null },
        false,
        'toggleEditing',
      );
    },
    [id],
  );

  const dropdownMenu = useProjectItemDropdownMenu({
    id,
    toggleEditing,
  });

  return (
    <>
      <NavItem
        actions={<Actions dropdownMenu={dropdownMenu} />}
        contextMenuItems={dropdownMenu}
        disabled={editing || isUpdating}
        icon={BoxIcon}
        loading={isLoading || isUpdating}
        title={name}
      />
      <Editing id={id} name={name} toggleEditing={toggleEditing} />
    </>
  );
});

export default ProjectItem;
